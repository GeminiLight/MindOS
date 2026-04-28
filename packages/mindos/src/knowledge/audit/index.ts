import type { Result } from '../../foundation/shared/index.js';
import { createError } from '../../foundation/errors/index.js';
import type { IFileSystem } from '../storage/index.js';
import * as path from 'path';

// Helper functions for Result type
function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: Error): Result<T> {
  return { ok: false, error };
}

// ============================================================================
// Content Changes
// ============================================================================

export type ContentChangeSource = 'user' | 'agent' | 'system';

export interface ContentChangeEvent {
  id: string;
  ts: string;
  op: string;
  path: string;
  source: ContentChangeSource;
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
  truncated?: boolean;
}

export interface ContentChangeInput {
  op: string;
  path: string;
  source: ContentChangeSource;
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
}

interface ChangeLogState {
  version: 1;
  lastSeenAt: string | null;
  events: ContentChangeEvent[];
  legacy?: {
    agentDiffImportedCount?: number;
    lastImportedAt?: string | null;
  };
}

interface ListOptions {
  path?: string;
  limit?: number;
  source?: ContentChangeSource;
  op?: string;
  q?: string;
}

export interface ContentChangeSummary {
  unreadCount: number;
  totalCount: number;
  lastSeenAt: string | null;
  latest: ContentChangeEvent | null;
}

const LOG_DIR_NAME = '.mindos';
const CHANGE_LOG_FILE_NAME = 'change-log.json';
const MAX_EVENTS = 500;
const MAX_TEXT_CHARS = 12_000;

function nowIso() {
  return new Date().toISOString();
}

function changeLogPath(mindRoot: string) {
  return path.join(mindRoot, LOG_DIR_NAME, CHANGE_LOG_FILE_NAME);
}

function defaultChangeLogState(): ChangeLogState {
  return {
    version: 1,
    lastSeenAt: null,
    events: [],
    legacy: {
      agentDiffImportedCount: 0,
      lastImportedAt: null,
    },
  };
}

function normalizeText(value: string | undefined): { value: string | undefined; truncated: boolean } {
  if (typeof value !== 'string') return { value: undefined, truncated: false };
  if (value.length <= MAX_TEXT_CHARS) return { value, truncated: false };
  return {
    value: value.slice(0, MAX_TEXT_CHARS),
    truncated: true,
  };
}

async function readChangeLogState(fs: IFileSystem, mindRoot: string): Promise<ChangeLogState> {
  const file = changeLogPath(mindRoot);
  const existsResult = await fs.exists(file);
  if (!existsResult.ok || !existsResult.value) {
    return defaultChangeLogState();
  }

  const readResult = await fs.readFile(file);
  if (!readResult.ok) {
    return defaultChangeLogState();
  }

  try {
    const parsed = JSON.parse(readResult.value) as Partial<ChangeLogState>;
    if (!Array.isArray(parsed.events)) return defaultChangeLogState();
    return {
      version: 1,
      lastSeenAt: typeof parsed.lastSeenAt === 'string' ? parsed.lastSeenAt : null,
      events: parsed.events,
      legacy: {
        agentDiffImportedCount:
          typeof parsed.legacy?.agentDiffImportedCount === 'number'
            ? parsed.legacy.agentDiffImportedCount
            : 0,
        lastImportedAt:
          typeof parsed.legacy?.lastImportedAt === 'string'
            ? parsed.legacy.lastImportedAt
            : null,
      },
    };
  } catch {
    return defaultChangeLogState();
  }
}

async function writeChangeLogState(fs: IFileSystem, mindRoot: string, state: ChangeLogState): Promise<Result<void>> {
  const file = changeLogPath(mindRoot);
  const dir = path.dirname(file);

  const mkdirResult = await fs.mkdir(dir, true);
  if (!mkdirResult.ok) {
    return err(mkdirResult.error);
  }

  return await fs.writeFile(file, JSON.stringify(state, null, 2));
}

interface LegacyAgentDiffEntry {
  ts?: string;
  path?: string;
  tool?: string;
  before?: string;
  after?: string;
}

