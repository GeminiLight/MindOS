'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AcpAgentOverride } from '@/lib/acp/agent-descriptors';

interface AcpConfigState {
  configs: Record<string, AcpAgentOverride>;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** Save a per-agent override. */
  save: (agentId: string, config: AcpAgentOverride) => Promise<boolean>;
  /** Reset a single agent to defaults. */
  reset: (agentId: string) => Promise<boolean>;
  /** Refresh from server. */
  refresh: () => void;
}

export function useAcpConfig(): AcpConfigState {
  const [configs, setConfigs] = useState<Record<string, AcpAgentOverride>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refresh = useCallback(() => setTrigger((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/acp/config')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setConfigs(data.agents ?? {});
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [trigger]);

  const save = useCallback(async (agentId: string, config: AcpAgentOverride): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/acp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, config }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfigs(data.agents ?? {});
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const reset = useCallback(async (agentId: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/acp/config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfigs(data.agents ?? {});
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { configs, loading, saving, error, save, reset, refresh };
}
