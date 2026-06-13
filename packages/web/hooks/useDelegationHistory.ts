'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useVisiblePolling } from '@/lib/use-visible-polling';
import type { DelegationRecord } from '@/lib/a2a/types';

interface DelegationHistory {
  delegations: DelegationRecord[];
  loading: boolean;
  refresh: () => void;
}

const POLL_INTERVAL_MS = 5_000;

export function useDelegationHistory(active: boolean): DelegationHistory {
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/a2a/delegations');
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current) {
        setDelegations(data.delegations ?? []);
      }
    } catch {
      // silently ignore fetch errors
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch on activation and poll while active — paused when the tab is hidden
  useVisiblePolling(() => void fetchHistory(), POLL_INTERVAL_MS, { enabled: active });

  return { delegations, loading, refresh: fetchHistory };
}
