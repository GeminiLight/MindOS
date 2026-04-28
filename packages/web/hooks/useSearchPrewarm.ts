'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type {
  SearchPrewarmEligibility,
  SearchPrewarmResponse,
  SearchWarmHintMessages,
  SearchWarmState,
} from '@/lib/types';

export function shouldStartSearchPrewarm({
  active,
  hasAttemptedPrewarm,
  warmState,
}: SearchPrewarmEligibility): boolean {
  return active && !hasAttemptedPrewarm && warmState === 'idle';
}

export function getSearchWarmHint(
  warmState: SearchWarmState,
  query: string,
  hints: SearchWarmHintMessages = {
    preparing: 'Preparing search...',
    fallbackWarmHint: 'Search will prepare on first query.',
  },
): string | null {
  if (query.trim()) return null;
  if (warmState === 'warming') return hints.preparing;
  if (warmState === 'fallback') return hints.fallbackWarmHint;
  return null;
}

export function useSearchPrewarm(active: boolean): SearchWarmState {
  const [warmState, setWarmState] = useState<SearchWarmState>('idle');
  const hasAttemptedPrewarm = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    if (!shouldStartSearchPrewarm({
      active,
      hasAttemptedPrewarm: hasAttemptedPrewarm.current,
      warmState,
    })) {
      return;
    }

    hasAttemptedPrewarm.current = true;
    setWarmState('warming');

    void apiFetch<SearchPrewarmResponse>('/api/search/prewarm')
      .then(() => {
        if (isMountedRef.current) setWarmState('ready');
      })
      .catch(() => {
        if (isMountedRef.current) setWarmState('fallback');
      });
    // warmState is in deps but won't cause infinite loops because
    // shouldStartSearchPrewarm returns false when warmState !== 'idle'
  }, [active, warmState]);

  // Reset on mount (needed for React 18 StrictMode which unmounts then remounts)
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleFilesChanged = () => {
      hasAttemptedPrewarm.current = false;
      setWarmState('idle');
    };
    window.addEventListener('mindos:files-changed', handleFilesChanged);
    return () => window.removeEventListener('mindos:files-changed', handleFilesChanged);
  }, []);

  useEffect(() => {
    if (!active && warmState === 'fallback') {
      hasAttemptedPrewarm.current = false;
      setWarmState('idle');
    }
  }, [active, warmState]);

  return warmState;
}
