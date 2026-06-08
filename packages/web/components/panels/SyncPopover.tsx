'use client';

import { useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle2, XCircle, X } from 'lucide-react';
import { DOT_COLORS } from '../SyncStatusBar';
import { getStatusLevel, getSyncLabel } from '@/lib/sync-ui';
import { useSyncAction } from '@/lib/sync-status-store';
import { useLocale } from '@/lib/stores/locale-store';
import type { SyncStatus } from '../settings/types';
import { PrimaryButton } from '../settings/Primitives';

interface SyncPopoverProps {
  id?: string;
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  railWidth: number;
  onOpenSyncSettings: () => void;
  syncStatus: SyncStatus | null;
  onSyncStatusRefresh: () => Promise<void>;
}

export default function SyncPopover({ id, open, onClose, anchorRect, railWidth, onOpenSyncSettings, syncStatus, onSyncStatusRefresh }: SyncPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useLocale();
  const syncT = t.sidebar?.sync as Record<string, unknown> | undefined;
  const { syncing, syncResult, syncError, syncNow } = useSyncAction(onSyncStatusRefresh, syncT);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const id = setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); window.removeEventListener('mousedown', handler); };
  }, [onClose, open]);

  if (!open || !anchorRect) return null;

  const level = getStatusLevel(syncStatus, syncing);
  const { label: statusText, tooltip: statusDetail } = getSyncLabel(level, syncStatus, syncT);

  // Position: anchor near the button, avoid going off-screen top
  const popoverTop = Math.max(8, anchorRect.bottom - 180);

  return (
    <div
      id={id}
      ref={ref}
      role="dialog"
      aria-label={t.sidebar?.syncLabel ?? 'Sync'}
      className="fixed z-50 w-[280px] border rounded-lg bg-background shadow-lg border-border animate-in fade-in slide-in-from-left-2 duration-150"
      style={{
        top: popoverTop,
        left: railWidth,
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t.sidebar?.syncLabel ?? 'Sync'}</span>
        <button
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t.search?.close ?? 'Close'}
        >
          <X size={14} />
        </button>
      </div>
      <div className="p-3 space-y-3">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT_COLORS[level]} ${
            level === 'syncing' || level === 'conflicts' || level === 'error' ? 'animate-pulse' : ''
          }`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{statusText}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{statusDetail}</p>
          </div>
          {syncResult === 'success' && <CheckCircle2 size={14} className="text-success shrink-0" />}
          {syncResult === 'error' && <XCircle size={14} className="text-error shrink-0" />}
        </div>
        {syncError && (
          <div className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-xs text-destructive" role="alert" aria-live="polite">
            {syncError.split('\n').map((line, i) => (
              <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : ''}`}>{line}</span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          {level !== 'off' && level !== 'conflicts' && (
            <PrimaryButton
              onClick={syncNow}
              disabled={syncing}
              className="flex min-h-9 items-center gap-1.5 px-3 text-xs"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              {(syncT?.syncNow as string) ?? 'Sync now'}
            </PrimaryButton>
          )}
          <button
            onClick={() => { onOpenSyncSettings(); onClose(); }}
            className="inline-flex min-h-9 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {level === 'conflicts'
              ? ((syncT?.resolveConflicts as string)?.replace('{n}', String(syncStatus?.conflicts?.length ?? 0)) ?? 'Resolve conflicts')
              : (t.search?.openSettings ?? 'Open settings')}
          </button>
        </div>
      </div>
    </div>
  );
}
