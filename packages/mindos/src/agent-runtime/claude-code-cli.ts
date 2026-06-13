import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { appendBoundedLog, killChildWithEscalation } from './child-process.js';
import {
  redactSensitiveText,
  sanitizeToolArgs,
  sanitizeToolOutput,
  type MindOSSSEvent,
} from '../session/index.js';

export type ClaudeCodeCliTransport = {
  run(args: string[], options: { cwd: string; signal?: AbortSignal }): AsyncIterable<string>;
  close?(): void | Promise<void>;
};

export type ClaudeCodeCliPermissionPrompt = {
  toolName: string;
  mcpConfig: string | Record<string, unknown>;
};

export type ClaudeCodeCliPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

export type ClaudeCodeCliClient = {
  startTurn(input: {
    prompt: string;
    cwd: string;
    sessionId?: string;
    permissionMode?: ClaudeCodeCliPermissionMode;
    permissionPrompt?: ClaudeCodeCliPermissionPrompt;
    signal?: AbortSignal;
  }): AsyncIterable<ClaudeCodeCliEvent>;
  close?(): void | Promise<void>;
};

export type ClaudeCodeCliEvent =
  | { type: 'session_id'; sessionId: string }
  | MindOSSSEvent;

type ClaudeCodeCliState = {
  emittedText: boolean;
  emittedDone: boolean;
};

export function createClaudeCodeCliClient(transport: ClaudeCodeCliTransport): ClaudeCodeCliClient {
  return {
    async *startTurn(input) {
      const args = buildClaudeCodeCliArgs(input);
      const state: ClaudeCodeCliState = { emittedText: false, emittedDone: false };
      let lastSessionId: string | null = null;

      for await (const line of transport.run(args, { cwd: input.cwd, signal: input.signal })) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // The CLI shares stdout with anything it (or a wrapper script) logs;
        // a single non-JSON line must not abort the whole turn.
        let record: Record<string, unknown>;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
          record = parsed as Record<string, unknown>;
        } catch {
          continue;
        }
        const sessionId = getStringField(record, 'session_id');
        if (sessionId && sessionId !== lastSessionId) {
          lastSessionId = sessionId;
          yield { type: 'session_id', sessionId };
        }

        for (const event of mapClaudeCodeCliRecordToSseEvents(record, state)) {
          yield event;
        }
      }

      if (!state.emittedDone) {
        yield { type: 'done' };
      }
    },
    close: () => transport.close?.(),
  };
}

export function createClaudeCodeCliStdioTransport(options: {
  command?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ClaudeCodeCliTransport {
  const command = options.command ?? 'claude';
  let child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  const intentionallyKilled = new WeakSet<object>();

  return {
    run(args, runOptions) {
      const proc = spawn(command, args, {
        cwd: runOptions.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(options.env ?? {}) },
      });
      child = proc;

      const lines = createInterface({ input: proc.stdout });
      let stderr = '';
      let spawnErrorMessage = '';
      proc.stderr.on('data', (chunk) => {
        stderr = appendBoundedLog(stderr, chunk);
      });
      proc.once('error', (error) => {
        spawnErrorMessage = error instanceof Error ? error.message : String(error);
      });

      const abort = () => {
        intentionallyKilled.add(proc);
        killChildWithEscalation(proc);
      };
      runOptions.signal?.addEventListener('abort', abort, { once: true });

      const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        proc.once('close', (code, signal) => resolve({ code, signal }));
      });

      return (async function* () {
        try {
          for await (const line of lines) {
            if (typeof line === 'string') yield line;
          }
          const result = await close;
          if (spawnErrorMessage) {
            throw new Error(stderr.trim() || spawnErrorMessage);
          }
          if (result.code && result.code !== 0) {
            const message = stderr.trim() || `Claude Code exited with code ${result.code}`;
            throw new Error(message);
          }
          // A signal exit we did not request (OOM killer, external kill)
          // must surface as an error, not as a silently truncated turn.
          if (result.signal && !intentionallyKilled.has(proc)) {
            throw new Error(stderr.trim() || `Claude Code was killed by signal ${result.signal}`);
          }
        } finally {
          runOptions.signal?.removeEventListener('abort', abort);
          lines.close();
        }
      })();
    },
    close() {
      if (child) {
        intentionallyKilled.add(child);
        killChildWithEscalation(child);
      }
    },
  };
}

function buildClaudeCodeCliArgs(input: {
  prompt: string;
  sessionId?: string;
  permissionMode?: ClaudeCodeCliPermissionMode;
  permissionPrompt?: ClaudeCodeCliPermissionPrompt;
}): string[] {
  return [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    input.permissionMode ?? 'default',
    ...(input.sessionId ? ['--resume', input.sessionId] : []),
    ...(input.permissionPrompt ? [
      '--mcp-config',
      typeof input.permissionPrompt.mcpConfig === 'string'
        ? input.permissionPrompt.mcpConfig
        : JSON.stringify(input.permissionPrompt.mcpConfig),
      '--permission-prompt-tool',
      input.permissionPrompt.toolName,
    ] : []),
    // `--` stops flag parsing: a prompt that begins with a dash must reach
    // the CLI as the positional prompt, never as an option.
    '--',
    input.prompt,
  ];
}

