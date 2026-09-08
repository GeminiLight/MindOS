import type { SetStateAction } from 'react';
import type { SettingsData, Tab } from './types';
import { saveSettingsDocument } from './settings-save';

export type SettingsDraftSnapshot = {
  data: SettingsData | null;
  pending: boolean;
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  hasFailed: boolean;
  tab: Tab;
  revision: number;
};
export const EMPTY_SETTINGS_DRAFT: SettingsDraftSnapshot = {
  data: null, pending: false, status: 'idle', hasFailed: false, tab: 'ai', revision: 0,
};

/** Tab-memory only: credentials must never become a localStorage/sessionStorage draft. */
export function createSettingsDraftStore(save: (data: SettingsData) => Promise<unknown>, onSaved = () => {}) {
  let snapshot = EMPTY_SETTINGS_DRAFT;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<boolean> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SettingsDraftSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  function flush(): Promise<boolean> {
    clearTimeout(timer);
    if (writing) return writing;
    if (!snapshot.pending || !snapshot.data) return Promise.resolve(true);
    publish({ ...snapshot, status: 'saving' });
    writing = Promise.resolve().then(async () => {
      while (snapshot.pending && snapshot.data) {
        const payload = snapshot.data;
        const revision = snapshot.revision;
        try {
          await save(payload);
          if (revision === snapshot.revision) {
            publish({ ...snapshot, pending: false, status: 'saved', hasFailed: false });
            onSaved();
          }
        } catch {
          // An older failure must not replace a newer edit or its eventual success.
          if (revision !== snapshot.revision) continue;
          publish({ ...snapshot, status: 'error', hasFailed: true });
          return false;
        }
      }
      return true;
    }).finally(() => {
      writing = undefined;
      clearTimeout(timer);
      // Covers an edit arriving between the last response and this finalizer.
      if (snapshot.pending && snapshot.status !== 'error') queueMicrotask(() => { void flush(); });
    });
    return writing;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    acceptLoaded: (data: SettingsData, expectedRevision = snapshot.revision) => {
      if (snapshot.pending || snapshot.revision !== expectedRevision) return;
      publish({ ...snapshot, data, status: 'idle', revision: snapshot.revision + 1 });
    },
    update: (action: SetStateAction<SettingsData | null>, tab: Tab) => {
      const data = typeof action === 'function' ? action(snapshot.data) : action;
      if (!data || data === snapshot.data) return;
      publish({ ...snapshot, data, tab, pending: true, status: writing ? 'saving' : 'pending', revision: snapshot.revision + 1 });
      clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, 800);
    },
    flush,
  };
}

export const settingsDraftStore = createSettingsDraftStore(saveSettingsDocument, () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('mindos:settings-changed'));
});
