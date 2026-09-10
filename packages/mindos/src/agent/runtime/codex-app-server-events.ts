import {
  redactSensitiveText,
  sanitizeToolArgs,
  sanitizeToolOutput,
  type MindOSSSEvent,
} from '../turn/index.js';
import { compactRuntimeFailureMessage } from './runtime-errors.js';
import type { CodexAppServerNotification } from './codex-app-server.js';

/**
 * Codex app-server notification → MindOS SSE event mapping, split out of
 * `codex-app-server.ts` so the JSON-RPC client and the stdio transport stay
 * under the file-size budget. The client only needs the two terminal-state
 * predicates and the small record helpers exported at the bottom.
 */

export function mapCodexAppServerNotificationToSseEvents(notification: CodexAppServerNotification): MindOSSSEvent[] {
  const toolEvents = mapCodexRuntimeToolNotification(notification);
  if (toolEvents.length > 0) return toolEvents;

  if (notification.method === 'error') {
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

  if (notification.method === 'item/agentMessage/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'text_delta', delta }] : [];
  }

  if (notification.method === 'item/thinking/delta') {
    const delta = getStringParam(notification.params, 'delta') ?? getStringParam(notification.params, 'text');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (
    notification.method === 'item/reasoning/textDelta'
    || notification.method === 'item/reasoning/summaryTextDelta'
    || notification.method === 'item/reasoning/summaryPartAdded'
  ) {
    const delta = getStringParam(notification.params, 'delta')
      ?? getStringParam(notification.params, 'text')
      ?? getStringParam(notification.params, 'summary');
    return delta ? [{ type: 'thinking_delta', delta }] : [];
  }

  if (notification.method === 'turn/completed') {
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

  if (notification.method === 'turn/failed') {
    return [{
      type: 'error',
      message: compactRuntimeFailureMessage(
        redactSensitiveText(getCodexErrorMessage(notification.params, 'Codex turn failed')),
        { runtime: 'codex', fallback: 'Codex turn failed' },
      ),
    }];
  }

  return [];
}

function mapCodexRuntimeToolNotification(notification: CodexAppServerNotification): MindOSSSEvent[] {
  const method = notification.method;
  const lower = method.toLowerCase();
  const params = notification.params ?? {};

  const officialItemEvents = mapCodexOfficialItemNotification(method, params);
  if (officialItemEvents.length > 0) return officialItemEvents;

  if (!/(tool|command|exec|approval|permission|patch)/.test(lower)) return [];

  const toolCallId = getCodexToolCallId(method, params);
  const toolName = getCodexToolName(method, params);
  if (!toolCallId || !toolName) return [];

  if (/outputdelta|output_delta/.test(lower)) {
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

  if (/(end|ended|complete|completed|result|output|failed|error|rejected|denied|approved|allowed)/.test(lower)) {
    return [{
      type: 'tool_end',
      toolCallId,
      toolName,
      output: sanitizeToolOutput(getCodexToolOutput(params)),
      isError: /(failed|error|rejected|denied)/.test(lower) || params.isError === true || params.error !== undefined,
      runtime: 'codex',
    }];
  }

  if (/(start|started|begin|began|added|call|request|requested|created)/.test(lower)) {
    return [{
      type: 'tool_start',
      toolCallId,
      toolName,
      args: sanitizeToolArgs(toolName, getCodexToolInput(params)),
      runtime: 'codex',
    }];
  }

  return [];
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
