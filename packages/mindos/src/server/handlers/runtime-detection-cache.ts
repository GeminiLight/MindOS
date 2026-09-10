import { createHash } from 'node:crypto';
import { deleteProcessGlobal, getProcessGlobal } from '../../agent/global-state.js';
import type { AgentRuntimesServices, AgentRuntimesSettings } from '../../agent/runtime/registry.js';
import { getMindosServerEventBus, type MindosServerEventEmitter } from '../events/bus.js';

/**
 * Process-wide memo for runtime detection (Codex / Claude health, ACP agent
 * scan). Every probe spawns child processes, and before this cache existed
 * each projection route, the readiness route, the runtime picker and the turn
 * gate re-ran the whole probe on every request: an Agents panel mount alone
 * cost about 18 child processes.
 *
 * Keys combine three things:
 * - the detection scope (`codex`, `claude`, `acp`; the full payload composes all three);
 * - a fingerprint of the settings that change what detection sees
 *   (`acpAgents` overrides and `agentRuntimeEnv`), so a settings write
 *   naturally misses the cache;
 * - the detector identity: hosts that inject detector overrides which only
 *   wrap the product defaults name one bucket through `detectionIdentity`
 *   (the Web host uses `web-host`); callers that inject real alternatives get
 *   a bucket per function tuple, which also keeps test doubles apart.
 *
 * Concurrent callers share one in-flight probe; `force` skips the freshness
 * check but still joins an in-flight probe. Failed probes are never stored.
 * When a refreshed result differs from the previously cached one the bus
 * receives `runtime.changed` so connected clients re-fetch instead of polling.
 *
 * The state lives on `globalThis` under a `Symbol.for` key for the same
 * reason as the event bus: Next.js bundles core into several route chunks and
 * each chunk would otherwise own a private cache.
 */

export const RUNTIME_DETECTION_CACHE_TTL_MS = 60_000;

export type RuntimeDetectionScope = 'codex' | 'claude' | 'acp';

export type RuntimeDetectionServices = AgentRuntimesServices & {
  /** Names the cache bucket for hosts whose detector overrides wrap the product defaults. */
  detectionIdentity?: string;
  /** Receives `runtime.changed`; defaults to the process bus. */
  events?: MindosServerEventEmitter;
};

export type RuntimeDetectionEntry<T> = {
  value: T;
  /** Epoch ms when the probe finished (from `services.now` when injected). */
  checkedAt: number;
  expiresAt: number;
};

type CacheState = {
  entries: Map<string, RuntimeDetectionEntry<unknown>>;
  inflight: Map<string, Promise<RuntimeDetectionEntry<unknown>>>;
  functionIds: WeakMap<object, number>;
  nextFunctionId: number;
};

const RUNTIME_DETECTION_CACHE_KEY = Symbol.for('mindos.runtimeDetectionCache');

function state(): CacheState {
  return getProcessGlobal<CacheState>(RUNTIME_DETECTION_CACHE_KEY, () => ({
    entries: new Map(),
    inflight: new Map(),
    functionIds: new WeakMap(),
    nextFunctionId: 1,
  }));
}

