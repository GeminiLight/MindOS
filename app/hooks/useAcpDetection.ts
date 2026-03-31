'use client';

import { useState, useEffect, useCallback } from 'react';

export interface DetectedAgent {
  id: string;
  name: string;
  binaryPath: string;
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

export function useAcpDetection(): AcpDetectionState {
  const [installedAgents, setInstalledAgents] = useState<DetectedAgent[]>([]);
  const [notInstalledAgents, setNotInstalledAgents] = useState<NotInstalledAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refresh = useCallback(() => {
    setTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/acp/detect')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setInstalledAgents(data.installed ?? []);
        setNotInstalledAgents(data.notInstalled ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [trigger]);

  return { installedAgents, notInstalledAgents, loading, error, refresh };
}
