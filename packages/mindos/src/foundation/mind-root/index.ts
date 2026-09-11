import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Mind root resolution: ~/.mindos/config.json `mindRoot` → MIND_ROOT env →
 * ~/MindOS/mind. Sunk from packages/web/lib/mind-root.ts
 * (spec-agent-core-consolidation) so the agent core (run ledger) and the Web
 * fs layer share one resolver.
 *
 * Cached parse of ~/.mindos/config.json, keyed on the file's mtime + size.
 * `effectiveMindRoot` is called on every fs-layer operation (index builds
 * amplify this ~500x), so we pay one `statSync` per call instead of
 * read + JSON.parse.
 *
 * `value` is the validated `mindRoot` string, or null when the file exists
 * but has no usable value (invalid JSON / empty string) — cached too, so
 * a broken config doesn't trigger re-parsing on every call.
 */
interface ConfigCache {
  configPath: string;
  mtimeMs: number;
  size: number;
  value: string | null;
}

let _cache: ConfigCache | null = null;

/**
 * Test seam: vitest suites (web and core) point the whole process at a temp
 * mind root without touching ~/.mindos/config.json or env.
 *
 * The override + generation live on a process-global `Symbol.for` registry
 * (same reasoning as `agent/global-state.ts` and `server/events/bus.ts`):
 * bundler artifacts (e.g. the `dist/protocols/acp` bundle) inline their own
 * copy of this module, and since the knowledge agent-run-data port can be
 * served by ANY loaded copy (spec-knowledge-layering-and-export-surface), a
 * resolver registered through one copy must be visible to all of them —
 * otherwise a bundled `listAgentRuns` silently reads the default mind root
 * while the host process points at a different one. Production still never
 * registers a resolver; sharing only removes the duplicated-instance hazard.
 */
type MindRootResolverState = {
  resolverOverride: (() => string) | null;
  /**
   * Bumped whenever the resolver override or the config cache is reset, so
   * callers that memoize `effectiveMindRoot()` (the run ledger calls it twice
   * per streamed token) can invalidate without paying a `statSync` per check.
   */
  generation: number;
};

const RESOLVER_STATE_KEY = Symbol.for('mindos.foundationMindRootResolverState');

function resolverState(): MindRootResolverState {
  const globals = globalThis as unknown as Record<symbol, MindRootResolverState | undefined>;
  let entry = globals[RESOLVER_STATE_KEY];
  if (!entry) {
    entry = { resolverOverride: null, generation: 0 };
    globals[RESOLVER_STATE_KEY] = entry;
  }
  return entry;
}

export function setMindRootResolverForTests(resolver: (() => string) | null): void {
  const state = resolverState();
  state.resolverOverride = resolver;
  state.generation += 1;
}

/** Monotonic counter identifying the current resolver configuration. */
export function mindRootResolverGeneration(): number {
  return resolverState().generation;
}

function readConfiguredMindRoot(configPath: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    if (typeof parsed.mindRoot === 'string' && parsed.mindRoot.trim()) {
      return parsed.mindRoot;
    }
  } catch {
    // Missing or invalid config falls through to env/default.
  }
  return null;
}

export function effectiveMindRoot(): string {
  const override = resolverState().resolverOverride;
  if (override) return override();

  // homedir is resolved per call (cheap) so tests / env changes are honored.
  const home = os.homedir();
  const configPath = path.join(home, '.mindos', 'config.json');

  let stat: fs.Stats | null = null;
  try { stat = fs.statSync(configPath); } catch { stat = null; }

  if (!stat) {
    _cache = null;
  } else {
    const hit = _cache !== null
      && _cache.configPath === configPath
      && _cache.mtimeMs === stat.mtimeMs
      && _cache.size === stat.size;
    if (!hit) {
      _cache = {
        configPath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        value: readConfiguredMindRoot(configPath),
      };
    }
    if (_cache!.value) return _cache!.value;
  }

  // Env is intentionally not cached — it can change at runtime.
  return process.env.MIND_ROOT || path.join(home, 'MindOS', 'mind');
}

/** Clear the config cache (e.g. after a same-size, same-mtime rewrite in tests). */
export function resetMindRootCacheForTests(): void {
  _cache = null;
  resolverState().generation += 1;
}
