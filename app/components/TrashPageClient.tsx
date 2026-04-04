'use client';

import { useState, useCallback, useTransition } from 'react';
import { Trash2, RotateCcw, X, Folder, FileText, Table, AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/stores/locale-store';
import { restoreFromTrashAction, permanentlyDeleteAction, emptyTrashAction } from '@/lib/actions';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import { toast } from '@/lib/toast';
import type { TrashMeta } from '@/lib/core/trash';

function relativeTimeShort(iso: string, t: { justNow?: string; minutesAgo?: (m: number) => string; hoursAgo?: (h: number) => string; daysAgo?: (d: number) => string }): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return t.justNow ?? 'just now';
  if (mins < 60) return t.minutesAgo?.(mins) ?? `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.hoursAgo?.(hours) ?? `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return t.daysAgo?.(days) ?? `${days}d ago`;
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export default function TrashPageClient({ initialItems }: { initialItems: TrashMeta[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [isPending, startTransition] = useTransition();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TrashMeta | null>(null);
  const [conflictItem, setConflictItem] = useState<TrashMeta | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleRestore = useCallback(async (item: TrashMeta) => {
    setBusyId(item.id);
    try {
      const result = await restoreFromTrashAction(item.id, 'restore');
      if (result.success) {
        setItems(prev => prev.filter(i => i.id !== item.id));
        toast.success(t.trash.restored);
        router.refresh();
      } else if (result.conflict) {
        setConflictItem(item);
      } else {
        toast.error(result.error ?? 'Failed to restore');
      }
    } finally {
      setBusyId(null);
    }
  }, [t, router]);

  const handleConflictResolve = useCallback(async (mode: 'overwrite' | 'copy') => {
    if (!conflictItem) return;
    const result = await restoreFromTrashAction(conflictItem.id, mode);
    if (result.success) {
      setItems(prev => prev.filter(i => i.id !== conflictItem.id));
      toast.success(t.trash.restored);
      setConflictItem(null);
      router.refresh();
    } else {
      toast.error(result.error ?? 'Failed to restore');
    }
  }, [conflictItem, t, router]);

  const handlePermanentDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const result = await permanentlyDeleteAction(confirmDelete.id);
    if (result.success) {
      setItems(prev => prev.filter(i => i.id !== confirmDelete.id));
      toast.success(t.trash.deleted);
    } else {
      toast.error(result.error ?? 'Failed to delete');
    }
    setConfirmDelete(null);
  }, [confirmDelete, t]);

  const handleEmptyTrash = useCallback(async () => {
    startTransition(async () => {
      const result = await emptyTrashAction();
      if (result.success) {
        setItems([]);
        toast.success(t.trash.emptied(result.count ?? 0));
      } else {
        toast.error(result.error ?? 'Failed to empty trash');
      }
      setConfirmEmpty(false);
    });
  }, [t]);

  return (
    <div className="min-h-screen">
      <div className="px-4 md:px-6 pt-6 md:pt-8">
        <div className="content-width xl:mr-[220px] rounded-xl border border-border bg-card px-4 py-3 md:px-5 md:py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground font-display">
                <Trash2 size={15} />
                {t.trash.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.trash.subtitle}
              </p>
              {items.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {t.trash.itemCount(items.length)}
                </div>
              )}
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmEmpty(true)}
                disabled={isPending}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-error/10 text-error hover:bg-error/20 transition-colors disabled:opacity-50"
              >
                {t.trash.emptyTrash}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 md:py-6">
        <div className="content-width xl:mr-[220px]">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <Trash2 size={32} className="mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground font-display">{t.trash.empty}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t.trash.emptySubtext}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(item => {
                const days = daysUntil(item.expiresAt);
                const isExpiring = days <= 3;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:border-border/80 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                        {item.isDirectory
                          ? <Folder size={16} className="text-muted-foreground" />
                          : item.fileName.endsWith('.csv')
                            ? <Table size={16} className="text-success" />
                            : <FileText size={16} className="text-muted-foreground" />
                        }
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate" title={item.fileName}>
                          {item.fileName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5" title={item.originalPath}>
                          {t.trash.from}: {item.originalPath.split('/').slice(0, -1).join('/') || '/'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-2xs text-muted-foreground">
                          {t.trash.deletedAgo(relativeTimeShort(item.deletedAt, t.trash))}
                        </span>
                        <span className={`text-2xs ${isExpiring ? 'text-error' : 'text-muted-foreground/60'}`}>
                          {isExpiring && <AlertTriangle size={9} className="inline mr-0.5" />}
                          {t.trash.expiresIn(days)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRestore(item)}
                          disabled={busyId === item.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-50"
                        >
                          {busyId === item.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                          {t.trash.restore}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(item)}
                          className="p-1 rounded-md text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
                          title={t.trash.deletePermanently}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Empty Trash Confirmation */}
      <ConfirmDialog
        open={confirmEmpty}
        title={t.trash.emptyTrash}
        message={t.trash.emptyTrashConfirm}
        confirmLabel={t.trash.emptyTrash}
        cancelLabel={t.trash.cancel ?? 'Cancel'}
        onConfirm={() => void handleEmptyTrash()}
        onCancel={() => setConfirmEmpty(false)}
        variant="destructive"
      />

      {/* Permanent Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={t.trash.deletePermanently}
        message={confirmDelete ? t.trash.deletePermanentlyConfirm(confirmDelete.fileName) : ''}
        confirmLabel={t.trash.deletePermanently}
        cancelLabel={t.trash.cancel ?? 'Cancel'}
        onConfirm={() => void handlePermanentDelete()}
        onCancel={() => setConfirmDelete(null)}
        variant="destructive"
      />

      {/* Restore Conflict Dialog */}
      {conflictItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-sm w-full mx-4 p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-[var(--amber)]" />
              <h3 className="text-sm font-semibold font-display">{t.trash.restoreConflict}</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              &quot;{conflictItem.fileName}&quot; — {conflictItem.originalPath}
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConflictItem(null)}
                className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {t.trash.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void handleConflictResolve('copy')}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
              >
                {t.trash.saveAsCopy}
              </button>
              <button
                type="button"
                onClick={() => void handleConflictResolve('overwrite')}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--amber-dim)] text-[var(--amber-text)] hover:opacity-80 transition-colors"
              >
                {t.trash.overwrite}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
