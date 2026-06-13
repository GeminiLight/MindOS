import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/**
 * Generic append-only JSONL log store.
 *
 * Replaces the previous "read whole file -> unshift -> pretty-print rewrite"
 * pattern (O(N) per event, O(N^2) per batch) with O(1) line appends plus an
 * amortized size-capped compaction.
 *
 * On-disk layout:
 * - `<file>`: one JSON object per line, oldest-first (newest at EOF).
 * - `<metaFile>`: small sidecar `{ version: 2, lastSeenAt, legacy }`. Its
 *   presence marks that `<file>` is in JSONL format, so appends never need to
 *   re-read the log to detect the legacy pretty-printed format.
 */

export interface JsonlLogMeta {
  version: 2;
  lastSeenAt: string | null;
  legacy: Record<string, number | string | null>;
}

export interface JsonlCompactionConfig {
  /** Newest entries kept when the log is compacted. */
  maxEvents: number;
  /** Compaction triggers once the file grows beyond this many bytes. */
  maxBytes: number;
  /** Compaction additionally drops oldest entries until at most this size. */
  targetBytes: number;
}

interface LegacyStateFile {
  events: unknown[];
  lastSeenAt?: unknown;
  legacy?: unknown;
}

function defaultMeta(): JsonlLogMeta {
  return { version: 2, lastSeenAt: null, legacy: {} };
}

function parseLegacyStateFile(raw: string): LegacyStateFile | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && Array.isArray((parsed as { events?: unknown }).events)
    ) {
      return parsed as LegacyStateFile;
    }
  } catch {
    // Not a single JSON document: already JSONL (or corrupted lines we skip on read).
  }
  return null;
}

function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, file);
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* ignore cleanup errors */ }
    throw error;
  }
}

export function readJsonlMeta(metaFile: string): JsonlLogMeta | null {
  try {
    if (!existsSync(metaFile)) return null;
    const parsed = JSON.parse(readFileSync(metaFile, 'utf-8')) as Partial<JsonlLogMeta> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      version: 2,
      lastSeenAt: typeof parsed.lastSeenAt === 'string' ? parsed.lastSeenAt : null,
      legacy: parsed.legacy && typeof parsed.legacy === 'object' && !Array.isArray(parsed.legacy)
        ? { ...(parsed.legacy as Record<string, number | string | null>) }
        : {},
    };
  } catch {
    return null;
  }
}

export function writeJsonlMeta(metaFile: string, meta: JsonlLogMeta): void {
  atomicWrite(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Guarantees the log file is in JSONL format and returns its sidecar meta.
 *
 * On first contact with a legacy pretty-printed `{ events: [...] }` state file
 * it rewrites the log once as JSONL. Legacy arrays are newest-first; on disk we
 * store oldest-first so plain appends keep chronological order. `lastSeenAt`
 * and legacy import counters are carried into the meta sidecar.
 *
 * Pure reads on a store that needs no migration do not write anything unless
 * `persistIfMissing` is set (used by appenders so later appends skip the scan).
 */
export function ensureJsonlStore(
  file: string,
  metaFile: string,
  options: { persistIfMissing?: boolean } = {},
): JsonlLogMeta {
  const existing = readJsonlMeta(metaFile);
  if (existing) return existing;

  const meta = defaultMeta();
  let migrated = false;
  if (existsSync(file)) {
    const legacyState = parseLegacyStateFile(readFileSync(file, 'utf-8'));
    if (legacyState) {
      const lines = [...legacyState.events]
        .reverse()
        .filter((event) => event !== null && typeof event === 'object')
        .map((event) => JSON.stringify(event));
      if (typeof legacyState.lastSeenAt === 'string') meta.lastSeenAt = legacyState.lastSeenAt;
      if (legacyState.legacy && typeof legacyState.legacy === 'object' && !Array.isArray(legacyState.legacy)) {
        meta.legacy = { ...(legacyState.legacy as Record<string, number | string | null>) };
      }
      atomicWrite(file, lines.length > 0 ? `${lines.join('\n')}\n` : '');
      migrated = true;
    }
  }
  if (migrated || options.persistIfMissing) writeJsonlMeta(metaFile, meta);
  return meta;
}

/** Appends events (oldest-first input order) as a single write, then compacts if oversized. */
export function appendJsonlEvents(
  file: string,
  metaFile: string,
  events: unknown[],
  config: JsonlCompactionConfig,
): void {
  ensureJsonlStore(file, metaFile, { persistIfMissing: true });
  if (events.length === 0) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, events.map((event) => `${JSON.stringify(event)}\n`).join(''), 'utf-8');
  compactJsonlIfNeeded(file, config);
}

/** Returns parsed events newest-first; corrupted lines are skipped. */
export function readJsonlEvents(
  file: string,
  metaFile: string,
): { events: unknown[]; meta: JsonlLogMeta } {
  const meta = ensureJsonlStore(file, metaFile);
  if (!existsSync(file)) return { events: [], meta };
  const events: unknown[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) events.push(parsed);
    } catch {
      // Skip corrupted line: a partial append must not poison the whole log.
    }
  }
  events.reverse();
  return { events, meta };
}

/**
 * Rewrites the log keeping only the newest `maxEvents` entries (and at most
 * `targetBytes` of them) once it grows past `maxBytes`. Amortized: appends stay
 * O(1) and the occasional compaction is one bounded rewrite.
 */
export function compactJsonlIfNeeded(file: string, config: JsonlCompactionConfig): void {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return;
  }
  if (size <= config.maxBytes) return;

  const lines = readFileSync(file, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
  let kept = lines.slice(-config.maxEvents);
  let bytes = kept.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf-8') + 1, 0);
  let drop = 0;
  while (drop < kept.length - 1 && bytes > config.targetBytes) {
    bytes -= Buffer.byteLength(kept[drop] ?? '', 'utf-8') + 1;
    drop += 1;
  }
  if (drop > 0) kept = kept.slice(drop);
  atomicWrite(file, kept.length > 0 ? `${kept.join('\n')}\n` : '');
}
