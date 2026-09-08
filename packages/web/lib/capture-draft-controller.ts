import type { SetStateAction } from 'react';
import { captureDraftStorage, CaptureDraftConflictError, type CaptureDraft, type CaptureDraftStorage } from './capture-draft-storage';

type DraftStatus = 'loading' | 'saving' | 'saved' | 'unavailable' | 'conflict';
export type CaptureDraftSnapshot = { value: CaptureDraft; ready: boolean; status: DraftStatus };
const emptyDraft = (): CaptureDraft => ({ draftText: '', stagedNotes: [], pendingUrls: [], pendingFiles: [] });
export const EMPTY_CAPTURE_SNAPSHOT: CaptureDraftSnapshot = { value: emptyDraft(), ready: false, status: 'loading' };
const hasContent = (value: CaptureDraft) => Boolean(value.draftText || value.stagedNotes.length || value.pendingFiles.length || value.pendingUrls.length);

/** Retained across route changes so a pending write or unavailable storage cannot discard input. */
export function createCaptureDraftController(scope: string, storage: CaptureDraftStorage = captureDraftStorage) {
  let snapshot = EMPTY_CAPTURE_SNAPSHOT;
  let revision: string | null = null;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let loading: Promise<void> | undefined;
  let writing: Promise<void> | undefined;
  let guarding = false;
  const listeners = new Set<() => void>();
  const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
  const publish = (next: CaptureDraftSnapshot) => {
    snapshot = next;
    const needsGuard = hasContent(next.value) && next.status !== 'saved';
    if (typeof window !== 'undefined' && needsGuard !== guarding) {
      guarding = needsGuard;
      if (guarding) window.addEventListener('beforeunload', beforeUnload);
      else window.removeEventListener('beforeunload', beforeUnload);
    }
    listeners.forEach(listener => listener());
  };

  function hydrate() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const record = await storage.read(scope);
        revision = record?.revision ?? null;
        publish({ value: record?.value ?? emptyDraft(), ready: true, status: 'saved' });
      } catch {
        publish({ value: emptyDraft(), ready: true, status: 'unavailable' });
      }
    })();
    return loading;
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    if (writing) return writing;
    if (!snapshot.ready) return hydrate();
    publish({ ...snapshot, status: 'saving' });
    writing = (async () => {
      while (true) {
        const savedSequence = sequence;
        const value = snapshot.value;
        try {
          revision = await storage.write(scope, revision, value);
          if (savedSequence === sequence) {
            publish({ ...snapshot, status: 'saved' });
            break;
          }
        } catch (error) {
          publish({ ...snapshot, status: error instanceof CaptureDraftConflictError ? 'conflict' : 'unavailable' });
          break;
        }
      }
    })().finally(() => {
      clearTimeout(timer);
      writing = undefined;
      // An edit can arrive after publishing "saved" but before this cleanup.
      // Keep that pending write; unavailable/conflict states still require recovery.
      if (snapshot.status === 'saving') queueMicrotask(() => { void flush(); });
    });
    return writing;
  }

  function update(value: CaptureDraft) {
    if (!snapshot.ready) return;
    sequence++;
    publish({ value, ready: true, status: 'saving' });
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 200);
  }
  function setter<K extends keyof CaptureDraft>(key: K) {
    return (action: SetStateAction<CaptureDraft[K]>) => {
      const previous = snapshot.value[key];
      const value = typeof action === 'function' ? (action as (value: CaptureDraft[K]) => CaptureDraft[K])(previous) : action;
      if (value !== previous) update({ ...snapshot.value, [key]: value });
    };
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      void hydrate();
      return () => { listeners.delete(listener); };
    },
    hydrate,
    flush,
    clear: () => update(emptyDraft()),
    setDraftText: setter('draftText'),
    setStagedNotes: setter('stagedNotes'),
    setPendingUrls: setter('pendingUrls'),
    setPendingFiles: setter('pendingFiles'),
  };
}

const controllers = new Map<string, ReturnType<typeof createCaptureDraftController>>();
export function getCaptureDraftController(scope: string) {
  let controller = controllers.get(scope);
  if (!controller) { controller = createCaptureDraftController(scope); controllers.set(scope, controller); }
  return controller;
}
