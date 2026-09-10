import {
  redactSensitiveText,
  sanitizeToolArgs,
  sanitizeToolOutput,
  type MindOSSSEvent,
} from '../turn/index.js';
import { getCurrentAgentRunContext } from '../agent-run-context.js';
import { compactRuntimeFailureMessage } from './runtime-errors.js';
import type { CodexAppServerNotification } from './codex-app-server.js';

/**
 * Codex app-server notification → MindOS SSE event mapping, split out of
 * `codex-app-server.ts` so the JSON-RPC client and the stdio transport stay
 * under the file-size budget. The client only needs the two terminal-state
 * predicates and the small record helpers exported at the bottom.
 *
 * Tool-ish notifications are mapped from an EXPLICIT protocol table
 * (`CODEX_TOOL_NOTIFICATION_PHASES`) rather than the legacy
 * `/(tool|command|exec|approval|permission|patch)/` + start/delta/end regex
 * guess, which collapsed any unknown method into a fabricated `codex-${method}`
 * tool row. Methods that are known but carry no MindOS event live in
 * `CODEX_KNOWN_SILENT_NOTIFICATIONS`; anything else is recorded as a typed
 * `unhandled-notification` debug event (best effort, via the run ledger) so it
 * is inspectable without inventing a tool call or silently vanishing.
 */

export type CodexToolNotificationPhase = 'start' | 'delta' | 'end';

/**
 * Every method the legacy regex actually caught, with the phase the regex
 * produced (verified by the oracle in codex-app-server-events.test.ts). Add a
 * row here when Codex ships a new tool-ish notification; until then it lands in
 * the unhandled-notification debug path instead of a guessed tool row.
 */
export const CODEX_TOOL_NOTIFICATION_PHASES: ReadonlyMap<string, CodexToolNotificationPhase> = new Map([
  ['item/command/started', 'start'],
  ['item/command/completed', 'end'],
  ['item/command/failed', 'end'],
  ['item/command/outputDelta', 'delta'],
  ['item/permission/requested', 'start'],
  // Legacy regex matched `call` inside `mcpToolCall` → start phase; preserved.
  ['item/mcpToolCall/progress', 'start'],
  ['execCommand/begin', 'start'],
  ['execCommand/end', 'end'],
  ['execApproval/requested', 'start'],
  ['applyPatchApproval/requested', 'start'],
]);

/**
 * Known protocol notifications that carry no MindOS SSE event. Some matched the
 * legacy gate but no phase regex (→ `[]`); some never matched the gate. Either
 * way the legacy mapper returned `[]`, so they are enumerated here to keep that
 * behaviour and stay out of the unhandled-notification debug path.
 */
export const CODEX_KNOWN_SILENT_NOTIFICATIONS: ReadonlySet<string> = new Set([
  'turn/started',
  'turn/aborted',
  'item/updated',
  'item/permission/resolved',
  'serverRequest/resolved',
  'thread/started',
  'login/chatgpt/completed',
]);

export type CodexUnhandledNotificationEvent = {
  type: 'unhandled-notification';
  method: string;
  paramsSummary: string;
};

/** Typed, redacted, bounded description of a notification the table does not know. */
export function describeCodexUnhandledNotification(
  notification: CodexAppServerNotification,
): CodexUnhandledNotificationEvent {
  return {
    type: 'unhandled-notification',
    method: notification.method,
    paramsSummary: redactSensitiveText(safeJson(notification.params ?? {})).slice(0, 200),
  };
}

/**
 * Best-effort debug record of an unknown notification into the active run
 * ledger. Uses the ALS run context for the run id and a lazy import so the hot
 * event mapper keeps no static runtime→ledger dependency. No-ops outside a run
 * context (e.g. unit tests calling the mapper directly).
 */
function recordCodexUnhandledNotification(notification: CodexAppServerNotification): void {
  const context = getCurrentAgentRunContext();
  const runId = context?.parentRunId ?? context?.rootRunId;
  if (!runId) return;
  const event = describeCodexUnhandledNotification(notification);
  void import('../ledger/run-ledger.js')
    .then(({ appendAgentRunEvent }) => {
      appendAgentRunEvent(runId, {
        type: 'runtime_status',
        category: 'status',
        message: `Codex app-server sent an unhandled notification: ${event.method}`,
        runtime: 'codex',
        visibility: 'debug',
        data: {
          kind: 'status',
          nextStatus: 'running',
          summary: event.paramsSummary ? `${event.method} ${event.paramsSummary}` : event.method,
        },
      });
    })
    .catch(() => { /* best effort */ });
}

