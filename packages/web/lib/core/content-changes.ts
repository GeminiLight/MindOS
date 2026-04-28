import fs from 'fs';
import path from 'path';

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
const LOG_FILE_NAME = 'change-log.json';
const MAX_EVENTS = 500;
const MAX_TEXT_CHARS = 12_000;

function nowIso() {
  return new Date().toISOString();
}

function changeLogPath(mindRoot: string) {
  return path.join(mindRoot, LOG_DIR_NAME, LOG_FILE_NAME);
}

function defaultState(): ChangeLogState {
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

function readState(mindRoot: string): ChangeLogState {
  const file = changeLogPath(mindRoot);
  try {
    if (!fs.existsSync(file)) return defaultState();
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ChangeLogState>;
    if (!Array.isArray(parsed.events)) return defaultState();
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
    return defaultState();
  }
}

function writeState(mindRoot: string, state: ChangeLogState): void {
  const file = changeLogPath(mindRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
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
    try {
      const parsed = JSON.parse(m[1].trim()) as LegacyAgentDiffEntry;
      blocks.push(parsed);
    } catch {
      // Skip malformed block, keep import best-effort.
    }
  }
  return blocks;
}

function toValidIso(ts: string | undefined): string {
  if (!ts) return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function removeLegacyFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // keep best-effort; migration should not fail main flow.
  }
}

function importLegacyAgentDiffIfNeeded(mindRoot: string, state: ChangeLogState): ChangeLogState {
  const legacyPath = path.join(mindRoot, 'Agent-Diff.md');
  if (!fs.existsSync(legacyPath)) return state;

  let raw = '';
  try {
    raw = fs.readFileSync(legacyPath, 'utf-8');
  } catch {
    return state;
  }

  const blocks = parseLegacyAgentDiffBlocks(raw);
  const importedCount = state.legacy?.agentDiffImportedCount ?? 0;
  if (blocks.length <= importedCount) {
    // Already migrated before: remove legacy file to avoid stale duplicate source.
    if (blocks.length > 0) removeLegacyFile(legacyPath);
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
      source: 'agent',
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
  removeLegacyFile(legacyPath);
  return nextState;
}

function loadState(mindRoot: string): ChangeLogState {
  const state = readState(mindRoot);
  const migrated = importLegacyAgentDiffIfNeeded(mindRoot, state);
  const changed =
    (state.legacy?.agentDiffImportedCount ?? 0) !== (migrated.legacy?.agentDiffImportedCount ?? 0) ||
    state.events.length !== migrated.events.length;
  if (changed) {
    writeState(mindRoot, migrated);
  }
  return migrated;
}

export function appendContentChange(mindRoot: string, input: ContentChangeInput): ContentChangeEvent {
  const state = loadState(mindRoot);
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
  writeState(mindRoot, state);
  return event;
}

export function listContentChanges(mindRoot: string, options: ListOptions = {}): ContentChangeEvent[] {
  const state = loadState(mindRoot);
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
  return events.slice(0, limit);
}

export function markContentChangesSeen(mindRoot: string): void {
  const state = loadState(mindRoot);
  state.lastSeenAt = nowIso();
  writeState(mindRoot, state);
}

export function getContentChangeSummary(mindRoot: string): ContentChangeSummary {
  const state = loadState(mindRoot);
  const lastSeenAtMs = state.lastSeenAt ? new Date(state.lastSeenAt).getTime() : 0;
  const unreadCount = state.events.filter((event) => new Date(event.ts).getTime() > lastSeenAtMs).length;
  return {
    unreadCount,
    totalCount: state.events.length,
    lastSeenAt: state.lastSeenAt,
    latest: state.events[0] ?? null,
  };
}
