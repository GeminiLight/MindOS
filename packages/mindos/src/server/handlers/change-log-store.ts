import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import type {
  ContentChangeEvent,
  ContentChangeSource,
  ContentChangeSummary,
} from '../../knowledge/audit/index.js';
import {
  appendJsonlEvents,
  ensureJsonlStore,
  readJsonlEvents,
  writeJsonlMeta,
  type JsonlCompactionConfig,
} from './jsonl-log.js';

/**
 * Read side of the content change log backed by the shared JSONL store.
 *
 * On-disk format is shared with `packages/web/lib/core/content-changes.ts`
 * (the writer): `.mindos/change-log.json` holds one event per line
 * (oldest-first) and `.mindos/change-log.meta.json` carries `lastSeenAt` plus
 * legacy import counters, so marking changes seen no longer rewrites the
 * entire event log.
 */

const MAX_EVENTS = 500;
const MAX_TEXT_CHARS = 12_000;
const COMPACTION: JsonlCompactionConfig = {
  maxEvents: MAX_EVENTS,
  maxBytes: 12_000_000,
  targetBytes: 6_000_000,
};
const LEGACY_AGENT_DIFF_FILE = 'Agent-Diff.md';

export interface ContentChangeListOptions {
  path?: string;
  space?: string;
  limit?: number;
  source?: ContentChangeSource;
  agent?: string;
  op?: string;
  q?: string;
}

export interface ContentChangeFacetItem {
  value: string;
  count: number;
}

export interface ContentChangeFacets {
  spaces: ContentChangeFacetItem[];
  agents: ContentChangeFacetItem[];
  operations: ContentChangeFacetItem[];
  sources: ContentChangeFacetItem[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveKnowledgePath(mindRoot: string, relativePath: string): string {
  if (existsSync(mindRoot)) {
    return resolveExistingSafe(mindRoot, relativePath);
  }
  return path.join(mindRoot, relativePath);
}

function changeLogPath(mindRoot: string): string {
  return resolveKnowledgePath(mindRoot, path.posix.join('.mindos', 'change-log.json'));
}

function changeLogMetaPath(mindRoot: string): string {
  return resolveKnowledgePath(mindRoot, path.posix.join('.mindos', 'change-log.meta.json'));
}

function readChangeEvents(mindRoot: string): { events: ContentChangeEvent[]; lastSeenAt: string | null } {
  importLegacyAgentDiffIfNeeded(mindRoot);
  const { events, meta } = readJsonlEvents(changeLogPath(mindRoot), changeLogMetaPath(mindRoot));
  return {
    events: events.slice(0, MAX_EVENTS) as ContentChangeEvent[],
    lastSeenAt: meta.lastSeenAt,
  };
}

const ROOT_SPACE_VALUE = '__root__';
const UNKNOWN_AGENT_VALUE = '__agent_unknown__';

function normalizeEventPath(value: string | undefined): string {
  return typeof value === 'string' ? value.split('\\').join('/').replace(/^\/+/, '').replace(/\/+$/, '') : '';
}

function pathSpaceValue(value: string | undefined, op?: string): string {
  const normalized = normalizeEventPath(value);
  if (!normalized) return ROOT_SPACE_VALUE;
  const [first, ...rest] = normalized.split('/');
  if (rest.length > 0) return first || ROOT_SPACE_VALUE;
  if (op === 'create_space' || op === 'rename_space') return first || ROOT_SPACE_VALUE;
  return ROOT_SPACE_VALUE;
}

function eventSpaceValue(event: ContentChangeEvent): string {
  const candidates = [event.afterPath, event.path, event.beforePath];
  for (const candidate of candidates) {
    const value = pathSpaceValue(candidate, event.op);
    if (value !== ROOT_SPACE_VALUE) return value;
  }
  return ROOT_SPACE_VALUE;
}

function eventAgentValue(event: ContentChangeEvent): string | null {
  if (event.source !== 'agent') return null;
  return event.agentName?.trim() || UNKNOWN_AGENT_VALUE;
}

function countValues(values: Array<string | null | undefined>): ContentChangeFacetItem[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function listContentChangesFromLog(
  mindRoot: string,
  options: ContentChangeListOptions = {},
): ContentChangeEvent[] {
  try {
    const { events } = readChangeEvents(mindRoot);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const pathFilter = options.path?.trim();
    const spaceFilter = options.space?.trim();
    const sourceFilter = options.source;
    const agentFilter = options.agent?.trim();
    const opFilter = options.op?.trim();
    const q = options.q?.trim().toLowerCase();
    return events.filter((event) => {
      if (pathFilter && event.path !== pathFilter && event.beforePath !== pathFilter && event.afterPath !== pathFilter) {
        return false;
      }
      if (spaceFilter && eventSpaceValue(event) !== spaceFilter) return false;
      if (sourceFilter && event.source !== sourceFilter) return false;
      if (agentFilter && eventAgentValue(event) !== agentFilter) return false;
      if (opFilter && event.op !== opFilter) return false;
      if (q) {
        const haystack = `${event.path} ${event.beforePath ?? ''} ${event.afterPath ?? ''} ${event.summary} ${event.op} ${event.source} ${event.agentName ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).slice(0, limit);
  } catch {
    return [];
  }
}

export function getContentChangeFacetsFromLog(mindRoot: string): ContentChangeFacets {
  try {
    const { events } = readChangeEvents(mindRoot);
    return {
      spaces: countValues(events.map(eventSpaceValue)),
      agents: countValues(events.map(eventAgentValue)),
      operations: countValues(events.map((event) => event.op)),
      sources: countValues(events.map((event) => event.source)),
    };
  } catch {
    return { spaces: [], agents: [], operations: [], sources: [] };
  }
}

export function getContentChangeSummaryFromLog(mindRoot: string): ContentChangeSummary {
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

/** Marks all changes seen by updating only the small meta sidecar. */
export function markContentChangesSeenInLog(mindRoot: string): void {
  importLegacyAgentDiffIfNeeded(mindRoot);
  const metaFile = changeLogMetaPath(mindRoot);
  const meta = ensureJsonlStore(changeLogPath(mindRoot), metaFile, { persistIfMissing: true });
  meta.lastSeenAt = nowIso();
  writeJsonlMeta(metaFile, meta);
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
      blocks.push(JSON.parse(m[1].trim()) as LegacyAgentDiffEntry);
    } catch {
      // Skip malformed block, keep import best-effort.
    }
  }
  return blocks;
}

function normalizeText(value: string | undefined): { value: string | undefined; truncated: boolean } {
  if (typeof value !== 'string') return { value: undefined, truncated: false };
  if (value.length <= MAX_TEXT_CHARS) return { value, truncated: false };
  return { value: value.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function toValidIso(ts: string | undefined): string {
  if (!ts) return nowIso();
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
}

function importLegacyAgentDiffIfNeeded(mindRoot: string): void {
  try {
    const legacyPath = resolveKnowledgePath(mindRoot, LEGACY_AGENT_DIFF_FILE);
    if (!existsSync(legacyPath)) return;
    const blocks = parseLegacyAgentDiffBlocks(readFileSync(legacyPath, 'utf-8'));
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
    rmSync(legacyPath, { force: true });
  } catch {
    // Legacy import is best-effort and must never break the main flow.
  }
}
