import { join, normalize } from 'node:path';
import { parseJsonc } from '../../foundation/shared/utils/jsonc.js';
import { getNestedPath, listMcpServerNamesFromText, readOwnRecord } from './formats.js';
import { configPathCandidates, entryLocation, expandHome } from './paths.js';
import type { ResolvedAgentConfigProbes } from './probes.js';
import type { AgentConfigDef } from './types.js';

/**
 * Presence detection: is this agent installed on the machine at all?
 *
 * An agent is present when its CLI is on PATH or one of its data directories
 * carries a signal that is not MindOS's own doing. A hidden directory that
 * only holds the config file MindOS wrote (with `mindos` as the only server)
 * plus a `skills/` folder MindOS populated does not count, otherwise every
 * install would make the agent look installed.
 *
 * `which` costs a process spawn, and `GET /api/mcp/agents` probes ~27 agents
 * per request, so real-filesystem results are memoised for 15 seconds per
 * `(homeDir, agentKey)`. Injected probes bypass the memo (they are either a
 * test or a host that caches on its own).
 */
export const AGENT_PRESENCE_TTL_MS = 15_000;

const presenceCache = new Map<string, { at: number; value: boolean }>();

/** Test hook: forget memoised presence results. */
export function resetAgentPresenceCacheForTests(): void {
  presenceCache.clear();
}

export function detectAgentPresence(agentKey: string, def: AgentConfigDef, probes: ResolvedAgentConfigProbes): boolean {
  if (!probes.usesRealFs) return detectAgentPresenceUncached(def, probes);
  const cacheKey = `${probes.homeDir}\0${agentKey}`;
  const cached = presenceCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < AGENT_PRESENCE_TTL_MS) return cached.value;
  const value = detectAgentPresenceUncached(def, probes);
  presenceCache.set(cacheKey, { at: now, value });
  return value;
}

/**
 * Probe without touching the process-wide cache. One-shot runtimes (the CLI)
 * use this: a single command never probes twice, and a long-lived REPL must
 * see an agent installed mid-session immediately.
 */
export function detectAgentPresenceUncached(def: AgentConfigDef, probes: ResolvedAgentConfigProbes): boolean {
  if (def.presenceCli && probes.commandExists(def.presenceCli)) return true;
  return def.presenceDirs?.some((entry) => {
    try {
      return presencePathHasAgentSignal(expandHome(entry, probes.homeDir), def, probes);
    } catch {
      return false;
    }
  }) ?? false;
}

/**
 * Whether `candidatePath` (a declared presence dir or file) shows the agent
 * itself was here: a file is a signal unless it is a MindOS-managed-only
 * config; a directory is a signal when it holds anything besides
 * `.DS_Store`, the `skills/` folder and MindOS-managed-only config files.
 */
export function presencePathHasAgentSignal(
  candidatePath: string,
  def: AgentConfigDef,
  probes: ResolvedAgentConfigProbes,
): boolean {
  if (!probes.pathExists(candidatePath)) return false;

  let isFile: boolean;
  let isDirectory: boolean;
  try {
    const stat = probes.stat(candidatePath);
    isFile = stat.isFile();
    isDirectory = stat.isDirectory();
  } catch {
    return true;
  }
  if (isFile) return !configFileLooksMindosManagedOnly(candidatePath, def, probes);
  if (!isDirectory) return true;

  let entries;
  try {
    entries = probes.readDir(candidatePath);
  } catch {
    return true;
  }
  if (entries.length === 0) return false;

  const ignoredEntryNames = new Set(['.DS_Store', 'skills']);
  for (const entry of entries) {
    if (ignoredEntryNames.has(entry.name)) continue;
    const childPath = join(candidatePath, entry.name);
    if (entry.isFile() && configFileLooksMindosManagedOnly(childPath, def, probes)) continue;
    return true;
  }
  return false;
}

/**
 * True when `filePath` is one of the agent's global config files and its
 * content is nothing but what MindOS writes: empty, or a servers map whose
 * only server is `mindos` with no other top-level keys.
 */
export function configFileLooksMindosManagedOnly(
  filePath: string,
  def: AgentConfigDef,
  probes: ResolvedAgentConfigProbes,
): boolean {
  const managedGlobalPaths = configPathCandidates(def, 'global')
    .map((candidate) => normalize(expandHome(candidate, probes.homeDir)));
  if (!managedGlobalPaths.includes(normalize(filePath))) return false;

  let content = '';
  try {
    content = probes.readTextFile(filePath);
  } catch {
    return false;
  }
  if (!content.trim()) return true;

  try {
    const location = entryLocation(def, 'global');
    const serverNames = listMcpServerNamesFromText(content, location);
    if (!serverNames.every((server) => server === 'mindos')) return false;
    if (location.format !== 'json') return true;

    const parsed = parseJsonc(content);
    const section = def.globalNestedKey
      ? getNestedPath(parsed, def.globalNestedKey)
      : readOwnRecord(parsed, def.key);
    if (!section) return Object.keys(parsed).length === 0;

    if (!def.globalNestedKey) {
      const topKeys = Object.keys(parsed);
      return topKeys.length === 0 || (topKeys.length === 1 && topKeys[0] === def.key);
    }

    let current: Record<string, unknown> | null = parsed;
    for (const part of def.globalNestedKey.split('.').filter(Boolean)) {
      if (!current || Object.keys(current).some((key) => key !== part)) return false;
      const next: unknown = current[part];
      current = next && typeof next === 'object' ? next as Record<string, unknown> : null;
    }
    return true;
  } catch {
    return false;
  }
}
