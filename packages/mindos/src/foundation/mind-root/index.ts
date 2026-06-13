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
 * mind root without touching ~/.mindos/config.json or env. A plain module
 * variable is enough — production never registers a resolver, so duplicated
 * module instances in a bundler build all fall through to the same
 * config/env/default chain.
 */
let _resolverOverride: (() => string) | null = null;

export function setMindRootResolverForTests(resolver: (() => string) | null): void {
  _resolverOverride = resolver;
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
  if (_resolverOverride) return _resolverOverride();

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
}
