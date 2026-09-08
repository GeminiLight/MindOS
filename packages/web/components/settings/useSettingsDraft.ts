'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { EMPTY_SETTINGS_DRAFT, settingsDraftStore } from './settings-draft';

export function useSettingsDraft() {
  const snapshot = useSyncExternalStore(settingsDraftStore.subscribe, settingsDraftStore.getSnapshot, () => EMPTY_SETTINGS_DRAFT);
  useEffect(() => {
    if (!snapshot.pending) return;
    const protectRefresh = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectRefresh);
    return () => window.removeEventListener('beforeunload', protectRefresh);
  }, [snapshot.pending]);
  return snapshot;
}