function parseLegacyAgentDiffBlocks(content: string): LegacyAgentDiffEntry[] {
  const blocks: LegacyAgentDiffEntry[] = [];
  const re = /```agent-diff\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1]) continue;
    try {
      const parsed = JSON.parse(m[1].trim()) as LegacyAgentDiffEntry;
      blocks.push(parsed);
    } catch {
      // Skip malformed block
    }
  }
  return blocks;
}

function toValidIso(ts: string | undefined): string {
  if (!ts) return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

async function importLegacyAgentDiffIfNeeded(
  fs: IFileSystem,
  mindRoot: string,
  state: ChangeLogState
): Promise<ChangeLogState> {
  const legacyPath = path.join(mindRoot, 'Agent-Diff.md');
  const existsResult = await fs.exists(legacyPath);
  if (!existsResult.ok || !existsResult.value) {
    return state;
  }

  const readResult = await fs.readFile(legacyPath);
  if (!readResult.ok) {
    return state;
  }

  const blocks = parseLegacyAgentDiffBlocks(readResult.value);
  const importedCount = state.legacy?.agentDiffImportedCount ?? 0;
  if (blocks.length <= importedCount) {
    // Already migrated: remove legacy file
    if (blocks.length > 0) {
      await fs.remove(legacyPath);
    }
    return state;
  }

  const incoming = blocks.slice(importedCount);
  const importedEvents: ContentChangeEvent[] = incoming.map((entry, idx) => {
    const before = normalizeText(entry.before);
    const after = normalizeText(entry.after);
    const toolName = typeof entry.tool === 'string' && entry.tool.trim()
      ? entry.tool.trim()
      : 'unknown-tool';
    const targetPath = typeof entry.path === 'string' && entry.path.trim()
      ? entry.path
      : 'Agent-Diff.md';
    return {
      id: `legacy-${Date.now().toString(36)}-${idx.toString(36)}`,
      ts: toValidIso(entry.ts),
      op: 'legacy_agent_diff_import',
      path: targetPath,
      source: 'agent' as ContentChangeSource,
      summary: `Imported legacy agent diff (${toolName})`,
      before: before.value,
      after: after.value,
      truncated: before.truncated || after.truncated || undefined,
    };
  });

  const merged = [...state.events, ...importedEvents].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
  );

  const nextState = {
    ...state,
    events: merged.slice(0, MAX_EVENTS),
    legacy: {
      agentDiffImportedCount: blocks.length,
      lastImportedAt: nowIso(),
    },
  };

  await fs.remove(legacyPath);
  return nextState;
}

async function loadChangeLogState(fs: IFileSystem, mindRoot: string): Promise<ChangeLogState> {
  const state = await readChangeLogState(fs, mindRoot);
  const migrated = await importLegacyAgentDiffIfNeeded(fs, mindRoot, state);
  const changed =
    (state.legacy?.agentDiffImportedCount ?? 0) !== (migrated.legacy?.agentDiffImportedCount ?? 0) ||
    state.events.length !== migrated.events.length;
  if (changed) {
    await writeChangeLogState(fs, mindRoot, migrated);
  }
  return migrated;
}

export async function appendContentChange(
  fs: IFileSystem,
  mindRoot: string,
  input: ContentChangeInput
): Promise<Result<ContentChangeEvent>> {
  const state = await loadChangeLogState(fs, mindRoot);
  const before = normalizeText(input.before);
  const after = normalizeText(input.after);
  const event: ContentChangeEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: nowIso(),
    op: input.op,
    path: input.path,
    source: input.source,
    summary: input.summary,
    before: before.value,
    after: after.value,
    beforePath: input.beforePath,
    afterPath: input.afterPath,
    truncated: before.truncated || after.truncated || undefined,
  };
  state.events.unshift(event);
  if (state.events.length > MAX_EVENTS) {
    state.events = state.events.slice(0, MAX_EVENTS);
  }
  const writeResult = await writeChangeLogState(fs, mindRoot, state);
  if (!writeResult.ok) {
    return err(writeResult.error);
  }
  return ok(event);
}

export async function listContentChanges(
  fs: IFileSystem,
  mindRoot: string,
  options: ListOptions = {}
): Promise<Result<ContentChangeEvent[]>> {
  const state = await loadChangeLogState(fs, mindRoot);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const pathFilter = options.path?.trim();
  const sourceFilter = options.source;
  const opFilter = options.op?.trim();
  const q = options.q?.trim().toLowerCase();
  const events = state.events.filter((event) => {
    if (pathFilter && event.path !== pathFilter && event.beforePath !== pathFilter && event.afterPath !== pathFilter) {
      return false;
    }
    if (sourceFilter && event.source !== sourceFilter) return false;
    if (opFilter && event.op !== opFilter) return false;
    if (q) {
      const haystack = `${event.path} ${event.beforePath ?? ''} ${event.afterPath ?? ''} ${event.summary} ${event.op} ${event.source}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  return ok(events.slice(0, limit));
}

