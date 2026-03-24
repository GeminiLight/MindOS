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
}

interface ListOptions {
  path?: string;
  limit?: number;
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

export function appendContentChange(mindRoot: string, input: ContentChangeInput): ContentChangeEvent {
  const state = readState(mindRoot);
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
  const state = readState(mindRoot);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const pathFilter = options.path;
  const events = pathFilter
    ? state.events.filter((event) => event.path === pathFilter || event.beforePath === pathFilter || event.afterPath === pathFilter)
    : state.events;
  return events.slice(0, limit);
}

export function markContentChangesSeen(mindRoot: string): void {
  const state = readState(mindRoot);
  state.lastSeenAt = nowIso();
  writeState(mindRoot, state);
}

export function getContentChangeSummary(mindRoot: string): ContentChangeSummary {
  const state = readState(mindRoot);
  const lastSeenAtMs = state.lastSeenAt ? new Date(state.lastSeenAt).getTime() : 0;
  const unreadCount = state.events.filter((event) => new Date(event.ts).getTime() > lastSeenAtMs).length;
  return {
    unreadCount,
    totalCount: state.events.length,
    lastSeenAt: state.lastSeenAt,
    latest: state.events[0] ?? null,
  };
}
