'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentRuntimeDescriptor, AgentRuntimeStatus } from '@/lib/types';

export interface DetectedAgent {
  id: string;
  name: string;
  binaryPath: string;
  status?: Exclude<AgentRuntimeStatus, 'missing'>;
  reason?: string;
  resolvedCommand?: {
    cmd: string;
    args: string[];
    source: 'user-override' | 'descriptor' | 'registry';
  };
}

export interface NotInstalledAgent {
  id: string;
  name: string;
  installCmd: string;
  packageName?: string;
}

interface AcpDetectionState {
  installedAgents: DetectedAgent[];
  notInstalledAgents: NotInstalledAgent[];
  runtimes: AgentRuntimeDescriptor[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const STORAGE_KEY = 'mindos:acp-detection:v5';
const LEGACY_STORAGE_KEYS = ['mindos:acp-detection:v4', 'mindos:acp-detection:v3', 'mindos:acp-detection:v2', 'mindos:acp-detection'];
const STALE_TTL_MS = 30 * 60 * 1000;
const REVALIDATE_TTL_MS = 30 * 60 * 1000;
const DETECTION_TIMEOUT_MS = 45000;

export interface DetectionCache {
  installed: DetectedAgent[];
  notInstalled: NotInstalledAgent[];
  runtimes?: AgentRuntimeDescriptor[];
  ts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAcpRuntimeDescriptor(value: unknown): value is AgentRuntimeDescriptor {
  return isRecord(value) &&
    value.kind === 'acp' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.status === 'string' &&
    isRecord(value.capabilities) &&
    isRecord(value.lifecycle) &&
    isRecord(value.compatibility);
}

export function readAcpDetectionCacheFromStorage(): DetectionCache | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.installed) ||
      !Array.isArray(parsed.notInstalled) ||
      typeof parsed.ts !== 'number' ||
      Date.now() - parsed.ts > STALE_TTL_MS
    ) {
      return null;
    }
    return {
      installed: parsed.installed as DetectedAgent[],
      notInstalled: parsed.notInstalled as NotInstalledAgent[],
      ...(Array.isArray(parsed.runtimes)
        ? { runtimes: parsed.runtimes.filter(isAcpRuntimeDescriptor) }
        : {}),
      ts: parsed.ts,
    };
  } catch {
    return null;
  }
}

function writeStorage(installed: DetectedAgent[], notInstalled: NotInstalledAgent[], runtimes: AgentRuntimeDescriptor[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      installed,
      notInstalled,
      runtimes: runtimes.filter(isAcpRuntimeDescriptor),
      ts: Date.now(),
    }));
  } catch { /* quota exceeded */ }
}

export function useAcpDetection(): AcpDetectionState {
  const [initialCache] = useState<DetectionCache | null>(() => readAcpDetectionCacheFromStorage());
  const cached = useRef<DetectionCache | null>(initialCache);
  const [installedAgents, setInstalledAgents] = useState<DetectedAgent[]>(() => initialCache?.installed ?? []);
  const [notInstalledAgents, setNotInstalledAgents] = useState<NotInstalledAgent[]>(() => initialCache?.notInstalled ?? []);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDescriptor[]>(() => initialCache?.runtimes ?? []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const inflight = useRef(false);

  const forceRef = useRef(false);

  const refresh = useCallback(() => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    for (const key of LEGACY_STORAGE_KEYS) {
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
    }
    cached.current = null;
    forceRef.current = true;
    setTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    const onSettingsChanged = () => refresh();
    window.addEventListener('mindos:settings-changed', onSettingsChanged);
    return () => window.removeEventListener('mindos:settings-changed', onSettingsChanged);
  }, [refresh]);

  useEffect(() => {
    const isForce = forceRef.current;
    forceRef.current = false;

    const fresh = cached.current &&
      Date.now() - cached.current.ts < REVALIDATE_TTL_MS;
    if (fresh && trigger === 0) return;

    if (inflight.current) return;
    inflight.current = true;

    const hasCachedData = installedAgents.length > 0 || notInstalledAgents.length > 0 || runtimes.length > 0;
    if (!hasCachedData) setLoading(true);
    setError(null);

    let cancelled = false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DETECTION_TIMEOUT_MS);

    fetch(`/api/agent-runtimes?scope=acp${isForce ? '&force=1' : ''}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const inst: DetectedAgent[] = data.installed ?? [];
        const notInst: NotInstalledAgent[] = data.notInstalled ?? [];
        const runtimeData: AgentRuntimeDescriptor[] = Array.isArray(data.runtimes) ? data.runtimes.filter(isAcpRuntimeDescriptor) : [];
        writeStorage(inst, notInst, runtimeData);
        cached.current = { installed: inst, notInstalled: notInst, runtimes: runtimeData, ts: Date.now() };
        setInstalledAgents(inst);
        setNotInstalledAgents(notInst);
        setRuntimes(runtimeData);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof DOMException && err.name === 'AbortError'
          ? `Agent runtime detection timed out after ${DETECTION_TIMEOUT_MS}ms.`
          : (err as Error).message;
        if (!hasCachedData) setError(message);
      })
      .finally(() => {
        clearTimeout(timeout);
        inflight.current = false;
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
      inflight.current = false;
    };
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return { installedAgents, notInstalledAgents, runtimes, loading, error, refresh };
}