export function mapCodexAppServerNotificationToSseEvents(notification: CodexAppServerNotification): MindOSSSEvent[] {
  const method = notification.method;
  const params = notification.params ?? {};

  // Official Codex item notifications keep their dedicated mapping.
  const officialItemEvents = mapCodexOfficialItemNotification(method, params);
  if (officialItemEvents.length > 0) return officialItemEvents;

  if (method === 'error') {
    const message = compactRuntimeFailureMessage(
      redactSensitiveText(getCodexErrorMessage(notification.params, 'Codex app-server error')),
      { runtime: 'codex', fallback: 'Codex app-server error' },
    );
    // `willRetry: true` is the app-server telling us it hit a transient
    // condition (stream drop, upstream 5xx) and is retrying on its own; the
    // turn is still alive, so report progress rather than a terminal error.
    if (isCodexRetryingErrorNotification(notification)) {
      return [{
        type: 'status',
        visible: true,
        runtime: 'codex',
        message: `Codex hit a transient error and is retrying: ${message}`,
      }];
    }
    return [{ type: 'error', message }];
  }

  if (method === 'item/agentMessage/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'text_delta', delta }] : [];
  }

  if (method === 'item/thinking/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (
    method === 'item/reasoning/textDelta'
    || method === 'item/reasoning/summaryTextDelta'
    || method === 'item/reasoning/summaryPartAdded'
  ) {
    const delta = getStringParam(notification.params, 'delta')
      ?? getStringParam(notification.params, 'text')
      ?? getStringParam(notification.params, 'summary');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (method === 'turn/completed') {
    const status = getCodexTurnStatus(notification.params);
    if (status && status !== 'completed' && status !== 'success') {
      return [{
        type: 'error',
        message: compactRuntimeFailureMessage(
          redactSensitiveText(getCodexErrorMessage(notification.params, `Codex turn ${status}`)),
          { runtime: 'codex', fallback: `Codex turn ${status}` },
        ),
      }];
    }
    return [{ type: 'done' }];
  }

  if (method === 'turn/failed') {
    return [{
      type: 'error',
      message: compactRuntimeFailureMessage(
        redactSensitiveText(getCodexErrorMessage(notification.params, 'Codex turn failed')),
        { runtime: 'codex', fallback: 'Codex turn failed' },
      ),
    }];
  }

  // Explicit tool-phase table (replaces the legacy regex guess).
  const phase = CODEX_TOOL_NOTIFICATION_PHASES.get(method);
  if (phase) return buildCodexToolEvent(method, phase, params);

  // Known protocol notifications with no MindOS event.
  if (CODEX_KNOWN_SILENT_NOTIFICATIONS.has(method)) return [];

  // Unknown method: typed debug record, never a fabricated tool row.
  recordCodexUnhandledNotification(notification);
  return [];
}

function buildCodexToolEvent(
  method: string,
  phase: CodexToolNotificationPhase,
  params: Record<string, unknown>,
): MindOSSSEvent[] {
  const lower = method.toLowerCase();
  const toolCallId = getCodexToolCallId(method, params);
  const toolName = getCodexToolName(method, params);
  if (!toolCallId || !toolName) return [];

  if (phase === 'delta') {
    const delta = getStringParam(params, 'delta')
      ?? getStringParam(params, 'output')
      ?? getStringParam(params, 'text');
    return delta ? [{
      type: 'tool_delta',
      toolCallId,
      toolName,
      delta: redactSensitiveText(delta),
      runtime: 'codex',
    }] : [];
  }

  if (phase === 'end') {
    return [{
      type: 'tool_end',
      toolCallId,
      toolName,
      output: sanitizeToolOutput(getCodexToolOutput(params)),
      isError: /(failed|error|rejected|denied)/.test(lower) || params.isError === true || params.error !== undefined,
      runtime: 'codex',
    }];
  }

  return [{
    type: 'tool_start',
    toolCallId,
    toolName,
    args: sanitizeToolArgs(toolName, getCodexToolInput(params)),
    runtime: 'codex',
  }];
}

function mapCodexOfficialItemNotification(
  method: string,
  params: Record<string, unknown>,
): MindOSSSEvent[] {
  if (method === 'item/commandExecution/outputDelta') {
    const toolCallId = getCodexToolCallId(method, params);
    const delta = getStringParam(params, 'delta')
      ?? getStringParam(params, 'output')
      ?? getStringParam(params, 'text');
    if (!toolCallId || !delta) return [];
    return [{
      type: 'tool_delta',
      toolCallId,
      toolName: getCodexToolName(method, params),
      delta: redactSensitiveText(delta),
      runtime: 'codex',
    }];
  }

  if (method !== 'item/started' && method !== 'item/completed') return [];

  const item = getCodexItem(params);
  if (!item || !isCodexRuntimeToolItem(item)) return [];
  const toolCallId = getCodexToolCallId(method, params);
  const toolName = getCodexToolName(method, params);
  if (!toolCallId || !toolName) return [];

  if (method === 'item/started') {
    return [{
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, getCodexToolInput(params)),
      runtime: 'codex',
    }];
  }

  const status = getStringField(item, 'status') ?? getStringParam(params, 'status');
  return [{
    type: 'tool_end',
    toolCallId,
    toolName,
    output: sanitizeToolOutput(getCodexToolOutput(params)),
    isError: status === 'failed'
      || status === 'error'
      || status === 'declined'
      || params.isError === true
      || params.error !== undefined
      || item.error !== undefined,
    runtime: 'codex',
  }];
}
export function isCodexRetryingErrorNotification(notification: CodexAppServerNotification): boolean {
  return notification.method === 'error' && notification.params?.willRetry === true;
}

