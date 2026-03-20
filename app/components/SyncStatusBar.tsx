'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';
import type { SyncStatus } from './settings/SyncTab';
import { timeAgo } from './settings/SyncTab';

export type StatusLevel = 'synced' | 'unpushed' | 'conflicts' | 'error' | 'off' | 'syncing';

export function getStatusLevel(status: SyncStatus | null, syncing: boolean): StatusLevel {
  if (syncing) return 'syncing';
  if (!status || !status.enabled) return 'off';
  if (status.lastError) return 'error';
  if (status.conflicts && status.conflicts.length > 0) return 'conflicts';
  const unpushed = parseInt(status.unpushed || '0', 10);
  if (unpushed > 0) return 'unpushed';
  return 'synced';
}

export const DOT_COLORS: Record<StatusLevel, string> = {
  synced: 'bg-success',
  unpushed: 'bg-yellow-500',
  conflicts: 'bg-error',       // #6 — conflicts more prominent than unpushed
  error: 'bg-error',
  off: 'bg-muted-foreground/40',
  syncing: 'bg-blue-500',
};

interface SyncStatusBarProps {
  collapsed?: boolean;
  onOpenSyncSettings: () => void;
}

// #1 — Hook to force re-render every 60s so timeAgo stays fresh
function useTick(intervalMs: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SyncStatus>('/api/sync');
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    const start = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchStatus, 30_000);
    };
    const stop = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    };

    start();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
        start();
      } else {
        stop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchStatus]);

  return { status, loaded, fetchStatus };
}

/** Shared hook for the "Sync Now" action — avoids duplicating sync logic in SyncStatusBar & SyncPopover */
export function useSyncAction(refreshFn: () => Promise<void>) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'now' }),
      });
      await refreshFn();
      setSyncResult('success');
    } catch {
      await refreshFn();
      setSyncResult('error');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncResult(null), 2500);
    }
  }, [syncing, refreshFn]);

  return { syncing, syncResult, syncNow };
}

/** Shared status label formatter — used by SyncStatusBar and SyncPopover */
export function getSyncLabel(
  level: StatusLevel,
  status: SyncStatus | null,
  syncT?: Record<string, string>,
): { label: string; tooltip: string } {
  switch (level) {
    case 'syncing': {
      const l = syncT?.syncing ?? 'Syncing...';
      return { label: l, tooltip: l };
    }
    case 'synced': {
      const l = `${syncT?.synced ?? 'Synced'} · ${timeAgo(status?.lastSync)}`;
      return { label: l, tooltip: l };
    }
    case 'unpushed': {
      const n = parseInt(status?.unpushed || '0', 10);
      return {
        label: `${n} ${syncT?.unpushed ?? 'awaiting push'}`,
        tooltip: syncT?.unpushedHint ?? `${n} commit(s) not yet pushed to remote`,
      };
    }
    case 'conflicts': {
      const n = status?.conflicts?.length || 0;
      return {
        label: `${n} ${syncT?.conflicts ?? 'conflicts'}`,
        tooltip: syncT?.conflictsHint ?? `${n} file(s) have merge conflicts — resolve in Settings > Sync`,
      };
    }
    case 'error':
      return {
        label: syncT?.syncError ?? 'Sync error',
        tooltip: status?.lastError || (syncT?.syncError ?? 'Sync error'),
      };
    default: {
      const l = syncT?.syncOff ?? 'Sync off';
      return { label: l, tooltip: l };
    }
  }
}

export default function SyncStatusBar({ collapsed, onOpenSyncSettings }: SyncStatusBarProps) {
  const { status, loaded, fetchStatus } = useSyncStatus();
  const { syncing, syncResult, syncNow } = useSyncAction(fetchStatus);
  const [toast, setToast] = useState<string | null>(null);
  const prevLevelRef = useRef<StatusLevel>('off');
  const [hintDismissed, setHintDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return !!localStorage.getItem('sync-hint-dismissed'); } catch {}
    }
    return false;
  });
  const { t } = useLocale();

  // #1 — refresh timeAgo display every 60s
  useTick(60_000);

  // Task G — detect first sync or recovery from error and show toast
  useEffect(() => {
    if (!loaded || syncing) return;
    const currentLevel = getStatusLevel(status, false);
    const prev = prevLevelRef.current;
    if (prev !== currentLevel) {
      const syncT = (t as any).sidebar?.sync;
      // Recovery: was error/conflicts, now synced
      if ((prev === 'error' || prev === 'conflicts') && currentLevel === 'synced') {
        setToast(syncT?.syncRestored ?? 'Sync restored');
        setTimeout(() => setToast(null), 3000);
      }
      prevLevelRef.current = currentLevel;
    }
  }, [status, loaded, syncing, t]);

  const handleSyncNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    syncNow();
  };

  if (!loaded || collapsed) return null;

  const level = getStatusLevel(status, syncing);

  // Task E — Show dismissible hint when sync is not configured
  if (level === 'off') {
    if (hintDismissed) return null;
    const syncT = (t as any).sidebar?.sync;
    return (
      <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0 animate-in fade-in duration-300">
        <button
          onClick={onOpenSyncSettings}
          className="flex items-center gap-2 min-w-0 hover:text-foreground transition-colors truncate"
          title={syncT?.enableHint ?? 'Set up cross-device sync'}
        >
          <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/40" />
          <span className="truncate">{syncT?.enableSync ?? 'Enable sync'} →</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            try { localStorage.setItem('sync-hint-dismissed', '1'); } catch {}
            setHintDismissed(true);
          }}
          className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors shrink-0 ml-2 text-muted-foreground/50 hover:text-muted-foreground"
          title="Dismiss"
        >
          <span className="text-2xs">✕</span>
        </button>
      </div>
    );
  }

  const syncT = (t as any).sidebar?.sync;
  const { label, tooltip } = getSyncLabel(level, status, syncT);

  return (
    // #3 — fade-in via animate-in
    <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0 animate-in fade-in duration-300">
      <button
        onClick={onOpenSyncSettings}
        className="flex items-center gap-2 min-w-0 hover:text-foreground transition-colors truncate"
        title={tooltip}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLORS[level]} ${
            level === 'syncing' ? 'animate-pulse' :
            level === 'conflicts' ? 'animate-pulse' : ''   // #6 — conflicts pulse
          }`}
        />
        <span className="truncate">{toast || label}</span>
      </button>
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {/* #2 — sync result flash */}
        {(syncResult === 'success' || toast) && <CheckCircle2 size={12} className="text-success animate-in fade-in duration-200" />}
        {syncResult === 'error' && <XCircle size={12} className="text-error animate-in fade-in duration-200" />}
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
          title={syncT?.syncNow ?? 'Sync now'}
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
}

// #7 — Minimal dot for collapsed sidebar
export function SyncDot({ status, syncing }: { status: SyncStatus | null; syncing?: boolean }) {
  const level = getStatusLevel(status, syncing ?? false);
  if (level === 'off') return null;
  return (
    <span
      className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${DOT_COLORS[level]} ${
        level === 'conflicts' || level === 'error' ? 'animate-pulse' : ''
      }`}
    />
  );
}

// #8 — Small dot for mobile header
export function MobileSyncDot({ status, syncing }: { status: SyncStatus | null; syncing?: boolean }) {
  const level = getStatusLevel(status, syncing ?? false);
  if (level === 'off' || level === 'synced') return null;  // only show when attention needed
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[level]} ${
        level === 'conflicts' || level === 'error' ? 'animate-pulse' : ''
      }`}
    />
  );
}
