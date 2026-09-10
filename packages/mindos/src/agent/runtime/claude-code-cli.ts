import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { appendBoundedLog, killChildWithEscalation } from './child-process.js';
import type { MindOSSSEvent } from '../turn/index.js';
import {
  createClaudeStreamJsonMapperState,
  getClaudeStreamJsonStringField,
  mapClaudeStreamJsonRecordToSseEvents,
} from './claude-stream-json-mapper.js';
import type { MindosSelectedSkill } from '../selected-skills.js';
import type { MindosRuntimeAttachment } from './attachments.js';

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
    attachments?: MindosRuntimeAttachment[];
    selectedSkills?: MindosSelectedSkill[];
    sessionId?: string;
    model?: string;
    effort?: 'low' | 'medium' | 'high' | 'xhigh';
    permissionMode?: ClaudeCodeCliPermissionMode;
    permissionPrompt?: ClaudeCodeCliPermissionPrompt;
    signal?: AbortSignal;
  }): AsyncIterable<ClaudeCodeCliEvent>;
  close?(): void | Promise<void>;
};

export type ClaudeCodeCliEvent =
  | { type: 'session_id'; sessionId: string }
  | MindOSSSEvent;

export function createClaudeCodeCliClient(transport: ClaudeCodeCliTransport): ClaudeCodeCliClient {
  return {
    async *startTurn(input) {
      const args = buildClaudeCodeCliArgs(input);
      const state = createClaudeStreamJsonMapperState();
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
        const sessionId = getClaudeStreamJsonStringField(record, 'session_id');
        if (sessionId && sessionId !== lastSessionId) {
          lastSessionId = sessionId;
          yield { type: 'session_id', sessionId };
        }

        for (const event of mapClaudeStreamJsonRecordToSseEvents(record, state)) {
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
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
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
    ...(input.model ? ['--model', input.model] : []),
    ...(input.effort ? ['--effort', input.effort] : []),
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
