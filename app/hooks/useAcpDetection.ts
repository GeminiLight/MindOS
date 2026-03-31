'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface DetectedAgent {
  id: string;
  name: string;
  binaryPath: string;
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
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const STORAGE_KEY = 'mindos:acp-detection';
const STALE_TTL_MS = 30 * 60 * 1000;
const REVALIDATE_TTL_MS = 5 * 60 * 1000;

interface DetectionCache {
  installed: DetectedAgent[];
  notInstalled: NotInstalledAgent[];
  ts: number;
}

function readStorage(): DetectionCache | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > STALE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(installed: DetectedAgent[], notInstalled: NotInstalledAgent[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ installed, notInstalled, ts: Date.now() }));
  } catch { /* quota exceeded */ }
}

export function useAcpDetection(): AcpDetectionState {
  const cached = useRef(readStorage());
  const [installedAgents, setInstalledAgents] = useState<DetectedAgent[]>(cached.current?.installed ?? []);
  const [notInstalledAgents, setNotInstalledAgents] = useState<NotInstalledAgent[]>(cached.current?.notInstalled ?? []);
  const [loading, setLoading] = useState(!cached.current);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const inflight = useRef(false);

  const forceRef = useRef(false);

  const refresh = useCallback(() => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    cached.current = null;
    forceRef.current = true;
    setTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    const isForce = forceRef.current;
    forceRef.current = false;

    const fresh = cached.current && Date.now() - cached.current.ts < REVALIDATE_TTL_MS;
    if (fresh && trigger === 0) return;

    if (inflight.current) return;
    inflight.current = true;

    const hasCachedData = installedAgents.length > 0 || notInstalledAgents.length > 0;
    if (!hasCachedData) setLoading(true);
    setError(null);

    let cancelled = false;

    fetch(`/api/acp/detect${isForce ? '?force=1' : ''}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const inst: DetectedAgent[] = data.installed ?? [];
        const notInst: NotInstalledAgent[] = data.notInstalled ?? [];
        writeStorage(inst, notInst);
        cached.current = { installed: inst, notInstalled: notInst, ts: Date.now() };
        setInstalledAgents(inst);
        setNotInstalledAgents(notInst);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!hasCachedData) setError((err as Error).message);
      })
      .finally(() => {
        inflight.current = false;
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return { installedAgents, notInstalledAgents, loading, error, refresh };
}