export function resetRuntimeDetectionCacheForTest(): void {
  deleteProcessGlobal(RUNTIME_DETECTION_CACHE_KEY);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

/** Only the settings that change what detection sees; hashed so the key never holds override env values in clear text. */
export function fingerprintRuntimeDetectionSettings(settings: AgentRuntimesSettings | undefined): string {
  const digest = createHash('sha256');
  digest.update(stableStringify({
    acpAgents: settings?.acpAgents ?? null,
    agentRuntimeEnv: settings?.agentRuntimeEnv ?? null,
  }));
  return digest.digest('hex').slice(0, 24);
}

const IDENTITY_FIELDS = [
  'detectLocalAcpAgents',
  'checkNativeRuntimeHealth',
  'resolveRuntimeCommand',
  'resolveRuntimeCommandCandidates',
] as const;

function functionId(cache: CacheState, fn: unknown): string {
  if (typeof fn !== 'function') return '0';
  let id = cache.functionIds.get(fn);
  if (id === undefined) {
    id = cache.nextFunctionId;
    cache.nextFunctionId += 1;
    cache.functionIds.set(fn, id);
  }
  return String(id);
}

function detectorIdentity(cache: CacheState, services: RuntimeDetectionServices): string {
  if (services.detectionIdentity) return `host:${services.detectionIdentity}`;
  return `fn:${IDENTITY_FIELDS.map((field) => functionId(cache, services[field])).join('.')}`;
}

function cacheKey(cache: CacheState, input: {
  scope: RuntimeDetectionScope;
  services: RuntimeDetectionServices;
  settings: AgentRuntimesSettings | undefined;
}): string {
  return `${input.scope}|${fingerprintRuntimeDetectionSettings(input.settings)}|${detectorIdentity(cache, input.services)}`;
}

function nowFrom(services: RuntimeDetectionServices): number {
  return services.now?.() ?? Date.now();
}

type AgentLike = { id?: unknown };

function agentsById(value: unknown): Map<string, string> {
  const byId = new Map<string, string>();
  const record = value as { installed?: unknown; notInstalled?: unknown } | null;
  for (const list of [record?.installed, record?.notInstalled]) {
    if (!Array.isArray(list)) continue;
    for (const agent of list as AgentLike[]) {
      if (agent && typeof agent === 'object' && typeof agent.id === 'string') byId.set(agent.id, stableStringify(agent));
    }
  }
  return byId;
}

/** Ids to announce in `runtime.changed`: the native kind, or the ACP agents whose entry differs. */
function changedRuntimeIds(scope: RuntimeDetectionScope, before: unknown, after: unknown): string[] {
  if (scope !== 'acp') return [scope];
  const previous = agentsById(before);
  const next = agentsById(after);
  const changed = new Set<string>();
  for (const [id, serialized] of next) {
    if (previous.get(id) !== serialized) changed.add(id);
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) changed.add(id);
  }
  return changed.size > 0 ? [...changed].sort() : ['acp'];
}

export type GetRuntimeDetectionInput<T> = {
  scope: RuntimeDetectionScope;
  services: RuntimeDetectionServices;
  /** Settings read once per request by the caller; part of the cache key. */
  settings: AgentRuntimesSettings | undefined;
  /** Skip the freshness check (still joins an in-flight probe). */
  force?: boolean;
  probe: () => Promise<T>;
  /** Projection used for the `runtime.changed` comparison; defaults to the whole value. */
  describe?: (value: T) => unknown;
};

export async function getRuntimeDetection<T>(input: GetRuntimeDetectionInput<T>): Promise<RuntimeDetectionEntry<T>> {
  const cache = state();
  const key = cacheKey(cache, input);
  const existing = cache.entries.get(key) as RuntimeDetectionEntry<T> | undefined;
  if (existing && !input.force && existing.expiresAt > nowFrom(input.services)) return existing;

  const pending = cache.inflight.get(key) as Promise<RuntimeDetectionEntry<T>> | undefined;
  if (pending) return pending;

  // Declared before the IIFE so the settle branch can check whether it still owns the in-flight slot.
  let probe!: Promise<RuntimeDetectionEntry<T>>;
  probe = (async (): Promise<RuntimeDetectionEntry<T>> => {
    const value = await input.probe();
    const checkedAt = nowFrom(input.services);
    const entry: RuntimeDetectionEntry<T> = { value, checkedAt, expiresAt: checkedAt + RUNTIME_DETECTION_CACHE_TTL_MS };
    // A reset (tests) or a newer probe under the same key owns the slot now; do not resurrect a stale result.
    const live = state();
    if (live !== cache || live.inflight.get(key) !== probe) return entry;
    const previous = live.entries.get(key) as RuntimeDetectionEntry<T> | undefined;
    live.entries.set(key, entry);
    if (previous) {
      const describe = input.describe ?? ((entryValue: T) => entryValue);
      if (stableStringify(describe(previous.value)) !== stableStringify(describe(value))) {
        emitRuntimeChanged(input.services, changedRuntimeIds(input.scope, describe(previous.value), describe(value)));
      }
    }
    return entry;
  })();
  cache.inflight.set(key, probe);
  try {
    return await probe;
  } finally {
    if (cache.inflight.get(key) === probe) cache.inflight.delete(key);
  }
}

/** The most recent entry for this key, expired or not; null before any probe completed. */
export function peekRuntimeDetection<T>(input: {
  scope: RuntimeDetectionScope;
  services: RuntimeDetectionServices;
  settings: AgentRuntimesSettings | undefined;
}): RuntimeDetectionEntry<T> | null {
  const cache = state();
  return (cache.entries.get(cacheKey(cache, input)) as RuntimeDetectionEntry<T> | undefined) ?? null;
}

function emitRuntimeChanged(services: RuntimeDetectionServices, runtimes: string[]): void {
  try {
    (services.events ?? getMindosServerEventBus()).emit({ type: 'runtime.changed', runtimes });
  } catch {
    // Change notifications are best-effort; detection results must still be served.
  }
}
