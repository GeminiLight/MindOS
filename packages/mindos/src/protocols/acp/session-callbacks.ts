/**
 * ACP session update handling — convert SDK notifications into MindOS
 * session updates and fold them into the tracked session state.
 */

import type { SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  AcpContentBlock,
  AcpPermissionEvent,
  AcpSession,
  AcpSessionUpdate,
  AcpToolCallFull,
} from './types.js';
import type { AcpClientCallbacks, AcpConnection } from './subprocess.js';
import {
  currentModeFromConfig,
  parseAvailableCommands,
  parseConfigOptions,
} from './session-parsers.js';
import { recordArtifactsFromAcpToolCall } from '../../agent/ledger/artifact-ledger.js';
import { redactSensitiveText } from '../../agent/redaction.js';

const TOOL_RAW_TEXT_LIMIT = 4000;
const INLINE_IMAGE_RESULT_LIMIT = 64 * 1024;
const INLINE_IMAGE_PREFIX_RE = /^(?:data:image\/|iVBORw0KGgo|\/9j\/|UklGR)/;

/* ── Per-prompt callback ownership ───────────────────────────────────── */

export type AcpPromptCallbackHandlers = Required<
  Pick<AcpClientCallbacks, 'onSessionUpdate' | 'onPermissionRequest' | 'onPermissionResolved'>
>;

/**
 * Install one prompt's callbacks on the shared connection container and
 * return a release that only removes them while they are still the installed
 * ones. `cancelPrompt` lets a new prompt start before the cancelled one
 * settles; the late `finally` of the old prompt must not strip the callbacks
 * the new prompt installed, otherwise its session/update and permission
 * requests vanish.
 */
export function installPromptCallbacks(
  conn: AcpConnection,
  handlers: AcpPromptCallbackHandlers,
): () => void {
  conn.callbacks.onSessionUpdate = handlers.onSessionUpdate;
  conn.callbacks.onPermissionRequest = handlers.onPermissionRequest;
  conn.callbacks.onPermissionResolved = handlers.onPermissionResolved;
  return () => {
    if (conn.callbacks.onSessionUpdate === handlers.onSessionUpdate) {
      conn.callbacks.onSessionUpdate = undefined;
    }
    if (conn.callbacks.onPermissionRequest === handlers.onPermissionRequest) {
      conn.callbacks.onPermissionRequest = undefined;
    }
    if (conn.callbacks.onPermissionResolved === handlers.onPermissionResolved) {
      conn.callbacks.onPermissionResolved = undefined;
    }
  };
}

/* ── Session state folding ───────────────────────────────────────────── */

export function applySessionUpdate(session: AcpSession, update: AcpSessionUpdate): void {
  session.lastActivityAt = new Date().toISOString();
  if (update.type === 'available_commands_update') {
    session.availableCommands = parseAvailableCommands(update.availableCommands);
    return;
  }
  if (update.type === 'current_mode_update' && update.currentModeId) {
    session.currentModeId = update.currentModeId;
    return;
  }
  if (update.type === 'config_option_update' && update.configOptions) {
    session.configOptions = update.configOptions;
    session.currentModeId = currentModeFromConfig(update.configOptions) ?? session.currentModeId;
    return;
  }
  if ((update.type === 'tool_call' || update.type === 'tool_call_update') && update.toolCall) {
    session.toolCalls = upsertToolCall(session.toolCalls, update.toolCall);
    recordArtifactsFromAcpToolCall({
      runtimeId: session.agentId,
      sessionId: session.id,
      ...(session.agentSessionId ? { externalSessionId: session.agentSessionId } : {}),
      ...(session.cwd ? { cwd: session.cwd } : {}),
      toolCall: update.toolCall,
    });
    return;
  }
  if (update.type === 'session_info_update' && update.sessionInfo) {
    session.sessionInfo = {
      ...session.sessionInfo,
      ...update.sessionInfo,
    };
    return;
  }
  if ((update.type === 'permission_request' || update.type === 'permission_resolved') && update.permission) {
    session.permissionEvents = upsertPermissionEvent(session.permissionEvents, update.permission);
  }
}

function upsertToolCall(
  existing: AcpToolCallFull[] | undefined,
  update: AcpToolCallFull,
): AcpToolCallFull[] {
  if (!update.toolCallId) return existing ?? [];
  const next = [...(existing ?? [])];
  const index = next.findIndex((toolCall) => toolCall.toolCallId === update.toolCallId);
  if (index === -1) return [...next, update].slice(-100);
  next[index] = {
    ...next[index],
    ...update,
    status: update.status ?? next[index]!.status,
  };
  return next;
}

function upsertPermissionEvent(
  existing: AcpPermissionEvent[] | undefined,
  update: AcpPermissionEvent,
): AcpPermissionEvent[] {
  const next = [...(existing ?? [])];
  const index = next.findIndex((event) => event.requestId === update.requestId);
  if (index === -1) return [...next, update].slice(-100);
  next[index] = {
    ...next[index],
    ...update,
    options: update.options.length > 0 ? update.options : next[index]!.options,
    requestedAt: next[index]!.requestedAt || update.requestedAt,
  };
  return next;
}

/* ── SDK notification → MindOS update ────────────────────────────────── */

/**
 * Convert SDK SessionNotification to MindOS AcpSessionUpdate.
 * The SDK validates and parses the JSON-RPC notification;
 * we just reshape the typed data for our UI layer.
 */
