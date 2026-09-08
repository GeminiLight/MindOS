'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { EMPTY_CAPTURE_SNAPSHOT, getCaptureDraftController } from '@/lib/capture-draft-controller';
import { useCaptureScope } from './useCaptureScope';

const unavailable = { subscribe: () => () => {}, getSnapshot: () => EMPTY_CAPTURE_SNAPSHOT };

export function useCaptureDraft(identity: ReturnType<typeof useCaptureScope>) {
  const controller = useMemo(() => identity.scope ? getCaptureDraftController(identity.scope) : null, [identity.scope]);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? unavailable.subscribe, controller?.getSnapshot ?? unavailable.getSnapshot, () => EMPTY_CAPTURE_SNAPSHOT);
  // No storage controller is created until the server confirms a real identity.
  return {
    ...snapshot, ready: identity.ready && snapshot.ready, scope: identity.scope, scopeError: identity.error,
    retryScope: identity.refresh,
    confirmScope: async () => Boolean(identity.scope && await identity.refresh() === identity.scope),
    getSnapshot: controller?.getSnapshot ?? unavailable.getSnapshot,
    setDraftText: controller?.setDraftText ?? (() => {}),
    setStagedNotes: controller?.setStagedNotes ?? (() => {}),
    setPendingFiles: controller?.setPendingFiles ?? (() => {}),
    setPendingUrls: controller?.setPendingUrls ?? (() => {}),
    clear: controller?.clear ?? (() => {}),
    flush: controller?.flush ?? (async () => false),
  };
}
