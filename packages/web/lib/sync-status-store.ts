'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { apiFetch } from '@/lib/api';
import type { SyncStatus } from '@/components/settings/types';
import { formatSyncError, hasUnknownUnpushedCount, SYNC_ACTION_TIMEOUT_MS } from '@/lib/sync-ui';

type SyncStatusSnapshot = {
  status: SyncStatus | null;
  loaded: boolean;
  error: string | null;
  stale: boolean;
};

const SYNC_STATUS_POLL_INTERVAL = 30_000;

let syncStatusSnapshot: SyncStatusSnapshot = { status: null, loaded: false, error: null, stale: false };
let syncStatusInFlight: Promise<void> | null = null;
let syncStatusInFlightToken: symbol | null = null;
let syncStatusInterval: ReturnType<typeof setInterval> | undefined;
let syncStatusSubscribers = 0;
const syncStatusListeners = new Set<() => void>();
const syncActionListeners = new Set<() => void>();
let sharedSyncing = false;

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

function emitSyncAction() {
  for (const listener of syncActionListeners) listener();
}

function setSharedSyncing(next: boolean) {
  if (sharedSyncing === next) return;
  sharedSyncing = next;
  emitSyncAction();
}

function tryAcquireSharedSyncing() {
  if (sharedSyncing) return false;
  setSharedSyncing(true);
  return true;
}

function getSharedSyncingSnapshot() {
  return sharedSyncing;
}

function subscribeSyncAction(listener: () => void) {
  syncActionListeners.add(listener);
  return () => syncActionListeners.delete(listener);
}

export async function fetchSharedSyncStatus(opts: { force?: boolean; throwOnError?: boolean } = {}) {
  if (syncStatusInFlight && !opts.force) return syncStatusInFlight;
  const requestToken = Symbol('sync-status-fetch');
  syncStatusInFlightToken = requestToken;

  const request = (async () => {
    try {
      const data = await apiFetch<SyncStatus>('/api/sync', { timeout: 10_000 });
      if (syncStatusInFlightToken === requestToken) {
        setSyncStatusSnapshot({ status: normalizeSyncStatusPayload(data), loaded: true, error: null, stale: false });
      }
    } catch (error) {
      if (syncStatusInFlightToken === requestToken) {
        const message = error instanceof Error ? error.message : String(error);
        setSyncStatusSnapshot({
          status: syncStatusSnapshot.status,
          loaded: true,
          error: message,
          stale: syncStatusSnapshot.status !== null,
        });
      }
      if (opts.throwOnError) throw error;
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

function normalizeSyncStatusPayload(input: SyncStatus): SyncStatus {
  const raw = input as SyncStatus & {
    unpushed?: unknown;
    conflicts?: unknown;
    lastSync?: unknown;
    lastPull?: unknown;
  };
  return {
    ...input,
    lastSync: normalizeSyncTime(raw.lastSync),
    lastPull: normalizeSyncTime(raw.lastPull),
    unpushed: normalizeUnpushed(raw.unpushed),
    conflicts: normalizeSyncConflicts(raw.conflicts),
  };
}

function normalizeUnpushed(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return String(Math.floor(value));
  if (typeof value !== 'string') return '?';
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed : '?';
}

function normalizeSyncTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? value : null;
}

function normalizeSyncConflicts(value: unknown): NonNullable<SyncStatus['conflicts']> {
  const items = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
  const conflicts: NonNullable<SyncStatus['conflicts']> = [];
  for (const item of items) {
    if (typeof item === 'string') {
      const file = item.trim();
      if (file) conflicts.push({ file });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const file = typeof record.file === 'string' ? record.file.trim() : '';
    if (!file) continue;
    conflicts.push({
      file,
      ...(typeof record.time === 'string' && Number.isFinite(new Date(record.time).getTime()) ? { time: record.time } : {}),
      ...(record.noBackup === true ? { noBackup: true } : {}),
      ...(typeof record.localExists === 'boolean' ? { localExists: record.localExists } : {}),
      ...(typeof record.remoteExists === 'boolean' ? { remoteExists: record.remoteExists } : {}),
    });
  }
  return conflicts;
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
  const { status, loaded, error, stale } = useSyncExternalStore(
    subscribeSyncStatus,
    getSyncStatusSnapshot,
    getSyncStatusSnapshot,
  );
  const fetchStatus = useCallback(
    (opts: { throwOnError?: boolean } = {}) => fetchSharedSyncStatus({ force: true, throwOnError: opts.throwOnError }),
    [],
  );

  return { status, loaded, error, stale, fetchStatus };
}

export function useSyncAction(refreshFn: (opts?: { throwOnError?: boolean }) => Promise<void>, syncT?: Record<string, unknown>) {
  const syncing = useSyncExternalStore(
    subscribeSyncAction,
    getSharedSyncingSnapshot,
    getSharedSyncingSnapshot,
  );
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const syncNow = useCallback(async () => {
    if (!tryAcquireSharedSyncing()) return;
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
      const refreshedStatus = syncStatusSnapshot.status;
      if (syncStatusSnapshot.error) {
        setSyncError(formatSyncError(syncStatusSnapshot.error, syncT));
        setSyncResult('error');
      } else if (refreshedStatus?.conflicts?.length) {
        setSyncResult(null);
      } else if (refreshedStatus?.lastError) {
        setSyncError(formatSyncError(refreshedStatus.lastError, syncT));
        setSyncResult('error');
      } else if (refreshedStatus && hasUnknownUnpushedCount(refreshedStatus)) {
        setSyncResult(null);
      } else {
        setSyncResult('success');
      }
    } catch (error) {
      try { await refreshFn(); } catch {}
      const raw = error instanceof Error ? error.message : 'Sync failed';
      setSyncError(formatSyncError(raw, syncT));
      setSyncResult('error');
    } finally {
      setSharedSyncing(false);
    }
  }, [refreshFn, syncT]);

  useEffect(() => {
    if (syncResult !== 'success') return;
    const id = setTimeout(() => setSyncResult(null), 2500);
    return () => clearTimeout(id);
  }, [syncResult]);

  return { syncing, syncResult, syncError, syncNow };
}

export function resetSyncStatusStoreForTests() {
  stopSyncStatusPolling();
  syncStatusSnapshot = { status: null, loaded: false, error: null, stale: false };
  syncStatusInFlight = null;
  syncStatusInFlightToken = null;
  syncStatusSubscribers = 0;
  syncStatusListeners.clear();
  syncActionListeners.clear();
  sharedSyncing = false;
}
