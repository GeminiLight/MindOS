'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AcpRegistryEntry } from '@/lib/acp/types';

interface AcpRegistryState {
  agents: AcpRegistryEntry[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const STORAGE_KEY = 'mindos:acp-registry';
const STALE_TTL_MS = 30 * 60 * 1000; // 30 min — show stale data instantly
const REVALIDATE_TTL_MS = 10 * 60 * 1000; // 10 min — background refresh interval

export interface RegistryCache {
  agents: AcpRegistryEntry[];
  ts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readAcpRegistryCacheFromStorage(): RegistryCache | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.agents) || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > STALE_TTL_MS) return null;
    return { agents: parsed.agents as AcpRegistryEntry[], ts: parsed.ts };
  } catch {
    return null;
  }
}

function writeStorage(agents: AcpRegistryEntry[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ agents, ts: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}

export function useAcpRegistry(): AcpRegistryState {
  const [initialCache] = useState<RegistryCache | null>(() => readAcpRegistryCacheFromStorage());
  const cached = useRef<RegistryCache | null>(initialCache);
  const [agents, setAgents] = useState<AcpRegistryEntry[]>(() => initialCache?.agents ?? []);
  const [loading, setLoading] = useState(() => !initialCache);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const inflight = useRef(false);

  const retry = useCallback(() => {
    setTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    const fresh = cached.current && Date.now() - cached.current.ts < REVALIDATE_TTL_MS;
    if (fresh && trigger === 0) return;

    if (inflight.current) return;
    inflight.current = true;

    const hasCachedData = agents.length > 0;
    if (!hasCachedData) setLoading(true);
    setError(null);

    let cancelled = false;

    fetch('/api/acp/registry')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: AcpRegistryEntry[] = data.registry?.agents ?? [];
        writeStorage(list);
        cached.current = { agents: list, ts: Date.now() };
        setAgents(list);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!hasCachedData) setError((err as Error).message);
      })
      .finally(() => {
        inflight.current = false;
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; inflight.current = false; };
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return { agents, loading, error, retry };
}
