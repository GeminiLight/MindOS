/**
 * Single mapper from Claude Code `stream-json` records to MindOS SSE events.
 *
 * Both Claude transports feed it: the CLI transport parses `claude --print
 * --output-format stream-json` lines into records, the Claude Agent SDK
 * transport receives the same record shapes as objects. Keeping one
 * implementation is the contract that guarantees a turn produces the same
 * SSE sequence whether it ran through the SDK or fell back to the CLI
 * (spec-runtime-lane-correctness, item 4).
 */
import {
  redactSensitiveText,
  sanitizeToolArgs,
  sanitizeToolOutput,
  type MindOSSSEvent,
} from '../turn/index.js';

export type ClaudeStreamJsonMapperState = {
  /** An assistant text block already streamed; the result text must not repeat it. */
  emittedText: boolean;
  /** A `result` record produced the terminal event; the transport must not synthesize `done`. */
  emittedDone: boolean;
};

export function createClaudeStreamJsonMapperState(): ClaudeStreamJsonMapperState {
  return { emittedText: false, emittedDone: false };
}

export function mapClaudeStreamJsonRecordToSseEvents(
  record: Record<string, unknown>,
  state: ClaudeStreamJsonMapperState,
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

  if (record.type === 'system' && record.subtype === 'status') {
    return mapClaudeStatusRecord(record);
  }

  if (record.type === 'rate_limit_event') {
    return mapClaudeRateLimitRecord(record);
  }

  if (record.type === 'tool_progress') {
    return mapClaudeToolProgressRecord(record);
  }

  if (record.type === 'result') {
    return mapClaudeResultRecord(record, state);
  }

  return [];
}

function mapClaudeResultRecord(
  record: Record<string, unknown>,
  state: ClaudeStreamJsonMapperState,
): MindOSSSEvent[] {
  state.emittedDone = true;
  const subtype = getStringField(record, 'subtype');
  // `is_error` is the SDK's explicit flag; any explicit non-success subtype
  // (error_max_turns, error_during_execution, ...) is a failed turn too and
  // must never be reported as `done`. A result without subtype is legacy CLI
  // output and stays a success.
  if (record.is_error === true || (subtype !== undefined && subtype !== 'success')) {
    const fallback = subtype && subtype !== 'error'
      ? `Claude Code turn ended with ${subtype}.`
      : 'Claude Code turn failed';
    return [{ type: 'error', message: redactSensitiveText(getResultErrorText(record) || fallback) }];
  }
  const resultText = getStringField(record, 'result');
  return [
    ...(!state.emittedText && resultText ? [{ type: 'text_delta' as const, delta: resultText }] : []),
    { type: 'done' },
  ];
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
  return [claudeStatus(`Claude Code ${statusText}; retrying${attemptText}.${delayText}`)];
}

function mapClaudeStatusRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const status = getStringField(record, 'status');
  if (status === 'compacting') return [claudeStatus('Claude Code is compacting context.')];
  if (status === 'requesting') return [claudeStatus('Claude Code is contacting Claude.')];
  return [];
}

function mapClaudeRateLimitRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const info = asRecord(record.rate_limit_info);
  const status = getStringField(info, 'status');
  if (!status || status === 'allowed') return [];
  const reset = getNumberField(info, 'resetsAt');
  const resetText = reset ? ` Resets ${new Date(reset).toLocaleString()}.` : '';
  return [claudeStatus(`Claude Code rate limit is ${status.replace(/_/g, ' ')}.${resetText}`)];
}

function mapClaudeToolProgressRecord(record: Record<string, unknown>): MindOSSSEvent[] {
  const toolName = getStringField(record, 'tool_name') ?? 'tool';
  const elapsed = getNumberField(record, 'elapsed_time_seconds');
  return [claudeStatus(elapsed !== undefined
    ? `Claude Code is still running ${toolName} (${Math.round(elapsed)}s).`
    : `Claude Code is still running ${toolName}.`)];
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
  // The CLI spells the field `reason`/`decisionReason`, the SDK
  // `decision_reason`; accept every spelling on both transports.
  const reason = getStringField(record, 'reason')
    ?? getStringField(record, 'decision_reason')
    ?? getStringField(record, 'decisionReason');
  const message = getStringField(record, 'message')
    ?? reason
    ?? 'Claude Code denied this tool call.';
  const blockedPath = getStringField(record, 'blockedPath') ?? getStringField(record, 'blocked_path');
  return [
    {
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, {
        ...(reason ? { reason } : {}),
        ...(blockedPath ? { blockedPath } : {}),
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
  state: ClaudeStreamJsonMapperState,
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
  const content = message && 'content' in message ? message.content : record.content;
  // The SDK can deliver a bare string for simple assistant messages.
  if (typeof content === 'string' && content) {
    return [{ type: 'text', text: content }];
  }
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

function getResultErrorText(record: Record<string, unknown>): string {
  const errors = Array.isArray(record.errors)
    ? record.errors.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return errors.join('\n') || getStringField(record, 'result') || getStringField(record, 'message') || '';
}

function claudeStatus(message: string): MindOSSSEvent {
  return { type: 'status', visible: true, runtime: 'claude', message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function getClaudeStreamJsonStringField(record: Record<string, unknown> | null, field: string): string | undefined {
  return getStringField(record, field);
}

function getStringField(record: Record<string, unknown> | null, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === 'string' && value ? value : undefined;
}

function getNumberField(record: Record<string, unknown> | null, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