export function sdkNotificationToUpdate(
  sessionId: string,
  params: SessionNotification,
): AcpSessionUpdate {
  const update = params.update as SessionUpdate & Record<string, unknown>;
  const type = update.sessionUpdate as AcpSessionUpdate['type'];
  const base: AcpSessionUpdate = { sessionId, type };

  switch (type) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk': {
      const content = (update as Record<string, unknown>).content as Record<string, unknown> | undefined;
      if (content?.type === 'text' && typeof content.text === 'string') {
        base.text = content.text;
      } else if (content?.type === 'thinking' && typeof content.text === 'string') {
        base.text = content.text;
      }
      break;
    }

    case 'tool_call':
    case 'tool_call_update': {
      const tc = update as Record<string, unknown>;
      const rawOutputPointers = extractRawOutputPointers(tc.rawOutput ?? tc.raw_output);
      const locations = [
        ...parseToolCallLocations(tc.locations),
        ...rawOutputPointers.locations,
      ];
      base.toolCall = {
        toolCallId: String(tc.toolCallId ?? ''),
        title: typeof tc.title === 'string' ? tc.title : undefined,
        status: (tc.status as 'pending' | 'in_progress' | 'completed' | 'failed') ?? 'pending',
        kind: tc.kind as AcpSessionUpdate['toolCall'] extends { kind: infer K } ? K : undefined,
        rawInput: safeToolRawText(tc.rawInput),
        rawOutput: safeToolRawText(tc.rawOutput ?? tc.raw_output),
        content: parseToolCallContent(tc.content),
        ...(locations.length > 0 ? { locations } : {}),
      };
      break;
    }

    case 'plan': {
      const planData = update as Record<string, unknown>;
      if (Array.isArray(planData.entries)) {
        base.plan = { entries: planData.entries as AcpSessionUpdate['plan'] extends { entries: infer E } ? E : never };
      }
      break;
    }

    case 'available_commands_update':
      base.availableCommands = Array.isArray((update as Record<string, unknown>).availableCommands)
        ? (update as Record<string, unknown>).availableCommands as unknown[]
        : undefined;
      break;

    case 'current_mode_update':
      base.currentModeId = typeof (update as Record<string, unknown>).currentModeId === 'string'
        ? (update as Record<string, unknown>).currentModeId as string
        : undefined;
      break;

    case 'config_option_update':
      base.configOptions = parseConfigOptions((update as Record<string, unknown>).configOptions);
      break;

    case 'session_info_update': {
      const info = update as Record<string, unknown>;
      base.sessionInfo = {
        title: typeof info.title === 'string' ? info.title : undefined,
        updatedAt: typeof info.updatedAt === 'string' ? info.updatedAt : undefined,
      };
      break;
    }
  }

  return base;
}

function safeToolRawText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length > INLINE_IMAGE_RESULT_LIMIT
    && INLINE_IMAGE_PREFIX_RE.test(trimmed)
  ) {
    return undefined;
  }
  const redacted = redactSensitiveText(trimmed);
  return redacted.length > TOOL_RAW_TEXT_LIMIT
    ? `${redacted.slice(0, TOOL_RAW_TEXT_LIMIT)}...`
    : redacted;
}

function parseToolCallLocations(value: unknown): NonNullable<AcpToolCallFull['locations']> {
  if (!Array.isArray(value)) return [];
  const locations: NonNullable<AcpToolCallFull['locations']> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const rawPath = typeof record.path === 'string'
      ? record.path
      : typeof record.uri === 'string' && record.uri.startsWith('file://')
        ? record.uri.slice('file://'.length)
        : '';
    const path = rawPath.trim();
    if (!path) continue;
    const line = typeof record.line === 'number' && Number.isFinite(record.line)
      ? Math.max(1, Math.floor(record.line))
      : undefined;
    const key = `${path}:${line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ path, ...(line ? { line } : {}) });
    if (locations.length >= 50) break;
  }
  return locations;
}

function parseToolCallContent(value: unknown): AcpContentBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks: AcpContentBlock[] = [];
  for (const item of value) {
    const block = parseToolCallContentBlock(item);
    if (block) blocks.push(block);
    if (blocks.length >= 50) break;
  }
  return blocks.length > 0 ? blocks : undefined;
}

function parseToolCallContentBlock(value: unknown): AcpContentBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'resource_link' && typeof record.uri === 'string') {
    return {
      type: 'resource_link',
      uri: record.uri,
      name: typeof record.name === 'string' && record.name.trim() ? record.name : 'resource',
    };
  }
  if (record.type === 'resource') {
    const resource = record.resource;
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return null;
    const resourceRecord = resource as Record<string, unknown>;
    if (typeof resourceRecord.uri !== 'string') return null;
    return {
      type: 'resource',
      resource: {
        uri: resourceRecord.uri,
        ...(typeof resourceRecord.text === 'string' ? { text: safeToolRawText(resourceRecord.text) ?? '' } : {}),
      },
    };
  }
  return null;
}

function extractRawOutputPointers(value: unknown): {
  locations: NonNullable<AcpToolCallFull['locations']>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { locations: [] };
  const record = value as Record<string, unknown>;
  const candidates = [
    record.saved_path,
    record.savedPath,
    readNestedString(record.image, 'path'),
    readNestedString(record.artifact, 'path'),
  ];
  const locations = candidates
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => ({ path: candidate.trim() }));
  return { locations };
}

function readNestedString(value: unknown, key: string): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === 'string'
    ? (value as Record<string, string>)[key]
    : undefined;
}
