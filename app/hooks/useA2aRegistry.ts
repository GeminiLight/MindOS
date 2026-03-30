'use client';

import { useState, useCallback } from 'react';
import type { RemoteAgent } from '@/lib/a2a/types';

interface A2aRegistry {
  agents: RemoteAgent[];
  discovering: boolean;
  error: string | null;
  discover: (url: string) => Promise<RemoteAgent | null>;
  refresh: () => void;
}

export function useA2aRegistry(): A2aRegistry {
  const [agents, setAgents] = useState<RemoteAgent[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async (url: string): Promise<RemoteAgent | null> => {
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch('/api/a2a/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.agent) {
        setAgents(prev => {
          const exists = prev.some(a => a.id === data.agent.id);
          if (exists) return prev.map(a => a.id === data.agent.id ? data.agent : a);
          return [...prev, data.agent];
        });
        return data.agent as RemoteAgent;
      }
      setError(data.error || 'Discovery failed');
      return null;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setDiscovering(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setAgents([]);
    setError(null);
  }, []);

  return { agents, discovering, error, discover, refresh };
}
