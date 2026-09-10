'use client';

import { useCallback, useEffect, useState } from 'react';
import { subscribeServerEvents } from '@/lib/server-events';
import type { AgentRuntimeDescriptor } from '@/lib/types';

type NativeRuntimeKind = 'codex' | 'claude';
type RuntimeLoadingMap = Partial<Record<NativeRuntimeKind, boolean>>;
type RuntimeErrorMap = Partial<Record<NativeRuntimeKind, string | null>>;

interface NativeRuntimeCache {
  runtime: AgentRuntimeDescriptor;
  ts: number;
}

interface NativeRuntimeDetectionState {
  runtimes: AgentRuntimeDescriptor[];
  loadingByKind: RuntimeLoadingMap;
  errorByKind: RuntimeErrorMap;
  refresh: () => void;
}

/** One detection request: which kinds to fetch and whether to bypass the server cache. */
interface DetectionRequest {
  seq: number;
  kinds: NativeRuntimeKind[];
  force: boolean;
}

const RUNTIME_KINDS: NativeRuntimeKind[] = ['codex', 'claude'];
const STORAGE_PREFIX = 'mindos:native-runtime-detection:v3:';
const LEGACY_STORAGE_PREFIXES = ['mindos:native-runtime-detection:v2:', 'mindos:native-runtime-detection:v1:'];
/**
 * The sessionStorage copy is the fallback for a fresh mount: within this TTL
 * the hook trusts it and waits for `runtime.changed` / `settings.changed`
 * from the event stream instead of re-fetching on every mount.
 */
const STALE_TTL_MS = 30 * 60 * 1000;
const DETECTION_TIMEOUT_MS = 30000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cacheKey(kind: NativeRuntimeKind): string {
  return `${STORAGE_PREFIX}${kind}`;
}

function isNativeRuntimeDescriptor(value: unknown, kind: NativeRuntimeKind): value is AgentRuntimeDescriptor {
  return isRecord(value) &&
    value.kind === kind &&
    value.id === kind &&
    typeof value.name === 'string' &&
    typeof value.status === 'string' &&
    isRecord(value.capabilities) &&
    isRecord(value.lifecycle) &&
    isRecord(value.compatibility);
}

function readRuntimeCache(kind: NativeRuntimeKind): NativeRuntimeCache | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !isNativeRuntimeDescriptor(parsed.runtime, kind) ||
      typeof parsed.ts !== 'number' ||
      Date.now() - parsed.ts > STALE_TTL_MS
    ) {
      return null;
    }
    return { runtime: parsed.runtime, ts: parsed.ts };
  } catch {
    return null;
  }
}

function writeRuntimeCache(kind: NativeRuntimeKind, runtime: AgentRuntimeDescriptor): void {
  try {
    sessionStorage.setItem(cacheKey(kind), JSON.stringify({ runtime, ts: Date.now() }));
  } catch { /* quota exceeded */ }
}

function removeRuntimeCache(kind: NativeRuntimeKind): void {
  try { sessionStorage.removeItem(cacheKey(kind)); } catch { /* ignore */ }
  for (const prefix of LEGACY_STORAGE_PREFIXES) {
    try { sessionStorage.removeItem(`${prefix}${kind}`); } catch { /* ignore */ }
  }
}

function upsertRuntime(runtimes: AgentRuntimeDescriptor[], runtime: AgentRuntimeDescriptor): AgentRuntimeDescriptor[] {
  const next = runtimes.filter((item) => item.kind !== runtime.kind || item.id !== runtime.id);
  next.push(runtime);
  return next.sort((a, b) => RUNTIME_KINDS.indexOf(a.kind as NativeRuntimeKind) - RUNTIME_KINDS.indexOf(b.kind as NativeRuntimeKind));
}

function markRuntimeDetectionError(
  runtimes: AgentRuntimeDescriptor[],
  kind: NativeRuntimeKind,
  message: string,
): AgentRuntimeDescriptor[] {
  const existing = runtimes.find((runtime) => runtime.kind === kind && runtime.id === kind);
  if (!existing) return runtimes;
  return upsertRuntime(runtimes, {
    ...existing,
    status: 'error',
    availability: {
      checkedAt: new Date().toISOString(),
      sources: ['native-health'],
      ...(message ? { reason: message } : {}),
      stale: false,
    },
  });
}

