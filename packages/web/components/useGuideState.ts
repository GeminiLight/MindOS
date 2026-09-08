'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { EMPTY_GUIDE_SNAPSHOT, guideStore } from './guide-state-store';

/** Views subscribe to the queue; they do not own its in-flight writes. */
export function useGuideState(store = guideStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_GUIDE_SNAPSHOT);
  useEffect(() => {
    const refresh = () => { void store.load(); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('guide-state-updated', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('guide-state-updated', refresh);
    };
  }, [store]);
  return { ...snapshot, patchGuide: store.patchGuide, retry: store.retry };
}
