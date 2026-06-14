'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlatformStatus } from '@/lib/im/platforms';
import { getCachedStatuses, loadChannelStatuses } from './cache';

interface UseChannelStatusesOptions {
  enabled?: boolean;
}

interface RefreshOptions {
  background?: boolean;
  force?: boolean;
}

export function useChannelStatuses({ enabled = true }: UseChannelStatusesOptions = {}) {
  const initial = getCachedStatuses();
  const mountedRef = useRef(true);
  const [statuses, setStatuses] = useState<PlatformStatus[]>(initial.data);
  const [loading, setLoading] = useState(enabled && initial.data.length === 0);
  const [error, setError] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async ({ background = false, force = false }: RefreshOptions = {}) => {
    if (!enabled) return null;

    const cached = getCachedStatuses();
    if (!force && !cached.stale) {
      if (mountedRef.current) {
        setStatuses(cached.data);
        setLoading(false);
        setError(false);
      }
      return cached.data;
    }

    if (mountedRef.current) {
      setError(false);
      if (!background) setLoading(true);
    }

    try {
      const next = await loadChannelStatuses();
      if (mountedRef.current) {
        setStatuses(next);
        setLoading(false);
      }
      return next;
    } catch {
      if (mountedRef.current) {
        setLoading(false);
        if (!background) setError(true);
      }
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const cached = getCachedStatuses();
    setStatuses(cached.data);
    if (cached.stale) {
      void refresh({ background: cached.data.length > 0 });
    } else {
      setLoading(false);
      setError(false);
    }
  }, [enabled, refresh]);

  return {
    statuses,
    loading,
    error,
    refresh: () => refresh({ force: true }),
  };
}
