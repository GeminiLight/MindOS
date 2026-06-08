'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/api';
import type { SyncStatus } from '@/components/settings/types';
import { formatSyncError, SYNC_ACTION_TIMEOUT_MS } from '@/lib/sync-ui';

type SyncStatusSnapshot = {
  status: SyncStatus | null;
  loaded: boolean;
  error: string | null;
};

const SYNC_STATUS_POLL_INTERVAL = 30_000;

let syncStatusSnapshot: SyncStatusSnapshot = { status: null, loaded: false, error: null };
let syncStatusInFlight: Promise<void> | null = null;
let syncStatusInFlightToken: symbol | null = null;
let syncStatusInterval: ReturnType<typeof setInterval> | undefined;
let syncStatusSubscribers = 0;
const syncStatusListeners = new Set<() => void>();

function emitSyncStatus() {
  for (const listener of syncStatusListeners) listener();
}

function setSyncStatusSnapshot(next: SyncStatusSnapshot) {
  syncStatusSnapshot = next;
  emitSyncStatus();
}

function getSyncStatusSnapshot(): SyncStatusSnapshot {
  return syncStatusSnapshot;
}

export async function fetchSharedSyncStatus(opts: { force?: boolean } = {}) {
  if (syncStatusInFlight && !opts.force) return syncStatusInFlight;
  const requestToken = Symbol('sync-status-fetch');
  syncStatusInFlightToken = requestToken;

  const request = (async () => {
    try {
      const data = await apiFetch<SyncStatus>('/api/sync', { timeout: 10_000 });
      if (syncStatusInFlightToken === requestToken) {
        setSyncStatusSnapshot({ status: data, loaded: true, error: null });
      }
    } catch (error) {
      if (syncStatusInFlightToken === requestToken) {
        const message = error instanceof Error ? error.message : String(error);
        setSyncStatusSnapshot({ status: syncStatusSnapshot.status, loaded: true, error: message });
      }
    } finally {
      if (syncStatusInFlightToken === requestToken) {
        syncStatusInFlight = null;
        syncStatusInFlightToken = null;
      }
    }
  })();

  syncStatusInFlight = request;
  return request;
}

function startSyncStatusPolling() {
  if (syncStatusInterval) return;
  void fetchSharedSyncStatus();
  syncStatusInterval = setInterval(() => {
    if (document.visibilityState === 'visible') void fetchSharedSyncStatus();
  }, SYNC_STATUS_POLL_INTERVAL);
}

function stopSyncStatusPolling() {
  if (!syncStatusInterval) return;
  clearInterval(syncStatusInterval);
  syncStatusInterval = undefined;
}

function handleSyncVisibilityChange() {
  if (document.visibilityState === 'visible') {
    startSyncStatusPolling();
    void fetchSharedSyncStatus();
  } else {
    stopSyncStatusPolling();
  }
}

function subscribeSyncStatus(listener: () => void) {
  syncStatusListeners.add(listener);
  syncStatusSubscribers += 1;
  if (syncStatusSubscribers === 1) {
    startSyncStatusPolling();
    document.addEventListener('visibilitychange', handleSyncVisibilityChange);
  }

  return () => {
    syncStatusListeners.delete(listener);
    syncStatusSubscribers = Math.max(0, syncStatusSubscribers - 1);
    if (syncStatusSubscribers === 0) {
      stopSyncStatusPolling();
      document.removeEventListener('visibilitychange', handleSyncVisibilityChange);
    }
  };
}

export function useSyncStatus() {
  const { status, loaded, error } = useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatusSnapshot,
    getSyncStatusSnapshot,
  );
  const fetchStatus = useCallback(() => fetchSharedSyncStatus({ force: true }), []);

  return { status, loaded, error, fetchStatus };
}

export function useSyncAction(refreshFn: () => Promise<void>, syncT?: Record<string, unknown>) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'now' }),
        timeout: SYNC_ACTION_TIMEOUT_MS,
      });
      await refreshFn();
      setSyncResult('success');
    } catch (error) {
      try { await refreshFn(); } catch {}
      const raw = error instanceof Error ? error.message : 'Sync failed';
      setSyncError(formatSyncError(raw, syncT));
      setSyncResult('error');
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshFn, syncT]);

  useEffect(() => {
    if (syncResult !== 'success') return;
    const id = setTimeout(() => setSyncResult(null), 2500);
    return () => clearTimeout(id);
  }, [syncResult]);

  return { syncing, syncResult, syncError, syncNow };
}

export function resetSyncStatusStoreForTests() {
  stopSyncStatusPolling();
  syncStatusSnapshot = { status: null, loaded: false, error: null };
  syncStatusInFlight = null;
  syncStatusInFlightToken = null;
  syncStatusSubscribers = 0;
  syncStatusListeners.clear();
}
