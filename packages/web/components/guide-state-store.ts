import type { GuideState } from '@/lib/settings';

const REQUEST_TIMEOUT_MS = 15_000;
type SetupGuideResponse = { activeProvider?: string; providerConfigs?: Array<{ id?: string }>; guideState?: GuideState };
type GuideSnapshot = {
  guideState: GuideState | null;
  aiConfigured: boolean;
  error: 'load' | 'save' | null;
  pending: boolean;
  saving: boolean;
};
export const EMPTY_GUIDE_SNAPSHOT: GuideSnapshot = {
  guideState: null, aiConfigured: false, error: null, pending: false, saving: false,
};

/** Tab memory only. Navigation must not abandon queued onboarding choices. */
export function createGuideStore(request: typeof fetch = (...args) => fetch(...args)) {
  let snapshot = EMPTY_GUIDE_SNAPSHOT;
  let pendingPatch: Partial<GuideState> | null = null;
  let revision = 0;
  let readId = 0;
  let writing: Promise<void> | null = null;
  let guarding = false;
  const listeners = new Set<() => void>();
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
  function publish(next: GuideSnapshot) {
    snapshot = next;
    // Keep page-exit protection even after the homepage subscriber unmounts.
    if (typeof window !== 'undefined' && next.pending !== guarding) {
      guarding = next.pending;
      if (guarding) window.addEventListener('beforeunload', warn);
      else window.removeEventListener('beforeunload', warn);
    }
    listeners.forEach(listener => listener());
  }

  async function load() {
    if (pendingPatch) return;
    const expectedRevision = revision;
    const id = ++readId;
    try {
      const response = await request('/api/setup', { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error('Guide load failed');
      const data: SetupGuideResponse = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid setup response');
      if (revision !== expectedRevision || id !== readId) return;
      publish({ ...snapshot,
        aiConfigured: Boolean(data.activeProvider && data.activeProvider !== 'skip' && Array.isArray(data.providerConfigs) && data.providerConfigs.some(p => p?.id === data.activeProvider)),
        guideState: data.guideState?.active ? data.guideState : null,
        error: null,
      });
    } catch {
      if (revision === expectedRevision && id === readId) publish({ ...snapshot, error: 'load' });
    }
  }

  function flush(): Promise<void> {
    if (writing) return writing;
    if (!pendingPatch) return Promise.resolve();
    publish({ ...snapshot, saving: true });
    let failed = false;
    writing = Promise.resolve().then(async () => {
      while (pendingPatch) {
        const patch = pendingPatch;
        const expectedRevision = revision;
        try {
          const response = await request('/api/setup', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guideState: patch }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) throw new Error('Guide save failed');
          if (expectedRevision === revision) {
            pendingPatch = null;
            publish({ ...snapshot, pending: false, error: null });
          }
        } catch {
          failed = true;
          publish({ ...snapshot, error: 'save' });
          return;
        }
      }
    }).finally(() => {
      writing = null;
      publish({ ...snapshot, saving: false });
      // Continue edits arriving between the last acknowledgement and cleanup,
      // but leave failed writes visible until explicit retry or a new choice.
      if (!failed && pendingPatch) void flush();
    });
    return writing;
  }

  function patchGuide(patch: Partial<GuideState>) {
    revision += 1;
    pendingPatch = { ...pendingPatch, ...patch };
    publish({ ...snapshot, pending: true, guideState: snapshot.guideState ? { ...snapshot.guideState, ...patch } : null });
    void flush();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load, patchGuide,
    retry: () => pendingPatch ? flush() : load(),
  };
}

export const guideStore = createGuideStore();
