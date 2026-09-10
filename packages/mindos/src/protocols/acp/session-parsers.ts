/**
 * ACP session response parsers — reshape the loosely typed initialize /
 * session/new / session/load payloads into MindOS session facts.
 */

import type {
  AcpAgentCapabilities,
  AcpAuthMethod,
  AcpAvailableCommand,
  AcpConfigOption,
  AcpMode,
  AcpSessionInfo,
} from './types.js';
import { isAcpCapabilitySupported } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return undefined;
}

export function normalizeAcpSessionInfo(value: unknown, fallbackSessionId?: string): AcpSessionInfo {
  const record = isRecord(value) ? value : {};
  const sessionId = stringField(record, ['sessionId', 'session_id', 'id', 'externalSessionId'])
    ?? fallbackSessionId
    ?? '';
  const info: AcpSessionInfo = { sessionId };

  const title = stringField(record, ['title', 'name', 'summary']);
  if (title) info.title = title;
  const preview = stringField(record, ['preview', 'description', 'subtitle']);
  if (preview) info.preview = preview;
  const cwd = stringField(record, ['cwd', 'workDir', 'workingDirectory']);
  if (cwd) info.cwd = cwd;
  const createdAt = stringField(record, ['createdAt', 'created_at']);
  if (createdAt) info.createdAt = createdAt;
  const updatedAt = stringField(record, ['updatedAt', 'updated_at', 'lastActivityAt']);
  if (updatedAt) info.updatedAt = updatedAt;
  const status = stringField(record, ['status', 'state']);
  if (status) info.status = status;

  const messageCount = numberField(record, ['messageCount', 'messagesCount', 'message_count']);
  if (messageCount !== undefined) info.messageCount = messageCount;
  const turnCount = numberField(record, ['turnCount', 'turnsCount', 'turn_count']);
  if (turnCount !== undefined) info.turnCount = turnCount;

  if (Array.isArray(record.messages)) info.messages = record.messages;
  if (Array.isArray(record.turns)) info.turns = record.turns;
  return info;
}

/* ── Capabilities ─────────────────────────────────────────────────────── */

export function parseAgentCapabilities(raw: unknown): AcpAgentCapabilities | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    loadSession: obj.loadSession === true,
    mcpCapabilities: parseMcpCapabilities(obj.mcpCapabilities),
    promptCapabilities: typeof obj.promptCapabilities === 'object' ? obj.promptCapabilities as AcpAgentCapabilities['promptCapabilities'] : undefined,
    sessionCapabilities: parseSessionCapabilities(obj.sessionCapabilities),
  };
}

function parseMcpCapabilities(raw: unknown): AcpAgentCapabilities['mcpCapabilities'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return compactBooleans({
    stdio: capabilityFlag(obj.stdio),
    http: capabilityFlag(obj.http),
    sse: capabilityFlag(obj.sse),
    acp: capabilityFlag(obj.acp),
  });
}

function parseSessionCapabilities(raw: unknown): AcpAgentCapabilities['sessionCapabilities'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return compactBooleans({
    list: capabilityFlag(obj.list),
    delete: capabilityFlag(obj.delete),
    resume: capabilityFlag(obj.resume),
    fork: capabilityFlag(obj.fork),
    close: capabilityFlag(obj.close),
  });
}

function capabilityFlag(value: unknown): boolean | undefined {
  if (value === true || isAcpCapabilitySupported(value)) return true;
  if (value === false) return false;
  return undefined;
}

function compactBooleans<T extends Record<string, boolean | undefined>>(value: T): { [K in keyof T]?: boolean } | undefined {
  const entries = Object.entries(value).filter((entry): entry is [keyof T & string, boolean] => typeof entry[1] === 'boolean');
  return entries.length > 0 ? Object.fromEntries(entries) as { [K in keyof T]?: boolean } : undefined;
}

/* ── Auth / modes / config ────────────────────────────────────────────── */

export function parseAuthMethods(raw: unknown): AcpAuthMethod[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? ''),
      description: typeof m.description === 'string' ? m.description : undefined,
    }))
    .filter(m => m.id && m.name);
}

export function parseModes(raw: unknown): AcpMode[] | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.availableModes)) {
      return parseModes(obj.availableModes);
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? ''),
      description: typeof m.description === 'string' ? m.description : undefined,
    }))
    .filter(m => m.id && m.name);
}

export function parseCurrentModeId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.currentModeId === 'string' && obj.currentModeId.trim()) return obj.currentModeId.trim();
  const currentMode = obj.currentMode;
  if (currentMode && typeof currentMode === 'object' && !Array.isArray(currentMode)) {
    const id = (currentMode as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return undefined;
}

export function parseConfigOptions(raw: unknown): AcpConfigOption[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map(o => ({
      type: 'select' as const,
      configId: String(o.configId ?? o.id ?? ''),
      category: String(o.category ?? 'other'),
      label: typeof o.label === 'string' ? o.label : typeof o.name === 'string' ? o.name : undefined,
      currentValue: String(o.currentValue ?? ''),
      options: parseConfigOptionEntries(o.options),
    }))
    .filter(o => o.configId);
}

function parseConfigOptionEntries(raw: unknown): AcpConfigOption['options'] {
  if (!Array.isArray(raw)) return [];
  const entries: AcpConfigOption['options'] = [];
  const pushEntry = (option: unknown) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return;
    const record = option as Record<string, unknown>;
    const id = String(record.id ?? record.value ?? '').trim();
    const label = String(record.label ?? record.name ?? id).trim();
    if (id) entries.push({ id, label: label || id });
  };
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item) && Array.isArray((item as Record<string, unknown>).options)) {
      for (const nested of (item as Record<string, unknown>).options as unknown[]) {
        pushEntry(nested);
      }
      continue;
    }
    pushEntry(item);
  }
  return entries;
}

export function parseAvailableCommands(raw: unknown): AcpAvailableCommand[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const commands: AcpAvailableCommand[] = [];
  for (const entry of raw) {
    const command = normalizeAvailableCommand(entry);
    if (!command || seen.has(command.id)) continue;
    seen.add(command.id);
    commands.push(command);
    if (commands.length >= 100) break;
  }
  return commands;
}

function normalizeAvailableCommand(entry: unknown): AcpAvailableCommand | null {
  if (typeof entry === 'string') {
    const name = entry.trim().replace(/^\//, '');
    return name ? { id: name, name } : null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const rawName = record.name ?? record.id ?? record.command ?? record.title;
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim().replace(/^\//, '');
  if (!name) return null;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim().replace(/^\//, '')
    : name;
  const description = typeof record.description === 'string' && record.description.trim()
    ? record.description.trim().slice(0, 300)
    : undefined;
  return {
    id,
    name,
    ...(description ? { description } : {}),
  };
}

export function currentModeFromConfig(configOptions: AcpConfigOption[] | undefined): string | undefined {
  const option = findConfigOption(configOptions ?? [], 'mode');
  return option?.currentValue?.trim() || undefined;
}

export function findConfigOption(configOptions: AcpConfigOption[], category: string): AcpConfigOption | undefined {
  return configOptions.find((option) => {
    const optionCategory = option.category.toLowerCase();
    const configId = option.configId.toLowerCase();
    if (category === 'thought_level') {
      return optionCategory === 'thought_level'
        || optionCategory === 'reasoning'
        || configId === 'thought_level'
        || configId === 'thinking'
        || configId === 'reasoning_effort';
    }
    return optionCategory === category || configId === category;
  });
}
