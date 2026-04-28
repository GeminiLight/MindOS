'use client';

import { useEffect, useState } from 'react';
import { isAiConfiguredForAsk, type SettingsJsonForAi } from '@/lib/settings-ai-client';

export function useSettingsAiAvailable(): { ready: boolean; loading: boolean } {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      fetch('/api/settings', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: SettingsJsonForAi) => {
          if (!cancelled) setReady(isAiConfiguredForAsk(d));
        })
        .catch(() => {
          if (!cancelled) setReady(false);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    doFetch();
    const onChanged = () => doFetch();
    window.addEventListener('mindos:settings-changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('mindos:settings-changed', onChanged);
    };
  }, []);

  return { ready, loading };
}
