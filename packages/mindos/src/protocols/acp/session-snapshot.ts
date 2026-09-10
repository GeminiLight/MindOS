/**
 * ACP session snapshots — read-only projections of a tracked session for
 * the UI layer and the Product Server session listing.
 */

import type {
  AcpConfigOption,
  AcpMode,
  AcpSession,
  AcpSessionSnapshot,
  AcpToolCallFull,
} from './types.js';
import { findConfigOption } from './session-parsers.js';

export function buildAcpSessionSnapshot(session: AcpSession): AcpSessionSnapshot {
  const modes = session.modes ?? [];
  const configOptions = session.configOptions ?? [];
  const toolCalls = session.toolCalls ?? [];
  const permissionEvents = session.permissionEvents ?? [];
  return {
    schemaVersion: 1,
    sessionId: session.id,
    agentId: session.agentId,
    ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
    state: session.state,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.agentCapabilities ? { agentCapabilities: session.agentCapabilities } : {}),
    authMethods: session.authMethods ?? [],
    modes,
    ...(session.currentModeId ? { currentModeId: session.currentModeId } : {}),
    configOptions,
    controls: {
      model: buildControlSnapshot(configOptions, 'model'),
      mode: buildModeControlSnapshot(configOptions, modes, session.currentModeId),
      thoughtLevel: buildControlSnapshot(configOptions, 'thought_level'),
    },
    availableCommands: session.availableCommands ?? [],
    toolCalls,
    toolSummary: summarizeToolCalls(toolCalls),
    permissionEvents,
    pendingPermissions: permissionEvents.filter((event) => event.status === 'pending'),
    ...(session.sessionInfo ? { sessionInfo: session.sessionInfo } : {}),
    mcpServers: session.mcpServers ?? [],
  };
}

function buildControlSnapshot(configOptions: AcpConfigOption[], category: string): AcpSessionSnapshot['controls']['model'] {
  const option = findConfigOption(configOptions, category);
  if (!option) {
    return {
      status: 'unavailable',
      source: 'unavailable',
      options: [],
    };
  }
  return {
    status: 'available',
    source: 'observed',
    configId: option.configId,
    currentValue: option.currentValue,
    options: option.options,
  };
}

function buildModeControlSnapshot(
  configOptions: AcpConfigOption[],
  modes: AcpMode[],
  currentModeId: string | undefined,
): AcpSessionSnapshot['controls']['mode'] {
  const option = findConfigOption(configOptions, 'mode');
  if (option) {
    return {
      status: 'available',
      source: 'observed',
      configId: option.configId,
      ...(currentModeId ?? option.currentValue ? { currentValue: currentModeId ?? option.currentValue } : {}),
      options: option.options,
    };
  }
  if (modes.length === 0) {
    return {
      status: 'unavailable',
      source: 'unavailable',
      options: [],
    };
  }
  return {
    status: 'available',
    source: currentModeId ? 'observed' : 'declared',
    ...(currentModeId ? { currentValue: currentModeId } : {}),
    options: modes.map((mode) => ({ id: mode.id, label: mode.name })),
  };
}

function summarizeToolCalls(toolCalls: AcpToolCallFull[]): AcpSessionSnapshot['toolSummary'] {
  return {
    total: toolCalls.length,
    pending: toolCalls.filter((toolCall) => toolCall.status === 'pending').length,
    inProgress: toolCalls.filter((toolCall) => toolCall.status === 'in_progress').length,
    completed: toolCalls.filter((toolCall) => toolCall.status === 'completed').length,
    failed: toolCalls.filter((toolCall) => toolCall.status === 'failed').length,
  };
}

/* ── Public listing view ─────────────────────────────────────────────── */

const PUBLIC_LIST_LIMIT = 20;
const PUBLIC_TOOL_TEXT_LIMIT = 500;
const PUBLIC_SCALAR_KEYS = [
  'id', 'agentId', 'agentSessionId', 'state', 'cwd', 'createdAt', 'lastActivityAt',
  'currentModeId', 'title', 'preview', 'messageCount', 'turnCount',
] as const;
const PUBLIC_CLONED_KEYS = [
  'agentCapabilities', 'authMethods', 'modes', 'configOptions', 'availableCommands', 'mcpServers', 'sessionInfo',
] as const;

function capText(value: unknown): unknown {
  if (typeof value !== 'string' || value.length <= PUBLIC_TOOL_TEXT_LIMIT) return value;
  return `${value.slice(0, PUBLIC_TOOL_TEXT_LIMIT)}...`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * A detached, bounded copy of a tracked session for GET /api/acp/session:
 * only the keys present on the input, no transcript (`messages` / `turns`),
 * at most the last 20 tool calls and permission events, tool text capped at
 * 500 characters. Handing out the live `AcpSession` object let route
 * consumers mutate internal state and serialise unbounded payloads.
 */
export function toAcpSessionPublicView(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const view: Record<string, unknown> = {};
  for (const key of PUBLIC_SCALAR_KEYS) {
    if (record[key] !== undefined) view[key] = record[key];
  }
  for (const key of PUBLIC_CLONED_KEYS) {
    if (record[key] !== undefined) view[key] = cloneJson(record[key]);
  }
  if (Array.isArray(record.toolCalls)) {
    view.toolCalls = record.toolCalls.slice(-PUBLIC_LIST_LIMIT).map((toolCall) => {
      if (!toolCall || typeof toolCall !== 'object') return toolCall;
      const entry = cloneJson(toolCall as Record<string, unknown>);
      if ('rawInput' in entry) entry.rawInput = capText(entry.rawInput);
      if ('rawOutput' in entry) entry.rawOutput = capText(entry.rawOutput);
      return entry;
    });
  }
  if (Array.isArray(record.permissionEvents)) {
    view.permissionEvents = cloneJson(record.permissionEvents.slice(-PUBLIC_LIST_LIMIT));
  }
  return view;
}
