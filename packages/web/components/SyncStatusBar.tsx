'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { SyncStatus } from './settings/types';
import { getStatusLevel, getSyncLabel, type StatusLevel } from '@/lib/sync-ui';
import { useSyncAction, useSyncStatus } from '@/lib/sync-status-store';

export { getStatusLevel, getSyncLabel } from '@/lib/sync-ui';
export { useSyncAction, useSyncStatus } from '@/lib/sync-status-store';

export const DOT_COLORS: Record<StatusLevel, string> = {
  synced: 'bg-success',
  ready: 'bg-[var(--amber)]',
  unpushed: 'bg-[var(--amber)]',
  conflicts: 'bg-error',       // #6 — conflicts more prominent than unpushed
  error: 'bg-error',
  paused: 'bg-[var(--amber)]',
  unknown: 'bg-[var(--amber)]',
  off: 'bg-muted-foreground/40',
  syncing: 'bg-[var(--amber)]',
};

interface SyncStatusBarProps {
  collapsed?: boolean;
  onOpenSyncSettings: () => void;
}

function useTick(intervalMs: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export default function SyncStatusBar({ collapsed, onOpenSyncSettings }: SyncStatusBarProps) {
  const { status, loaded, error: loadError, stale, fetchStatus } = useSyncStatus();
  const [toast, setToast] = useState<string | null>(null);
  const prevLevelRef = useRef<StatusLevel>('off');
  const [hintDismissed, setHintDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return !!localStorage.getItem('sync-hint-dismissed'); } catch (err) { console.warn("[SyncStatusBar] localStorage read failed:", err); }
    }
    return false;
  });
  const { t } = useLocale();
  const syncT = t.sidebar?.sync as Record<string, unknown> | undefined;
  const { syncing, syncResult, syncError, syncNow } = useSyncAction(fetchStatus, syncT);

  useTick(60_000);

  useEffect(() => {
    if (!loaded || syncing) return;
    const currentLevel = stale && status ? 'error' : getStatusLevel(status, false);
    const prev = prevLevelRef.current;
    if (prev !== currentLevel) {
      const syncT = t.sidebar?.sync;
      if ((prev === 'error' || prev === 'conflicts') && (currentLevel === 'synced' || currentLevel === 'ready')) {
        setTimeout(() => {
          setToast((syncT?.syncRestored as string) ?? 'Sync restored');
          setTimeout(() => setToast(null), 3000);
        }, 0);
      }
      prevLevelRef.current = currentLevel;
    }
  }, [status, loaded, syncing, stale, t]);

  useEffect(() => {
    if (!hintDismissed || !status || (!status.enabled && !status.configured)) return;
    try { localStorage.removeItem('sync-hint-dismissed'); } catch (err) { console.warn("[SyncStatusBar] localStorage remove dismissed:", err); }
    setHintDismissed(false);
  }, [hintDismissed, status]);

  const handleSyncNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    syncNow();
  };
  const handleRetryStatus = (e: React.MouseEvent) => {
    e.stopPropagation();
    void fetchStatus();
  };

  if (!loaded || collapsed) return null;

  const level = stale && status ? 'error' : getStatusLevel(status, syncing);

  if (loadError && !status) {
    return (
      <div className="hidden md:flex items-center justify-between gap-2 px-4 py-1.5 border-t border-border text-xs text-destructive shrink-0 animate-in fade-in duration-300">
        <button
          onClick={() => void fetchStatus()}
          className="flex min-h-7 min-w-0 items-center gap-2 rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={loadError}
        >
          <XCircle size={12} className="shrink-0" />
          <span className="truncate">{(syncT?.syncError as string) ?? 'Sync status unavailable'}</span>
        </button>
      </div>
    );
  }

  if (level === 'off') {
    if (hintDismissed) return null;
    return (
      <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0 animate-in fade-in duration-300">
        <button
          onClick={onOpenSyncSettings}
          className="flex min-h-7 min-w-0 items-center gap-2 rounded-md hover:text-foreground transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={(syncT?.enableHint as string) ?? 'Set up cross-device sync'}
        >
          <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/40" />
          <span className="truncate">{(syncT?.enableSync as string) ?? 'Enable sync'} →</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            try { localStorage.setItem('sync-hint-dismissed', '1'); } catch (err) { console.warn("[SyncStatusBar] localStorage write dismissed:", err); }
            setHintDismissed(true);
          }}
          className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={(syncT?.dismiss as string) ?? 'Dismiss'}
        >
          <span className="text-2xs">✕</span>
        </button>
      </div>
    );
  }

  const { label, tooltip } = stale && status
    ? {
      label: (syncT?.syncStale as string) ?? 'Sync status stale',
      tooltip: loadError ?? ((syncT?.syncStaleHint as string) ?? 'MindOS could not refresh sync status. The displayed state may be outdated.'),
    }
    : getSyncLabel(level, status, syncT);
  const buttonTitle = syncError || tooltip;

  return (
    <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0 animate-in fade-in duration-300">
      <button
        onClick={onOpenSyncSettings}
        className="flex min-h-7 min-w-0 items-center gap-2 rounded-md hover:text-foreground transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={buttonTitle}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLORS[level]} ${
            level === 'syncing' ? 'animate-pulse' :
            level === 'conflicts' ? 'animate-pulse' : ''
          }`}
        />
        <span className="truncate">{toast || label}</span>
      </button>
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {(syncResult === 'success' || toast) && <CheckCircle2 size={12} className="text-success animate-in fade-in duration-200" />}
        {syncResult === 'error' && <XCircle size={12} className="text-error animate-in fade-in duration-200" />}
        {level === 'conflicts' ? (
          <button
            onClick={onOpenSyncSettings}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-error transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={(syncT?.resolveConflictsHint as string) ?? 'Open Settings > Sync to resolve conflicts'}
          >
            <XCircle size={12} />
          </button>
        ) : (
          <button
            onClick={stale ? handleRetryStatus : handleSyncNow}
            disabled={!stale && syncing}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={stale ? ((syncT?.retry as string) ?? 'Retry') : ((syncT?.syncNow as string) ?? 'Sync now')}
          >
            <RefreshCw size={12} className={!stale && syncing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>
    </div>
  );
}

export function SyncDot({ status, syncing, stale }: { status: SyncStatus | null; syncing?: boolean; stale?: boolean }) {
  const level = stale && status ? 'error' : getStatusLevel(status, syncing ?? false);
  if (level === 'off') return null;
  return (
    <span
      className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${DOT_COLORS[level]} ${
        level === 'conflicts' || level === 'error' ? 'animate-pulse' : ''
      }`}
    />
  );
}

