'use client';

import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { EMPTY_GUIDE_SNAPSHOT, guideStore, type GuideBootstrap } from './guide-state-store';

/** Views subscribe to the queue; they do not own its in-flight writes. */
export function useGuideState(store = guideStore, initial?: GuideBootstrap) {
  const serverSnapshot = useMemo(() => initial
    ? { ...EMPTY_GUIDE_SNAPSHOT, ...initial }
    : EMPTY_GUIDE_SNAPSHOT, [initial]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot);
  // Layout effects run before the user can act on the server-rendered card.
  useLayoutEffect(() => { if (initial) store.prime(initial); }, [store, initial]);
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
