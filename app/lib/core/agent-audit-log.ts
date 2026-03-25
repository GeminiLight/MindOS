import fs from 'fs';
import path from 'path';

export interface AgentAuditEvent {
  id: string;
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  op?: 'append' | 'legacy_agent_audit_md_import' | 'legacy_agent_log_jsonl_import';
}

export interface AgentAuditInput {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
}

interface AgentAuditState {
  version: 1;
  events: AgentAuditEvent[];
  legacy?: {
    mdImportedCount?: number;
    jsonlImportedCount?: number;
    lastImportedAt?: string | null;
  };
}

const LOG_DIR_NAME = '.mindos';
const LOG_FILE_NAME = 'agent-audit-log.json';
const LEGACY_MD_FILE = 'Agent-Audit.md';
const LEGACY_JSONL_FILE = '.agent-log.json';
const MAX_EVENTS = 1000;
const MAX_MESSAGE_CHARS = 2000;

function nowIso() {
  return new Date().toISOString();
}

function validIso(ts: string | undefined): string {
  if (!ts) return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function normalizeMessage(message: string | undefined): string | undefined {
  if (typeof message !== 'string') return undefined;
  if (message.length <= MAX_MESSAGE_CHARS) return message;
  return message.slice(0, MAX_MESSAGE_CHARS);
}

function defaultState(): AgentAuditState {
  return {
    version: 1,
    events: [],
    legacy: {
      mdImportedCount: 0,
      jsonlImportedCount: 0,
      lastImportedAt: null,
    },
  };
}

function logPath(mindRoot: string) {
  return path.join(mindRoot, LOG_DIR_NAME, LOG_FILE_NAME);
}

function readState(mindRoot: string): AgentAuditState {
  const file = logPath(mindRoot);
  try {
    if (!fs.existsSync(file)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<AgentAuditState>;
    if (!Array.isArray(parsed.events)) return defaultState();
    return {
      version: 1,
      events: parsed.events,
      legacy: {
        mdImportedCount: typeof parsed.legacy?.mdImportedCount === 'number' ? parsed.legacy.mdImportedCount : 0,
        jsonlImportedCount: typeof parsed.legacy?.jsonlImportedCount === 'number' ? parsed.legacy.jsonlImportedCount : 0,
        lastImportedAt: typeof parsed.legacy?.lastImportedAt === 'string' ? parsed.legacy.lastImportedAt : null,
      },
    };
  } catch {
    return defaultState();
  }
}

function writeState(mindRoot: string, state: AgentAuditState): void {
  const file = logPath(mindRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

function removeLegacyFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Keep migration best-effort.
  }
}

interface LegacyAgentOp {
  ts?: string;
  tool?: string;
  params?: Record<string, unknown>;
  result?: 'ok' | 'error';
  message?: string;
  durationMs?: number;
}

function parseLegacyMdBlocks(raw: string): LegacyAgentOp[] {
  const blocks: LegacyAgentOp[] = [];
  const re = /```agent-op\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()) as LegacyAgentOp);
    } catch {
      // Ignore malformed blocks.
    }
  }
  return blocks;
}

function parseJsonLines(raw: string): LegacyAgentOp[] {
  const entries: LegacyAgentOp[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    try {
      entries.push(JSON.parse(trimmed) as LegacyAgentOp);
    } catch {
      // Ignore malformed lines.
    }
  }
  return entries;
}

function toEvent(entry: LegacyAgentOp, op: AgentAuditEvent['op'], idx: number): AgentAuditEvent {
  const tool = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool';
  const result = entry.result === 'error' ? 'error' : 'ok';
  const params = entry.params && typeof entry.params === 'object' ? entry.params : {};
  return {
    id: `legacy-${Date.now().toString(36)}-${idx.toString(36)}`,
    ts: validIso(entry.ts),
    tool,
    params,
    result,
    message: normalizeMessage(entry.message),
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
    op,
  };
}

function importLegacyMdIfNeeded(mindRoot: string, state: AgentAuditState): AgentAuditState {
  const legacyPath = path.join(mindRoot, LEGACY_MD_FILE);
  if (!fs.existsSync(legacyPath)) return state;

  let raw = '';
  try {
    raw = fs.readFileSync(legacyPath, 'utf-8');
  } catch {
    return state;
  }

  const blocks = parseLegacyMdBlocks(raw);
  const importedCount = state.legacy?.mdImportedCount ?? 0;
  if (blocks.length <= importedCount) {
    if (blocks.length > 0) removeLegacyFile(legacyPath);
    return state;
  }

  const incoming = blocks.slice(importedCount);
  const imported = incoming.map((entry, idx) => toEvent(entry, 'legacy_agent_audit_md_import', idx));
  const merged = [...state.events, ...imported]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_EVENTS);

  const next = {
    ...state,
    events: merged,
    legacy: {
      mdImportedCount: blocks.length,
      jsonlImportedCount: state.legacy?.jsonlImportedCount ?? 0,
      lastImportedAt: nowIso(),
    },
  };
  removeLegacyFile(legacyPath);
  return next;
}

function importLegacyJsonlIfNeeded(mindRoot: string, state: AgentAuditState): AgentAuditState {
  const legacyPath = path.join(mindRoot, LEGACY_JSONL_FILE);
  if (!fs.existsSync(legacyPath)) return state;

  let raw = '';
  try {
    raw = fs.readFileSync(legacyPath, 'utf-8');
  } catch {
    return state;
  }

  const lines = parseJsonLines(raw);
  const importedCount = state.legacy?.jsonlImportedCount ?? 0;
  if (lines.length <= importedCount) {
    if (lines.length > 0) removeLegacyFile(legacyPath);
    return state;
  }

  const incoming = lines.slice(importedCount);
  const imported = incoming.map((entry, idx) => toEvent(entry, 'legacy_agent_log_jsonl_import', idx));
  const merged = [...state.events, ...imported]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_EVENTS);

  const next = {
    ...state,
    events: merged,
    legacy: {
      mdImportedCount: state.legacy?.mdImportedCount ?? 0,
      jsonlImportedCount: lines.length,
      lastImportedAt: nowIso(),
    },
  };
  removeLegacyFile(legacyPath);
  return next;
}

function loadState(mindRoot: string): AgentAuditState {
  const base = readState(mindRoot);
  const mdMigrated = importLegacyMdIfNeeded(mindRoot, base);
  const migrated = importLegacyJsonlIfNeeded(mindRoot, mdMigrated);
  const changed =
    base.events.length !== migrated.events.length ||
    (base.legacy?.mdImportedCount ?? 0) !== (migrated.legacy?.mdImportedCount ?? 0) ||
    (base.legacy?.jsonlImportedCount ?? 0) !== (migrated.legacy?.jsonlImportedCount ?? 0);
  if (changed) writeState(mindRoot, migrated);
  return migrated;
}

export function appendAgentAuditEvent(mindRoot: string, input: AgentAuditInput): AgentAuditEvent {
  const state = loadState(mindRoot);
  const event: AgentAuditEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: validIso(input.ts),
    tool: input.tool,
    params: input.params && typeof input.params === 'object' ? input.params : {},
    result: input.result === 'error' ? 'error' : 'ok',
    message: normalizeMessage(input.message),
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
    op: 'append',
  };
  state.events.unshift(event);
  if (state.events.length > MAX_EVENTS) state.events = state.events.slice(0, MAX_EVENTS);
  writeState(mindRoot, state);
  return event;
}

export function listAgentAuditEvents(mindRoot: string, limit = 100): AgentAuditEvent[] {
  const state = loadState(mindRoot);
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  return state.events.slice(0, safeLimit);
}

export function parseAgentAuditJsonLines(raw: string): AgentAuditInput[] {
  return parseJsonLines(raw).map((entry) => ({
    ts: validIso(entry.ts),
    tool: typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool',
    params: entry.params && typeof entry.params === 'object' ? entry.params : {},
    result: entry.result === 'error' ? 'error' : 'ok',
    message: normalizeMessage(entry.message),
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
  }));
}

