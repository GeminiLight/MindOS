import fs from 'fs';
import path from 'path';
import { resolveExistingSafe } from './security';
import {
  appendJsonlEvents,
  ensureJsonlStore,
  readJsonlEvents,
  writeJsonlMeta,
  type JsonlCompactionConfig,
} from './jsonl-log';

/**
 * Content change log backed by the shared JSONL store.
 *
 * On-disk format is shared with
 * `packages/mindos/src/server/handlers/change-log-store.ts`:
 * `.mindos/change-log.json` holds one event per line (oldest-first) and
 * `.mindos/change-log.meta.json` carries `lastSeenAt` plus legacy import
 * counters. Appending a change writes one line instead of rewriting the entire
 * (snapshot-heavy) log, and marking changes seen touches only the sidecar.
 */

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
const META_FILE_NAME = 'change-log.meta.json';
const LEGACY_AGENT_DIFF_FILE = 'Agent-Diff.md';
const MAX_EVENTS = 500;
const MAX_TEXT_CHARS = 12_000;
const COMPACTION: JsonlCompactionConfig = {
  maxEvents: MAX_EVENTS,
  maxBytes: 12_000_000,
  targetBytes: 6_000_000,
};

function nowIso() {
  return new Date().toISOString();
}

function changeLogPath(mindRoot: string) {
  return resolveExistingSafe(mindRoot, path.posix.join(LOG_DIR_NAME, LOG_FILE_NAME));
}

function changeLogMetaPath(mindRoot: string) {
  return resolveExistingSafe(mindRoot, path.posix.join(LOG_DIR_NAME, META_FILE_NAME));
}

function normalizeText(value: string | undefined): { value: string | undefined; truncated: boolean } {
  if (typeof value !== 'string') return { value: undefined, truncated: false };
  if (value.length <= MAX_TEXT_CHARS) return { value, truncated: false };
  return {
    value: value.slice(0, MAX_TEXT_CHARS),
    truncated: true,
  };
}

function readChangeEvents(mindRoot: string): { events: ContentChangeEvent[]; lastSeenAt: string | null } {
  importLegacyAgentDiffIfNeeded(mindRoot);
  const { events, meta } = readJsonlEvents(changeLogPath(mindRoot), changeLogMetaPath(mindRoot));
  return {
    events: events.slice(0, MAX_EVENTS) as ContentChangeEvent[],
    lastSeenAt: meta.lastSeenAt,
  };
}

/** Appends one change event as a single JSONL line (no whole-file rewrite). */
export function appendContentChange(mindRoot: string, input: ContentChangeInput): ContentChangeEvent {
  const file = changeLogPath(mindRoot);
  const metaFile = changeLogMetaPath(mindRoot);
  importLegacyAgentDiffIfNeeded(mindRoot);
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
  appendJsonlEvents(file, metaFile, [event], COMPACTION);
  return event;
}

export function listContentChanges(mindRoot: string, options: ListOptions = {}): ContentChangeEvent[] {
  try {
    const { events } = readChangeEvents(mindRoot);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const pathFilter = options.path?.trim();
    const sourceFilter = options.source;
    const opFilter = options.op?.trim();
    const q = options.q?.trim().toLowerCase();
    return events.filter((event) => {
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
    }).slice(0, limit);
  } catch {
    return [];
  }
}

/** Marks all changes seen by updating only the small meta sidecar. */
export function markContentChangesSeen(mindRoot: string): void {
  importLegacyAgentDiffIfNeeded(mindRoot);
  const metaFile = changeLogMetaPath(mindRoot);
  const meta = ensureJsonlStore(changeLogPath(mindRoot), metaFile, { persistIfMissing: true });
  meta.lastSeenAt = nowIso();
  writeJsonlMeta(metaFile, meta);
}

export function getContentChangeSummary(mindRoot: string): ContentChangeSummary {
  try {
    const { events, lastSeenAt } = readChangeEvents(mindRoot);
    const lastSeenAtMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    const unreadCount = events.filter((event) => new Date(event.ts).getTime() > lastSeenAtMs).length;
    return {
      unreadCount,
      totalCount: events.length,
      lastSeenAt,
      latest: events[0] ?? null,
    };
  } catch {
    return { unreadCount: 0, totalCount: 0, lastSeenAt: null, latest: null };
  }
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

function importLegacyAgentDiffIfNeeded(mindRoot: string): void {
  try {
    const legacyPath = resolveExistingSafe(mindRoot, LEGACY_AGENT_DIFF_FILE);
    if (!fs.existsSync(legacyPath)) return;
    const blocks = parseLegacyAgentDiffBlocks(fs.readFileSync(legacyPath, 'utf-8'));
    if (blocks.length === 0) return;

    const file = changeLogPath(mindRoot);
    const metaFile = changeLogMetaPath(mindRoot);
    const meta = ensureJsonlStore(file, metaFile, { persistIfMissing: true });
    const importedCount = typeof meta.legacy.agentDiffImportedCount === 'number'
      ? meta.legacy.agentDiffImportedCount
      : 0;
    if (blocks.length > importedCount) {
      const imported: ContentChangeEvent[] = blocks.slice(importedCount).map((entry, idx) => {
        const before = normalizeText(entry.before);
        const after = normalizeText(entry.after);
        const toolName = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool.trim() : 'unknown-tool';
        return {
          id: `legacy-${Date.now().toString(36)}-${idx.toString(36)}`,
          ts: toValidIso(entry.ts),
          op: 'legacy_agent_diff_import',
          path: typeof entry.path === 'string' && entry.path.trim() ? entry.path : LEGACY_AGENT_DIFF_FILE,
          source: 'agent',
          summary: `Imported legacy agent diff (${toolName})`,
          before: before.value,
          after: after.value,
          truncated: before.truncated || after.truncated || undefined,
        };
      });
      appendJsonlEvents(file, metaFile, imported, COMPACTION);
      meta.legacy = { ...meta.legacy, agentDiffImportedCount: blocks.length, lastImportedAt: nowIso() };
      writeJsonlMeta(metaFile, meta);
    }
    fs.rmSync(legacyPath, { force: true });
  } catch {
    // Legacy import is best-effort and must never break the main flow.
  }
}