function flagsFor(kinds: NativeRuntimeKind[], value: boolean): RuntimeLoadingMap {
  return Object.fromEntries(kinds.map((kind) => [kind, value])) as RuntimeLoadingMap;
}

export function useNativeRuntimeDetection(): NativeRuntimeDetectionState {
  const [initialCaches] = useState(() => new Map(RUNTIME_KINDS.map((kind) => [kind, readRuntimeCache(kind)] as const)));
  const [runtimes, setRuntimes] = useState<AgentRuntimeDescriptor[]>(() => (
    RUNTIME_KINDS
      .map((kind) => initialCaches.get(kind)?.runtime)
      .filter((runtime): runtime is AgentRuntimeDescriptor => !!runtime)
  ));
  // Only kinds without a fresh sessionStorage copy are fetched on mount.
  const [request, setRequest] = useState<DetectionRequest>(() => ({
    seq: 0,
    kinds: RUNTIME_KINDS.filter((kind) => !initialCaches.get(kind)),
    force: false,
  }));
  const [loadingByKind, setLoadingByKind] = useState<RuntimeLoadingMap>(() => flagsFor(request.kinds, true));
  const [errorByKind, setErrorByKind] = useState<RuntimeErrorMap>({});

  const revalidate = useCallback((kinds: NativeRuntimeKind[] = RUNTIME_KINDS, options: { force?: boolean } = {}) => {
    if (kinds.length === 0) return;
    if (options.force) for (const kind of kinds) removeRuntimeCache(kind);
    setLoadingByKind((current) => ({ ...current, ...flagsFor(kinds, true) }));
    setErrorByKind((current) => ({ ...current, ...Object.fromEntries(kinds.map((kind) => [kind, null])) }));
    setRequest((current) => ({ seq: current.seq + 1, kinds, force: Boolean(options.force) }));
  }, []);

  const refresh = useCallback(() => revalidate(RUNTIME_KINDS, { force: true }), [revalidate]);

  useEffect(() => {
    const onSettingsChanged = () => refresh();
    window.addEventListener('mindos:settings-changed', onSettingsChanged);
    return () => window.removeEventListener('mindos:settings-changed', onSettingsChanged);
  }, [refresh]);

  useEffect(() => {
    // The server already re-probed before emitting; a plain fetch reads its cache.
    const unsubscribeRuntime = subscribeServerEvents('runtime.changed', (event) => {
      const kinds = RUNTIME_KINDS.filter((kind) => event.runtimes.includes(kind));
      if (kinds.length > 0) revalidate(kinds);
    });
    const unsubscribeSettings = subscribeServerEvents('settings.changed', () => revalidate());
    const unsubscribeReady = subscribeServerEvents('ready', (event) => {
      if (event.resync) revalidate();
    });
    return () => {
      unsubscribeRuntime();
      unsubscribeSettings();
      unsubscribeReady();
    };
  }, [revalidate]);

  useEffect(() => {
    if (request.kinds.length === 0) return;
    const controllers: AbortController[] = [];
    let cancelled = false;

    for (const kind of request.kinds) {
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);

      fetch(`/api/agent-runtimes?runtime=${kind}${request.force ? '&force=1' : ''}`, { cache: 'no-store', signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (cancelled || !isNativeRuntimeDescriptor(data.runtime, kind)) return;
          writeRuntimeCache(kind, data.runtime);
          setRuntimes((current) => upsertRuntime(current, data.runtime));
        })
        .catch((err) => {
          if (cancelled) return;
          const label = kind === 'claude' ? 'Claude Code' : 'Codex';
          const seconds = Math.round(DETECTION_TIMEOUT_MS / 1000);
          const message = err instanceof DOMException && err.name === 'AbortError'
            ? `${label} did not respond within ${seconds}s. Check that ${label} is installed and available to the MindOS server process.`
            : (err as Error).message;
          removeRuntimeCache(kind);
          setRuntimes((current) => markRuntimeDetectionError(current, kind, message));
          setErrorByKind((current) => ({ ...current, [kind]: message }));
        })
        .finally(() => {
          clearTimeout(timeout);
          if (!cancelled) setLoadingByKind((current) => ({ ...current, [kind]: false }));
        });
    }

    return () => {
      cancelled = true;
      controllers.forEach((controller) => controller.abort());
    };
  }, [request]);

  return { runtimes, loadingByKind, errorByKind, refresh };
}
