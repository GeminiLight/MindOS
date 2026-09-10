import { listMcpServerNamesFromText } from './formats.js';
import type { ResolvedAgentConfigProbes } from './probes.js';
import type { McpServerEntryLocation } from './types.js';

/**
 * Process-wide memo of agent config files keyed by `(absPath, mtimeMs, size)`.
 *
 * `GET /api/mcp/agents` reads every readable config of ~27 agents on each
 * request and parses each one twice (installed check + server list). Config
 * files change rarely, so a stat-validated memo turns the steady state into
 * one `stat` per file. It only engages against the real filesystem
 * (`probes.usesRealFs`); injected probes read straight through.
 */
type CachedConfigFile = {
  mtimeMs: number;
  size: number;
  text: string;
  /** `listMcpServerNamesFromText` results per location key. */
  serverNames: Map<string, string[]>;
};

const MAX_CACHED_FILES = 256;
const cache = new Map<string, CachedConfigFile>();

/** Test hook: forget every memoised config file. */
export function resetAgentConfigReadCacheForTests(): void {
  cache.clear();
}

/** Number of memoised files (test observability). */
export function agentConfigReadCacheSize(): number {
  return cache.size;
}

/**
 * Text of the config file at `absPath`, or null when it does not exist. Read
 * errors on an existing file propagate so callers can skip that file
 * explicitly. Real-filesystem reads are memoised until mtime or size change.
 */
export function readAgentConfigFile(absPath: string, probes: ResolvedAgentConfigProbes): string | null {
  const cached = cachedEntry(absPath, probes);
  if (cached) return cached.text;
  if (!probes.pathExists(absPath)) return null;
  return probes.readTextFile(absPath);
}

/**
 * Names of every server configured at `location` inside `absPath`; empty when
 * the file is missing or unparsable. Memoised together with the file text.
 */
export function listServerNamesFromFile(
  absPath: string,
  location: McpServerEntryLocation,
  probes: ResolvedAgentConfigProbes,
): string[] {
  const cached = cachedEntry(absPath, probes);
  if (cached) {
    const key = locationKey(location);
    let names = cached.serverNames.get(key);
    if (!names) {
      names = listMcpServerNamesFromText(cached.text, location);
      cached.serverNames.set(key, names);
    }
    return names;
  }
  const text = readAgentConfigFile(absPath, probes);
  return text === null ? [] : listMcpServerNamesFromText(text, location);
}

function locationKey(location: McpServerEntryLocation): string {
  return `${location.format}\0${location.sectionKey}\0${location.nestedPath ?? ''}`;
}

/** The memo entry for `absPath` (refreshed when stale); null when the memo is off or the file is missing. */
function cachedEntry(absPath: string, probes: ResolvedAgentConfigProbes): CachedConfigFile | null {
  if (!probes.usesRealFs) return null;
  let mtimeMs: number;
  let size: number;
  try {
    const stat = probes.stat(absPath);
    if (!stat.isFile()) {
      cache.delete(absPath);
      return null;
    }
    mtimeMs = stat.mtimeMs;
    size = stat.size;
  } catch {
    cache.delete(absPath);
    return null;
  }
  const existing = cache.get(absPath);
  if (existing && existing.mtimeMs === mtimeMs && existing.size === size) return existing;

  const text = probes.readTextFile(absPath);
  const entry: CachedConfigFile = { mtimeMs, size, text, serverNames: new Map() };
  if (!existing && cache.size >= MAX_CACHED_FILES) {
    // Drop the oldest insertion; Map iteration order is insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(absPath, entry);
  return entry;
}
