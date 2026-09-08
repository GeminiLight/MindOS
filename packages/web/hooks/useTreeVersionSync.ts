'use client';

import { startTransition, useEffect } from 'react';
import { notifyFilesChanged } from '@/lib/files-changed';
import { refreshPreservingDocumentScroll } from '@/lib/scroll-preservation';
import { getServerEventsState, subscribeServerEvents } from '@/lib/server-events';
import { telemetry } from '@/lib/telemetry';

/**
 * Safety poll of `/api/tree-version`, used only while the server event stream
 * is not connected (idle-polling budget contract: a connected tab issues no
 * tree-version requests at all after the mount baseline).
 */
export const FALLBACK_POLL_INTERVAL_MS = 60_000;
/** Minimum spacing between two `router.refresh()` calls during bulk file operations. */
export const REFRESH_COOLDOWN_MS = 2_000;

type TreeVersionSource = 'tree.changed' | 'ready' | 'poll';

/**
 * Keeps the server-rendered file tree in sync with the mind root: refreshes
 * the router when the tree version changes, driven by `tree.changed` /
 * `ready` frames from `/api/events`, with a slow poll as the degraded path.
 */
export function useTreeVersionSync(router: { refresh: () => void }): void {
  useEffect(() => {
    let lastVersion = -1;
    let stopped = false;
    let lastRefreshTime = 0;
    let pendingRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    const doRefresh = (version: number, previousVersion: number, source: TreeVersionSource) => {
      lastRefreshTime = Date.now();
      const stopRefresh = telemetry.startTimer('tree.refresh.trigger');
      startTransition(() => {
        refreshPreservingDocumentScroll(() => router.refresh());
      });
      stopRefresh({ previousVersion, version, reason: 'tree_version_changed', source });
      // `tree.changed` frames are already bridged onto mindos:files-changed by
      // lib/server-events.ts; only the other sources need to broadcast here.
      if (source !== 'tree.changed') notifyFilesChanged();
    };

    const applyVersion = (version: number, source: TreeVersionSource) => {
      if (stopped || !Number.isFinite(version)) return;
      if (lastVersion === -1) {
        lastVersion = version;
        return;
      }
      if (version === lastVersion) return;
      const previousVersion = lastVersion;
      lastVersion = version;

      const elapsed = Date.now() - lastRefreshTime;
      if (elapsed < REFRESH_COOLDOWN_MS) {
        if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
        pendingRefreshTimer = setTimeout(() => {
          pendingRefreshTimer = null;
          if (!stopped) doRefresh(version, previousVersion, source);
        }, REFRESH_COOLDOWN_MS - elapsed);
        return;
      }
      doRefresh(version, previousVersion, source);
    };

    const checkVersion = async () => {
      if (stopped || document.visibilityState === 'hidden') return;
      // The stream carries versions itself; polling while connected would only duplicate it.
      if (getServerEventsState() === 'connected') return;
      const stop = telemetry.startTimer('tree.version.poll');
      try {
        const res = await fetch('/api/tree-version');
        if (!res.ok) {
          stop({ ok: false, changed: false });
          return;
        }
        const { v } = (await res.json()) as { v: number };
        const previous = lastVersion;
        applyVersion(v, 'poll');
        stop({ ok: true, changed: previous !== -1 && previous !== v, version: v, initial: previous === -1 });
      } catch (err) {
        stop({ ok: false, changed: false });
        console.debug('[tree-version] poll failed', err);
      }
    };

    const unsubscribeTree = subscribeServerEvents('tree.changed', (event) => {
      applyVersion(event.version, 'tree.changed');
    });
    const unsubscribeReady = subscribeServerEvents('ready', (event) => {
      if (typeof event.treeVersion === 'number') applyVersion(event.treeVersion, 'ready');
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkVersion();
    };

    void checkVersion();
    const interval = setInterval(() => void checkVersion(), FALLBACK_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(interval);
      if (pendingRefreshTimer) clearTimeout(pendingRefreshTimer);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribeReady();
      unsubscribeTree();
    };
  }, [router]);
}