export async function markContentChangesSeen(
  fs: IFileSystem,
  mindRoot: string
): Promise<Result<void>> {
  const state = await loadChangeLogState(fs, mindRoot);
  state.lastSeenAt = nowIso();
  return await writeChangeLogState(fs, mindRoot, state);
}

export async function getContentChangeSummary(
  fs: IFileSystem,
  mindRoot: string
): Promise<Result<ContentChangeSummary>> {
  const state = await loadChangeLogState(fs, mindRoot);
  const lastSeenAtMs = state.lastSeenAt ? new Date(state.lastSeenAt).getTime() : 0;
  const unreadCount = state.events.filter((event) => new Date(event.ts).getTime() > lastSeenAtMs).length;
  return ok({
    unreadCount,
    totalCount: state.events.length,
    lastSeenAt: state.lastSeenAt,
    latest: state.events[0] ?? null,
  });
}

// ============================================================================
// Agent Audit Log
// ============================================================================

export interface AgentAuditEvent {
  id: string;
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  agentName?: string;
  op?: 'append' | 'legacy_agent_audit_md_import' | 'legacy_agent_log_jsonl_import';
}

export interface AgentAuditInput {
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  agentName?: string;
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

const AUDIT_LOG_FILE_NAME = 'agent-audit-log.json';
const LEGACY_MD_FILE = 'Agent-Audit.md';
const LEGACY_JSONL_FILE = '.agent-log.json';
const MAX_AUDIT_EVENTS = 1000;
const MAX_MESSAGE_CHARS = 2000;

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

function defaultAuditState(): AgentAuditState {
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

function auditLogPath(mindRoot: string) {
  return path.join(mindRoot, LOG_DIR_NAME, AUDIT_LOG_FILE_NAME);
}

async function readAuditState(fs: IFileSystem, mindRoot: string): Promise<AgentAuditState> {
  const file = auditLogPath(mindRoot);
  const existsResult = await fs.exists(file);
  if (!existsResult.ok || !existsResult.value) {
    return defaultAuditState();
  }

  const readResult = await fs.readFile(file);
  if (!readResult.ok) {
    return defaultAuditState();
  }

  try {
    const parsed = JSON.parse(readResult.value) as Partial<AgentAuditState>;
    if (!Array.isArray(parsed.events)) return defaultAuditState();
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
    return defaultAuditState();
  }
}

async function writeAuditState(fs: IFileSystem, mindRoot: string, state: AgentAuditState): Promise<Result<void>> {
  const file = auditLogPath(mindRoot);
  const dir = path.dirname(file);

  const mkdirResult = await fs.mkdir(dir, true);
  if (!mkdirResult.ok) {
    return err(mkdirResult.error);
  }

  return await fs.writeFile(file, JSON.stringify(state, null, 2));
}

interface LegacyAgentOp {
  ts?: string;
  tool?: string;
  params?: Record<string, unknown>;
  result?: 'ok' | 'error';
  message?: string;
  durationMs?: number;
  agentName?: string;
}

function parseLegacyMdBlocks(raw: string): LegacyAgentOp[] {
  const blocks: LegacyAgentOp[] = [];
  const re = /```agent-op\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (!match[1]) continue;
    try {
      blocks.push(JSON.parse(match[1].trim()) as LegacyAgentOp);
    } catch {
      // Ignore malformed blocks
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
      // Ignore malformed lines
    }
  }
  return entries;
}

function toAuditEvent(entry: LegacyAgentOp, op: AgentAuditEvent['op'], idx: number): AgentAuditEvent {
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

async function importLegacyMdIfNeeded(
  fs: IFileSystem,
  mindRoot: string,
  state: AgentAuditState
): Promise<AgentAuditState> {
  const legacyPath = path.join(mindRoot, LEGACY_MD_FILE);
  const existsResult = await fs.exists(legacyPath);
  if (!existsResult.ok || !existsResult.value) {
    return state;
  }

  const readResult = await fs.readFile(legacyPath);
  if (!readResult.ok) {
    return state;
  }

  const blocks = parseLegacyMdBlocks(readResult.value);
  const importedCount = state.legacy?.mdImportedCount ?? 0;
  if (blocks.length <= importedCount) {
    if (blocks.length > 0) await fs.remove(legacyPath);
    return state;
  }

  const incoming = blocks.slice(importedCount);
  const imported = incoming.map((entry, idx) => toAuditEvent(entry, 'legacy_agent_audit_md_import', idx));
  const merged = [...state.events, ...imported]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_AUDIT_EVENTS);

  const next = {
    ...state,
    events: merged,
    legacy: {
      mdImportedCount: blocks.length,
      jsonlImportedCount: state.legacy?.jsonlImportedCount ?? 0,
      lastImportedAt: nowIso(),
    },
  };
  await fs.remove(legacyPath);
  return next;
}

async function importLegacyJsonlIfNeeded(
  fs: IFileSystem,
  mindRoot: string,
  state: AgentAuditState
): Promise<AgentAuditState> {
  const legacyPath = path.join(mindRoot, LEGACY_JSONL_FILE);
  const existsResult = await fs.exists(legacyPath);
  if (!existsResult.ok || !existsResult.value) {
    return state;
  }

  const readResult = await fs.readFile(legacyPath);
  if (!readResult.ok) {
    return state;
  }

  const lines = parseJsonLines(readResult.value);
  const importedCount = state.legacy?.jsonlImportedCount ?? 0;
  if (lines.length <= importedCount) {
    if (lines.length > 0) await fs.remove(legacyPath);
    return state;
  }

  const incoming = lines.slice(importedCount);
  const imported = incoming.map((entry, idx) => toAuditEvent(entry, 'legacy_agent_log_jsonl_import', idx));
  const merged = [...state.events, ...imported]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, MAX_AUDIT_EVENTS);

  const next = {
    ...state,
    events: merged,
    legacy: {
      mdImportedCount: state.legacy?.mdImportedCount ?? 0,
      jsonlImportedCount: lines.length,
      lastImportedAt: nowIso(),
    },
  };
  await fs.remove(legacyPath);
  return next;
}

async function loadAuditState(fs: IFileSystem, mindRoot: string): Promise<AgentAuditState> {
  const base = await readAuditState(fs, mindRoot);
  const mdMigrated = await importLegacyMdIfNeeded(fs, mindRoot, base);
  const migrated = await importLegacyJsonlIfNeeded(fs, mindRoot, mdMigrated);
  const changed =
    base.events.length !== migrated.events.length ||
    (base.legacy?.mdImportedCount ?? 0) !== (migrated.legacy?.mdImportedCount ?? 0) ||
    (base.legacy?.jsonlImportedCount ?? 0) !== (migrated.legacy?.jsonlImportedCount ?? 0);
  if (changed) await writeAuditState(fs, mindRoot, migrated);
  return migrated;
}

export async function appendAgentAuditEvent(
  fs: IFileSystem,
  mindRoot: string,
  input: AgentAuditInput
): Promise<Result<AgentAuditEvent>> {
  const state = await loadAuditState(fs, mindRoot);
  const event: AgentAuditEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: validIso(input.ts),
    tool: input.tool,
    params: input.params && typeof input.params === 'object' ? input.params : {},
    result: input.result === 'error' ? 'error' : 'ok',
    message: normalizeMessage(input.message),
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
    agentName: typeof input.agentName === 'string' && input.agentName.trim() ? input.agentName.trim() : undefined,
    op: 'append',
  };
  state.events.unshift(event);
  if (state.events.length > MAX_AUDIT_EVENTS) state.events = state.events.slice(0, MAX_AUDIT_EVENTS);
  const writeResult = await writeAuditState(fs, mindRoot, state);
  if (!writeResult.ok) {
    return err(writeResult.error);
  }
  return ok(event);
}

export async function listAgentAuditEvents(
  fs: IFileSystem,
  mindRoot: string,
  limit = 100
): Promise<Result<AgentAuditEvent[]>> {
  const state = await loadAuditState(fs, mindRoot);
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  return ok(state.events.slice(0, safeLimit));
}

export function parseAgentAuditJsonLines(raw: string): AgentAuditInput[] {
  return parseJsonLines(raw).map((entry) => ({
    ts: validIso(entry.ts),
    tool: typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool',
    params: entry.params && typeof entry.params === 'object' ? entry.params : {},
    result: entry.result === 'error' ? 'error' : 'ok',
    message: normalizeMessage(entry.message),
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
    agentName: typeof entry.agentName === 'string' ? entry.agentName : undefined,
  }));
}