export function isCodexTerminalTurnNotification(notification: CodexAppServerNotification): boolean {
  return (
    (notification.method === 'error' && !isCodexRetryingErrorNotification(notification))
    || notification.method === 'turn/completed'
    || notification.method === 'turn/failed'
  );
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getStringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Turn identity carried by a notification (`turnId`, or `turn.id` on
 * turn/* events). Undefined for notifications that are not turn-scoped.
 */
export function getCodexNotificationTurnId(notification: CodexAppServerNotification): string | undefined {
  const params = notification.params;
  return getStringParam(params, 'turnId') ?? getStringParam(asRecord(params?.turn) ?? undefined, 'id');
}

export function getCodexNotificationThreadId(notification: CodexAppServerNotification): string | undefined {
  return getStringParam(notification.params, 'threadId');
}

function getCodexItem(params: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(params.item) ?? params;
}

function getCodexItemType(item: Record<string, unknown> | null): string {
  return getStringField(item, 'type') ?? getStringField(item, 'kind') ?? '';
}

function isCodexRuntimeToolItem(item: Record<string, unknown>): boolean {
  const type = getCodexItemType(item).toLowerCase();
  return type.includes('command')
    || type.includes('filechange')
    || type.includes('file_change')
    || type.includes('tool')
    || type.includes('dynamic')
    || Boolean(getStringField(item, 'command'))
    || Boolean(getStringField(item, 'toolName'))
    || Boolean(getStringField(item, 'name'));
}

function getCodexToolCallId(method: string, params: Record<string, unknown>): string {
  const direct = getStringParam(params, 'toolCallId')
    ?? getStringParam(params, 'callId')
    ?? getStringParam(params, 'itemId')
    ?? getStringParam(params, 'requestId')
    ?? getStringParam(params, 'id');
  if (direct) return direct;

  const item = asRecord(params.item);
  const nested = getStringField(item, 'id') ?? getStringField(item, 'callId');
  return nested ?? `codex-${method}`;
}

function getCodexToolName(method: string, params: Record<string, unknown>): string {
  const direct = getStringParam(params, 'toolName')
    ?? getStringParam(params, 'name')
    ?? getStringParam(params, 'tool')
    ?? getStringParam(params, 'commandName');
  if (direct) return direct;
  if (getStringParam(params, 'command')) return 'Bash';
  if (method.toLowerCase().includes('commandexecution')) return 'Bash';
  if (method.toLowerCase().includes('approval') || method.toLowerCase().includes('permission')) return 'approval_request';

  const item = getCodexItem(params);
  const itemType = getCodexItemType(item).toLowerCase();
  const itemTool = asRecord(item?.tool) ?? asRecord(item?.mcpTool) ?? asRecord(item?.dynamicTool);
  const itemServer = asRecord(item?.server) ?? asRecord(item?.mcpServer);
  if (getStringField(item, 'command')) return 'Bash';
  if (itemType.includes('command')) return 'Bash';
  if (itemType.includes('filechange') || itemType.includes('file_change')) return 'file_change';
  const nestedToolName = getStringField(itemTool, 'name')
    ?? getStringField(itemTool, 'toolName')
    ?? getStringField(item, 'serverToolName');
  const serverName = getStringField(itemServer, 'name') ?? getStringField(itemServer, 'serverName');
  if (serverName && nestedToolName) return `${serverName}.${nestedToolName}`;
  return getStringField(item, 'name')
    ?? getStringField(item, 'toolName')
    ?? nestedToolName
    ?? method.split('/').at(-1)
    ?? method;
}

function getCodexToolInput(params: Record<string, unknown>): unknown {
  const item = getCodexItem(params);
  const itemTool = asRecord(item?.tool) ?? asRecord(item?.mcpTool) ?? asRecord(item?.dynamicTool);
  return params.input
    ?? params.arguments
    ?? params.args
    ?? params.command
    ?? item?.input
    ?? item?.arguments
    ?? item?.args
    ?? item?.command
    ?? itemTool?.input
    ?? itemTool?.arguments
    ?? itemTool?.args
    ?? params;
}

function getCodexToolOutput(params: Record<string, unknown>): string {
  const direct = getStringParam(params, 'output')
    ?? getStringParam(params, 'result')
    ?? getStringParam(params, 'message')
    ?? getStringParam(params, 'text');
  if (direct) return direct;

  const error = asRecord(params.error);
  const errorMessage = getStringField(error, 'message') ?? getStringField(error, 'detail');
  if (errorMessage) return errorMessage;

  const item = getCodexItem(params);
  const itemOutput = getStringField(item, 'output') ?? getStringField(item, 'result');
  if (itemOutput) return itemOutput;

  const itemTool = asRecord(item?.tool) ?? asRecord(item?.mcpTool) ?? asRecord(item?.dynamicTool);
  const toolOutput = getStringField(itemTool, 'output') ?? getStringField(itemTool, 'result');
  if (toolOutput) return toolOutput;

  const itemError = asRecord(item?.error);
  const itemErrorMessage = getStringField(itemError, 'message') ?? getStringField(itemError, 'detail');
  if (itemErrorMessage) return itemErrorMessage;

  const status = getStringField(item, 'status') ?? getStringParam(params, 'status');
  if (status) return `Codex item ${status}`;

  return safeJson(params);
}

function getCodexTurnStatus(params: Record<string, unknown> | undefined): string | undefined {
  const direct = getStringParam(params, 'status');
  if (direct) return direct;
  const turn = asRecord(params?.turn);
  const nested = turn?.status;
  return typeof nested === 'string' ? nested : undefined;
}

function getCodexErrorMessage(params: Record<string, unknown> | undefined, fallback: string): string {
  const direct = getStringParam(params, 'message') ?? getStringParam(params, 'errorMessage');
  if (direct) return direct;

  const error = asRecord(params?.error);
  const errorMessage = getStringField(error, 'message') ?? getStringField(error, 'detail');
  if (errorMessage) return errorMessage;

  const turn = asRecord(params?.turn);
  const turnError = asRecord(turn?.error);
  const turnMessage = getStringField(turnError, 'message')
    ?? getStringField(turnError, 'detail')
    ?? getStringField(turn, 'message');
  if (turnMessage) return turnMessage;

  const status = getCodexTurnStatus(params);
  return status ? `${fallback}: ${status}` : fallback;
}

function getStringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value ? value : undefined;
}