function mapClaudeCodeCliRecordToSseEvents(
  record: Record<string, unknown>,
  state: ClaudeCodeCliState,
): MindOSSSEvent[] {
  if (record.type === 'assistant' || record.type === 'user') {
    return contentBlocksFromRecord(record).flatMap((block) => mapClaudeContentBlock(block, state));
  }

  if (isClaudePermissionDeniedRecord(record)) {
    return mapClaudePermissionDeniedRecord(record);
  }

  if (record.type === 'system' && record.subtype === 'api_retry') {
    return mapClaudeApiRetryRecord(record);
  }

  if (record.type === 'result') {
    state.emittedDone = true;
    if (record.is_error === true || record.subtype === 'error') {
      return [{ type: 'error', message: redactSensitiveText(getResultText(record) || 'Claude Code turn failed') }];
    }
    const resultText = getStringField(record, 'result');
    return [
      ...(!state.emittedText && resultText ? [{ type: 'text_delta' as const, delta: resultText }] : []),
      { type: 'done' },
    ];
  }

  return [];
}

function mapClaudeApiRetryRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const attempt = getNumberField(record, 'attempt');
  const maxRetries = getNumberField(record, 'max_retries');
  const retryDelayMs = getNumberField(record, 'retry_delay_ms');
  const errorStatus = getNumberField(record, 'error_status');
  const error = getStringField(record, 'error');
  const retrySeconds = retryDelayMs !== undefined ? Math.max(1, Math.round(retryDelayMs / 1000)) : null;
  const attemptText = attempt !== undefined && maxRetries !== undefined
    ? ` (${attempt}/${maxRetries})`
    : '';
  const statusText = errorStatus ? `HTTP ${errorStatus}` : (error ?? 'API request failed');
  const delayText = retrySeconds ? ` Retrying in ${retrySeconds}s.` : ' Retrying.';
  return [{
    type: 'status',
    visible: true,
    runtime: 'claude',
    message: `Claude Code ${statusText}; retrying${attemptText}.${delayText}`,
  }];
}

function isClaudePermissionDeniedRecord(record: Record<string, unknown>): boolean {
  return record.subtype === 'permission_denied'
    || record.subtype === 'permissionDenied'
    || record.type === 'permission_denied'
    || record.type === 'permissionDenied';
}

function mapClaudePermissionDeniedRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const toolCallId = getStringField(record, 'tool_use_id')
    ?? getStringField(record, 'toolUseID')
    ?? getStringField(record, 'toolUseId')
    ?? getStringField(record, 'tool_call_id')
    ?? getStringField(record, 'id')
    ?? `claude-permission-denied-${Date.now().toString(36)}`;
  const toolName = getStringField(record, 'tool_name')
    ?? getStringField(record, 'toolName')
    ?? getStringField(record, 'name')
    ?? 'permission_denied';
  const message = getStringField(record, 'message')
    ?? getStringField(record, 'reason')
    ?? getStringField(record, 'decisionReason')
    ?? 'Claude Code denied this tool call.';
  return [
    {
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, {
        ...(getStringField(record, 'reason') ? { reason: getStringField(record, 'reason') } : {}),
        ...(getStringField(record, 'blockedPath') ? { blockedPath: getStringField(record, 'blockedPath') } : {}),
      }),
      runtime: 'claude',
    },
    {
      type: 'tool_end',
      toolCallId,
      output: sanitizeToolOutput(message),
      isError: true,
      runtime: 'claude',
    },
  ];
}

function mapClaudeContentBlock(
  block: Record<string, unknown>,
  state: ClaudeCodeCliState,
): MindOSSSEvent[] {
  if (block.type === 'text') {
    const text = getStringField(block, 'text');
    if (!text) return [];
    state.emittedText = true;
    return [{ type: 'text_delta', delta: text }];
  }

  if (block.type === 'thinking') {
    const text = getStringField(block, 'thinking') ?? getStringField(block, 'text');
    return text ? [{ type: 'thinking_delta', delta: text }] : [];
  }

  if (block.type === 'tool_use') {
    const toolCallId = getStringField(block, 'id');
    const toolName = getStringField(block, 'name');
    if (!toolCallId || !toolName) return [];
    return [{
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, block.input),
      runtime: 'claude',
    }];
  }

  if (block.type === 'tool_result') {
    const toolCallId = getStringField(block, 'tool_use_id');
    if (!toolCallId) return [];
    return [{
      type: 'tool_end',
      toolCallId,
      output: sanitizeToolOutput(stringifyClaudeToolResult(block.content)),
      isError: block.is_error === true,
      runtime: 'claude',
    }];
  }

  return [];
}

function contentBlocksFromRecord(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = asRecord(record.message);
  const content = Array.isArray(message?.content) ? message.content : record.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    const block = asRecord(item);
    return block ? [block] : [];
  });
}

function stringifyClaudeToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      const block = asRecord(item);
      return getStringField(block, 'text') ?? JSON.stringify(item);
    }).join('\n');
  }
  return value === undefined ? '' : JSON.stringify(value);
}

function getResultText(record: Record<string, unknown>): string {
  return getStringField(record, 'result') ?? getStringField(record, 'message') ?? '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getStringField(record: Record<string, unknown> | null, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === 'string' && value ? value : undefined;
}

function getNumberField(record: Record<string, unknown> | null, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
