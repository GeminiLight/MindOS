'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AcpRegistryEntry } from '@/lib/acp/types';

interface AcpRegistryState {
  agents: AcpRegistryEntry[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useAcpRegistry(): AcpRegistryState {
  const [agents, setAgents] = useState<AcpRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const retry = useCallback(() => {
    setTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/acp/registry')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setAgents(data.registry?.agents ?? []);
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

  return { agents, loading, error, retry };
}
