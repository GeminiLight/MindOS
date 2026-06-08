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
  unpushed: 'bg-[var(--amber)]',
  conflicts: 'bg-error',       // #6 — conflicts more prominent than unpushed
  error: 'bg-error',
  off: 'bg-muted-foreground/40',
  syncing: 'bg-[var(--amber)]',
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

export default function SyncStatusBar({ collapsed, onOpenSyncSettings }: SyncStatusBarProps) {
  const { status, loaded, error: loadError, fetchStatus } = useSyncStatus();
  const [toast, setToast] = useState<string | null>(null);
  const prevLevelRef = useRef<StatusLevel>('off');
  const [hintDismissed, setHintDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return !!localStorage.getItem('sync-hint-dismissed'); } catch (err) { console.warn("[SyncStatusBar] localStorage read failed:", err); }
    }
    return false;
  });
  const { t } = useLocale();
  const syncT = t.sidebar?.sync as Record<string, string> | undefined;
  const { syncing, syncResult, syncError, syncNow } = useSyncAction(fetchStatus, syncT);

  // #1 — refresh timeAgo display every 60s
  useTick(60_000);

  // Task G — detect first sync or recovery from error and show toast
  useEffect(() => {
    if (!loaded || syncing) return;
    const currentLevel = getStatusLevel(status, false);
    const prev = prevLevelRef.current;
    if (prev !== currentLevel) {
      const syncT = t.sidebar?.sync;
      // Recovery: was error/conflicts, now synced
      if ((prev === 'error' || prev === 'conflicts') && currentLevel === 'synced') {
        // Defer state update to avoid cascading renders
        setTimeout(() => {
          setToast(syncT?.syncRestored ?? 'Sync restored');
          setTimeout(() => setToast(null), 3000);
        }, 0);
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

  if (loadError && !status) {
    return (
      <div className="hidden md:flex items-center justify-between gap-2 px-4 py-1.5 border-t border-border text-xs text-destructive shrink-0 animate-in fade-in duration-300">
        <button
          onClick={() => void fetchStatus()}
          className="flex min-h-7 min-w-0 items-center gap-2 rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={loadError}
        >
          <XCircle size={12} className="shrink-0" />
          <span className="truncate">{syncT?.syncError ?? 'Sync status unavailable'}</span>
        </button>
      </div>
    );
  }

  // Task E — Show dismissible hint when sync is not configured
  if (level === 'off') {
    if (hintDismissed) return null;
    return (
      <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0 animate-in fade-in duration-300">
        <button
          onClick={onOpenSyncSettings}
          className="flex min-h-7 min-w-0 items-center gap-2 rounded-md hover:text-foreground transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={syncT?.enableHint ?? 'Set up cross-device sync'}
        >
          <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/40" />
          <span className="truncate">{syncT?.enableSync ?? 'Enable sync'} →</span>
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            try { localStorage.setItem('sync-hint-dismissed', '1'); } catch (err) { console.warn("[SyncStatusBar] localStorage write dismissed:", err); }
            setHintDismissed(true);
          }}
          className="ml-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Dismiss"
        >
          <span className="text-2xs">✕</span>
        </button>
      </div>
    );
  }

  const { label, tooltip } = getSyncLabel(level, status, syncT);
  const buttonTitle = syncError || tooltip;

  return (
    // #3 — fade-in via animate-in
    <div className="hidden md:flex items-center justify-between px-4 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0 animate-in fade-in duration-300">
      <button
        onClick={onOpenSyncSettings}
        className="flex min-h-7 min-w-0 items-center gap-2 rounded-md hover:text-foreground transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={buttonTitle}
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
        {level === 'conflicts' ? (
          <button
            onClick={onOpenSyncSettings}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-error transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={syncT?.resolveConflictsHint ?? 'Open Settings > Sync to resolve conflicts'}
          >
            <XCircle size={12} />
          </button>
        ) : (
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={syncT?.syncNow ?? 'Sync now'}
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          </button>
        )}
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
