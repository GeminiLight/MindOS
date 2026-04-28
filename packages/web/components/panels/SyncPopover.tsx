'use client';

import { useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle2, XCircle, X } from 'lucide-react';
import { DOT_COLORS, getStatusLevel, getSyncLabel, useSyncAction } from '../SyncStatusBar';
import type { SyncStatus } from '../settings/types';
import { PrimaryButton } from '../settings/Primitives';

interface SyncPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  railWidth: number;
  onOpenSyncSettings: () => void;
  syncStatus: SyncStatus | null;
  onSyncStatusRefresh: () => Promise<void>;
}

export default function SyncPopover({ open, onClose, anchorRect, railWidth, onOpenSyncSettings, syncStatus, onSyncStatusRefresh }: SyncPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { syncing, syncResult, syncNow } = useSyncAction(onSyncStatusRefresh);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCloseRef.current(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current();
    };
    const id = setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); window.removeEventListener('mousedown', handler); };
  }, [open]);

  if (!open || !anchorRect) return null;

  const level = getStatusLevel(syncStatus, syncing);
  const { label: statusText } = getSyncLabel(level, syncStatus);

  // Position: anchor near the button, avoid going off-screen top
  const popoverTop = Math.max(8, anchorRect.bottom - 180);

  return (
    <div
      ref={ref}
      className="fixed z-40 w-[240px] border rounded-lg bg-card shadow-lg border-border animate-in fade-in slide-in-from-left-2 duration-150"
      style={{
        top: popoverTop,
        left: railWidth,
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sync</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
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
          <span className="text-sm text-foreground">{statusText}</span>
          {syncResult === 'success' && <CheckCircle2 size={14} className="text-success shrink-0" />}
          {syncResult === 'error' && <XCircle size={14} className="text-error shrink-0" />}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {level !== 'off' && (
            <PrimaryButton
              onClick={syncNow}
              disabled={syncing}
              className="text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
              Sync Now
            </PrimaryButton>
          )}
          <button
            onClick={() => { onOpenSyncSettings(); onClose(); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 py-0.5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Settings →
          </button>
        </div>
      </div>
    </div>
  );
}
