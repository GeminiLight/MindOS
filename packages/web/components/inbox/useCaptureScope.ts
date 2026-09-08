'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** Static HTML cannot identify the runtime vault. Never guess a shared default. */
export function useCaptureScope() {
  const [scope, setScope] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback(async (invalidate = false): Promise<string | null> => {
    const request = ++sequence.current;
    // Same-vault focus/submit checks preserve the input node and caret. A known
    // settings change invalidates immediately; every server write also checks identity.
    if (invalidate) setReady(false);
    try {
      const data = await apiFetch<{ rootId?: unknown }>('/api/connect', { timeout: 15_000, cache: 'no-store' });
      if (typeof data?.rootId !== 'string' || !data.rootId.trim()) throw new Error('Missing vault identity');
      if (!mounted.current || sequence.current !== request) return null;
      setScope(data.rootId); setReady(true); setError(false);
      return data.rootId;
    } catch {
      if (mounted.current && sequence.current === request) { setError(true); setReady(false); }
      return null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const confirm = () => { void refresh(); };
    const changed = () => { void refresh(true); };
    const onVisibility = () => { if (document.visibilityState === 'visible') confirm(); };
    confirm();
    window.addEventListener('mindos:settings-changed', changed);
    window.addEventListener('focus', confirm);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false; sequence.current += 1;
      window.removeEventListener('mindos:settings-changed', changed);
      window.removeEventListener('focus', confirm);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);
  return { scope, ready, error, refresh };
}