export function getMobileSyncLabel({
  status,
  syncing,
  stale,
  loadError,
  syncT,
  prefix = 'Sync',
}: {
  status: SyncStatus | null;
  syncing?: boolean;
  stale?: boolean;
  loadError?: string | null;
  syncT?: Record<string, unknown>;
  prefix?: string;
}) {
  if (loadError && !status) {
    return `${prefix}: ${(syncT?.syncError as string) ?? 'Sync status unavailable'}`;
  }
  if (stale && status) {
    return `${prefix}: ${(syncT?.syncStale as string) ?? 'Sync status stale'}`;
  }
  const level = getStatusLevel(status, syncing ?? false);
  return `${prefix}: ${getSyncLabel(level, status, syncT).label}`;
}

export function MobileSyncDot({ status, syncing, stale, loadError }: { status: SyncStatus | null; syncing?: boolean; stale?: boolean; loadError?: string | null }) {
  const level = stale && status ? 'error' : getStatusLevel(status, syncing ?? false);
  const badgeLevel = loadError && !status ? 'error' : level;
  const showBadge = loadError && !status ? true : level !== 'off' && level !== 'synced';

  if (loadError && !status) {
    return (
      <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
        <RefreshCw size={18} />
        <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-error animate-pulse" />
      </span>
    );
  }

  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
      <RefreshCw size={18} className={level === 'syncing' ? 'animate-spin' : ''} />
      {showBadge && (
        <span
          className={`absolute right-0 top-0 h-1.5 w-1.5 rounded-full ${DOT_COLORS[badgeLevel]} ${
            badgeLevel === 'conflicts' || badgeLevel === 'error' ? 'animate-pulse' : ''
          }`}
        />
      )}
    </span>
  );
}
