'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

const RUNTIME_KINDS: NativeRuntimeKind[] = ['codex', 'claude'];
const STORAGE_PREFIX = 'mindos:native-runtime-detection:v3:';
const LEGACY_STORAGE_PREFIXES = ['mindos:native-runtime-detection:v2:', 'mindos:native-runtime-detection:v1:'];
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

function shouldRevalidate(): boolean {
  return true;
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

export function useNativeRuntimeDetection(): NativeRuntimeDetectionState {
  const [initialCaches] = useState(() => new Map(RUNTIME_KINDS.map((kind) => [kind, readRuntimeCache(kind)] as const)));
  const [runtimes, setRuntimes] = useState<AgentRuntimeDescriptor[]>(() => (
    RUNTIME_KINDS
      .map((kind) => initialCaches.get(kind)?.runtime)
      .filter((runtime): runtime is AgentRuntimeDescriptor => !!runtime)
  ));
  const [loadingByKind, setLoadingByKind] = useState<RuntimeLoadingMap>(() => Object.fromEntries(
    RUNTIME_KINDS.map((kind) => [kind, shouldRevalidate()]),
  ) as RuntimeLoadingMap);
  const [errorByKind, setErrorByKind] = useState<RuntimeErrorMap>({});
  const [trigger, setTrigger] = useState(0);
  const forceRef = useRef(false);

  const refresh = useCallback(() => {
    for (const kind of RUNTIME_KINDS) removeRuntimeCache(kind);
    forceRef.current = true;
    setLoadingByKind({ codex: true, claude: true });
    setErrorByKind({ codex: null, claude: null });
    setTrigger((value) => value + 1);
  }, []);

  useEffect(() => {
    const onSettingsChanged = () => refresh();
    window.addEventListener('mindos:settings-changed', onSettingsChanged);
    return () => window.removeEventListener('mindos:settings-changed', onSettingsChanged);
  }, [refresh]);

  useEffect(() => {
    const controllers: AbortController[] = [];
    let cancelled = false;
    const isForce = forceRef.current;
    forceRef.current = false;

    for (const kind of RUNTIME_KINDS) {
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);

      setLoadingByKind((current) => ({ ...current, [kind]: true }));
      setErrorByKind((current) => ({ ...current, [kind]: null }));

      fetch(`/api/agent-runtimes?runtime=${kind}${isForce ? '&force=1' : ''}`, { cache: 'no-store', signal: controller.signal })
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
  }, [initialCaches, trigger]);

  return { runtimes, loadingByKind, errorByKind, refresh };
}
