'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2, GitBranch, Check, ChevronRight, FileX2, GitCommitHorizontal } from 'lucide-react';
import { PrimaryButton, SettingCard, Select } from './Primitives';
import { apiFetch } from '@/lib/api';
import type { SyncStatus, SyncTabProps } from './types';
import { formatSyncError, getStatusLevel, getSyncErrorHint, getUnpushedCount, hasUnknownUnpushedCount, timeAgo } from '@/lib/sync-ui';
import { fetchSharedSyncStatus, useSyncAction, useSyncStatus } from '@/lib/sync-status-store';
import SyncEmptyState from './SyncEmptyState';

export { getSyncErrorHint, timeAgo } from '@/lib/sync-ui';

function getSyncHealth(status: SyncStatus, syncT?: Record<string, unknown>, staleError?: string | null) {
  const conflictCount = status.conflicts?.length ?? 0;
  const unpushedCount = getUnpushedCount(status);
  const paused = !status.enabled && status.configured;

  if (staleError) {
    return {
      tone: 'error' as const,
      title: (syncT?.healthStaleTitle as string) ?? 'Sync status may be outdated',
      description: formatSyncError(staleError, syncT),
      next: (syncT?.healthStaleNext as string) ?? 'Next: retry status refresh before trusting this state',
      icon: <AlertCircle size={18} />,
    };
  }

  if (conflictCount > 0) {
    return {
      tone: 'error' as const,
      title: (syncT?.healthConflictsTitle as string) ?? 'Resolve conflicts to finish sync',
      description: (syncT?.healthConflictsDesc as ((n: number) => string))?.(conflictCount)
        ?? `Review each file below, compare the two versions, then choose which one to keep.`,
      next: (syncT?.healthConflictsNext as string) ?? 'Next: choose which version to keep',
      icon: <AlertCircle size={18} />,
    };
  }

  if (status.lastError) {
    const hint = getSyncErrorHint(status.lastError, status.remote, syncT);
    return {
      tone: 'error' as const,
      title: (syncT?.healthErrorTitle as string) ?? 'Sync needs attention',
      description: hint || status.lastError,
      next: (syncT?.healthErrorNext as string) ?? 'Next: fix the issue, then sync again',
      icon: <AlertCircle size={18} />,
    };
  }

  if (hasUnknownUnpushedCount(status)) {
    return {
      tone: 'warning' as const,
      title: (syncT?.healthUnknownTitle as string) ?? 'Sync status unknown',
      description: paused
        ? ((syncT?.healthPausedUnknownDesc as string)
          ?? 'Auto-sync is paused, and MindOS could not confirm whether local changes have been uploaded.')
        : ((syncT?.healthUnknownDesc as string)
          ?? 'MindOS could not confirm whether local changes have been uploaded.'),
      next: paused
        ? ((syncT?.healthPausedUnknownNext as string) ?? 'Next: enable auto-sync or retry the status refresh')
        : ((syncT?.healthUnknownNext as string) ?? 'Next: retry sync or check the remote repository'),
      icon: <AlertCircle size={18} />,
    };
  }

  if (unpushedCount > 0) {
    return {
      tone: 'warning' as const,
      title: paused
        ? ((syncT?.healthPausedUnpushedTitle as ((n: number) => string))?.(unpushedCount)
          ?? `${unpushedCount} local change${unpushedCount === 1 ? '' : 's'} are waiting`)
        : ((syncT?.healthUnpushedTitle as ((n: number) => string))?.(unpushedCount)
          ?? `${unpushedCount} local change${unpushedCount === 1 ? '' : 's'} waiting to upload`),
      description: paused
        ? ((syncT?.healthPausedUnpushedDesc as string)
          ?? 'Auto-sync is paused. These changes will not upload until you sync manually or enable auto-sync.')
        : ((syncT?.healthUnpushedDesc as string)
          ?? 'MindOS will push them automatically, or you can run Sync now.'),
      next: paused
        ? ((syncT?.healthPausedUnpushedNext as string) ?? 'Next: run Sync Now or enable auto-sync')
        : ((syncT?.healthUnpushedNext as string) ?? 'Next: sync now or keep working'),
      icon: <GitCommitHorizontal size={18} />,
    };
  }

  if (!status.enabled && status.configured) {
    return {
      tone: 'warning' as const,
      title: (syncT?.healthPausedTitle as string) ?? 'Sync is paused',
      description: (syncT?.healthPausedDesc as string)
        ?? 'Auto-sync is disabled for this repository. Your existing Git configuration is still available.',
      next: (syncT?.healthPausedNext as string) ?? 'Next: enable auto-sync when you want background backups again',
      icon: <GitBranch size={18} />,
    };
  }

  if (!status.lastSync) {
    return {
      tone: 'warning' as const,
      title: (syncT?.healthReadyTitle as string) ?? 'Sync is ready',
      description: (syncT?.healthReadyDesc as string)
        ?? 'No completed sync has been recorded yet.',
      next: (syncT?.healthReadyNext as string) ?? 'Run Sync Now to create the first backup',
      icon: <GitBranch size={18} />,
    };
  }

  return {
    tone: 'success' as const,
    title: (syncT?.healthSyncedTitle as string) ?? 'All notes are backed up',
    description: (syncT?.healthSyncedDesc as ((time: string) => string))?.(timeAgo(status.lastSync, syncT))
      ?? `Last sync: ${timeAgo(status.lastSync, syncT)}.`,
    next: (syncT?.healthSyncedNext as string) ?? 'Next: keep writing',
    icon: <CheckCircle2 size={18} />,
  };
}

function healthToneClass(tone: 'success' | 'warning' | 'error') {
  switch (tone) {
    case 'success':
      return 'border-success/25 bg-success/10 text-success';
    case 'warning':
      return 'border-[var(--amber)]/30 bg-[var(--amber-subtle)] text-[var(--amber-text)]';
    case 'error':
      return 'border-destructive/25 bg-destructive/10 text-destructive';
  }
}

function SyncActionMessage({ message }: { message: { type: 'success' | 'error'; text: string } | null }) {
  if (!message) return null;

  return (
    <div className="flex items-start gap-1.5 text-xs" role="status" aria-live="polite">
      {message.type === 'success' ? (
        <>
          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
          <span className="text-success">{message.text}</span>
        </>
      ) : (
        <>
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-destructive" />
          <div className="space-y-0.5">
            {message.text.split('\n').map((line, i) => (
              <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : 'text-destructive'}`}>{line}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Conflict Row ──────────────────────────────────────────────── */

function ConflictRow({ file, time, noBackup, localExists, remoteExists, syncT, onResolved, disabled }: {
  file: string;
  time?: string;
  noBackup?: boolean;
  localExists?: boolean;
  remoteExists?: boolean;
  syncT?: Record<string, unknown>;
  onResolved: () => Promise<boolean>;
  disabled?: boolean;
}) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{ local: string; remote: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [confirmKeepLocalWithoutPreview, setConfirmKeepLocalWithoutPreview] = useState(false);
  const [previewBackupMissing, setPreviewBackupMissing] = useState(false);
  const [refreshFailedAfterResolve, setRefreshFailedAfterResolve] = useState(false);

  useEffect(() => {
    setResolving(null);
    setExpanded(false);
    setPreview(null);
    setLoadingPreview(false);
    setRowError(null);
    setConfirmKeepLocalWithoutPreview(false);
    setPreviewBackupMissing(false);
    setRefreshFailedAfterResolve(false);
  }, [file]);

  const remoteDeleted = remoteExists === false;
  const localDeleted = localExists === false;
  const backupMissing = !remoteDeleted && (!!noBackup || previewBackupMissing);
  const canKeepLocalWithoutPreview = backupMissing;
  const rowLocked = disabled || refreshFailedAfterResolve;

  const loadPreview = async () => {
    setRowError(null);
    setConfirmKeepLocalWithoutPreview(false);
    setPreviewBackupMissing(false);
    setLoadingPreview(true);
    try {
      const data = await apiFetch<{ local: string; remote: string }>('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'conflict-preview', file, remote: file }),
      });
      setPreview(data);
      return true;
    } catch (error) {
      const fallback = (syncT?.conflictPreviewFailed as string) ?? 'Failed to load conflict preview';
      const raw = error instanceof Error ? error.message : fallback;
      const detail = formatSyncError(raw, syncT);
      if (/remote conflict backup is missing/i.test(raw)) {
        setPreviewBackupMissing(true);
      }
      setRowError(detail.includes(fallback) ? detail : `${fallback}\n${detail}`);
      return false;
    } finally {
      setLoadingPreview(false);
    }
  };

  const togglePreview = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!preview) await loadPreview();
  };

  const handleResolve = async (strategy: 'keep-local' | 'keep-remote') => {
    if (rowLocked) return;
    if (strategy === 'keep-local' && !preview) {
      if (!canKeepLocalWithoutPreview) return;
      if (!confirmKeepLocalWithoutPreview) {
        setConfirmKeepLocalWithoutPreview(true);
        return;
      }
    }
    if (strategy === 'keep-remote' && (!preview || backupMissing)) {
      return;
    }
    setRowError(null);
    setConfirmKeepLocalWithoutPreview(false);
    setResolving(strategy === 'keep-local' ? 'local' : 'remote');
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-conflict', file, strategy }),
      });
      const refreshed = await onResolved();
      if (!refreshed) {
        setRefreshFailedAfterResolve(true);
        setRowError((syncT?.conflictResolvedRefreshFailed as string)
          ?? 'Conflict resolution may have been saved, but MindOS could not refresh sync status. Retry status refresh before continuing.');
      }
    } catch (error) {
      const fallback = (syncT?.conflictResolveFailed as string) ?? 'Failed to resolve conflict';
      const raw = error instanceof Error ? error.message : fallback;
      const detail = formatSyncError(raw, syncT);
      setRowError(detail.includes(fallback) ? detail : `${fallback}\n${detail}`);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2 p-2 text-xs bg-muted/20">
        <AlertCircle size={12} className="text-error shrink-0" />
        <button
          type="button"
          onClick={togglePreview}
          className="inline-flex min-h-8 flex-1 min-w-[12rem] items-center rounded-md font-mono text-left hover:text-foreground hover:underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={(syncT?.viewDiff as string) ?? 'View differences'}
        >
          <ChevronRight size={11} className={`inline mr-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          {file}
        </button>
        <span className="text-muted-foreground shrink-0">
          {time ? timeAgo(time, syncT) : ((syncT?.timeUnknown as string) ?? 'unknown')}
        </span>
        {!preview && (
          <span className="text-2xs text-muted-foreground">
            {(syncT?.viewDiffFirst as string) ?? 'View diff first'}
          </span>
        )}
        {remoteDeleted && (
          <span className="text-2xs text-muted-foreground">
            {(syncT?.remoteDeleted as string) ?? 'Remote deleted'}
          </span>
        )}
        {localDeleted && (
          <span className="text-2xs text-muted-foreground">
            {(syncT?.localDeleted as string) ?? 'Local deleted'}
          </span>
        )}
        {backupMissing && (
          <span className="text-2xs text-destructive">
            {(syncT?.remoteBackupMissing as string) ?? 'Remote backup unavailable'}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleResolve('keep-local')}
            disabled={rowLocked || !!resolving || loadingPreview || (!preview && !canKeepLocalWithoutPreview)}
            className="inline-flex min-h-8 items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-muted transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={(syncT?.keepLocalHint as string) ?? 'Keep this device\'s version'}
          >
            {resolving === 'local'
              ? <Loader2 size={10} className="animate-spin" />
              : confirmKeepLocalWithoutPreview
                ? ((syncT?.confirmKeepLocal as string) ?? 'Confirm keep local?')
                : ((syncT?.keepLocal as string) ?? 'Keep local')}
          </button>
          <button
            type="button"
            onClick={() => handleResolve('keep-remote')}
            disabled={rowLocked || !!resolving || !preview || backupMissing}
            className="inline-flex min-h-8 items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-muted transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={backupMissing
              ? ((syncT?.remoteBackupMissingHint as string) ?? 'The remote version could not be saved for preview, so it cannot be applied from the UI.')
              : remoteDeleted
                ? ((syncT?.keepRemoteDeletedHint as string) ?? 'Accept the remote deletion for this file')
              : ((syncT?.keepRemoteHint as string) ?? 'Replace with remote version')
            }
          >
            {resolving === 'remote' ? <Loader2 size={10} className="animate-spin" /> : ((syncT?.keepRemote as string) ?? 'Keep remote')}
          </button>
        </div>
      </div>

      {/* Diff preview */}
      {expanded && (
        <div className="border-t border-border/50">
          {loadingPreview ? (
            <div className="flex justify-center py-3">
              <Loader2 size={13} className="animate-spin text-muted-foreground" />
            </div>
          ) : preview ? (
            <div className="grid grid-cols-1 divide-y divide-border/50 text-2xs font-mono max-h-72 overflow-auto sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="p-2">
                <div className="text-muted-foreground mb-1 font-sans text-xs font-medium">
                  {(syncT?.localVersion as string) ?? 'Local (this device)'}
                </div>
                <pre className="whitespace-pre-wrap text-foreground/80 leading-relaxed">{preview.local || ((syncT?.emptyFile as string) ?? '(empty)')}</pre>
              </div>
              <div className="p-2">
                <div className="text-muted-foreground mb-1 font-sans text-xs font-medium">
                  {(syncT?.remoteVersion as string) ?? 'Remote'}
                </div>
                <pre className="whitespace-pre-wrap text-foreground/80 leading-relaxed">
                  {backupMissing
                    ? ((syncT?.remoteBackupMissingHint as string) ?? 'The remote version could not be saved for preview, so it cannot be applied from the UI.')
                    : remoteDeleted
                      ? ((syncT?.remoteDeletedPreview as string) ?? '(deleted remotely)')
                    : (preview.remote || ((syncT?.emptyFile as string) ?? '(empty)'))
                  }
                </pre>
              </div>
            </div>
          ) : (
            <div className="p-3 text-xs text-muted-foreground">
              {(syncT?.previewEmptyState as string) ?? 'No preview loaded yet.'}
            </div>
          )}
        </div>
      )}
      {rowError && (
        <div className="flex items-start justify-between gap-2 border-t border-border/50 bg-destructive/10 p-2 text-xs text-destructive" role="alert" aria-live="polite">
          <div className="space-y-0.5">
            {rowError.split('\n').map((line, i) => (
              <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : ''}`}>{line}</span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (refreshFailedAfterResolve) {
                void onResolved();
                return;
              }
              setPreview(null);
              setExpanded(true);
              void loadPreview();
            }}
            className="shrink-0 rounded-md px-2 py-1 text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(syncT?.retry as string) ?? 'Retry'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Gitignore Editor ──────────────────────────────────────────── */

function GitignoreEditor({ syncT, onSaved, disabled }: {
  syncT?: Record<string, unknown>;
  onSaved?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const dirty = content !== saved;

  const loadGitignore = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRefreshWarning(null);
    setLoadFailed(false);
    setSaveOk(false);
    try {
      const data = await apiFetch<{ content: string }>('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gitignore-get' }),
      });
      setContent(data.content);
      setSaved(data.content);
    } catch (err) {
      const raw = err instanceof Error ? err.message : ((syncT?.gitignoreLoadFailed as string) ?? 'Failed to load .gitignore');
      setError(formatSyncError(raw, syncT));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [syncT]);

  useEffect(() => {
    if (!open) return;
    void loadGitignore();
  }, [open, loadGitignore]);

  const handleSave = async () => {
    if (disabled) return;
    setSaving(true);
    setError(null);
    setRefreshWarning(null);
    setSaveOk(false);
    try {
      const data = await apiFetch<{ content?: string }>('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gitignore-save', content }),
      });
      const savedContent = data.content ?? content;
      setContent(savedContent);
      setSaved(savedContent);
      setSaveOk(true);
      setLoadFailed(false);
      try {
        await onSaved?.();
      } catch (refreshError) {
        const raw = refreshError instanceof Error
          ? refreshError.message
          : ((syncT?.syncStatusRefreshFailed as string) ?? 'Saved, but failed to refresh sync status');
        setRefreshWarning(formatSyncError(raw, syncT));
      }
      setTimeout(() => setSaveOk(false), 2000);
    } catch (err) {
      const raw = err instanceof Error ? err.message : ((syncT?.gitignoreSaveFailed as string) ?? 'Failed to save .gitignore');
      setError(formatSyncError(raw, syncT));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-2 border-t border-border/50">
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(!open); }}
        disabled={disabled}
        className="flex items-center gap-2 w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors py-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronRight size={14} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileX2 size={13} className="shrink-0" />
        <span>{(syncT?.gitignoreTitle as string) ?? 'Excluded files'}</span>
        <span className="text-2xs opacity-50">.gitignore</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={8}
                disabled={disabled || loadFailed}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                placeholder={(syncT?.gitignorePlaceholder as string) ?? '# Files to exclude from sync\n*.tmp\nsecret/'}
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                {dirty && !loadFailed && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={disabled || saving}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />}
                    {(syncT?.gitignoreSave as string) ?? 'Save'}
                  </button>
                )}
                {loadFailed && (
                  <button
                    type="button"
                    onClick={() => void loadGitignore()}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RefreshCw size={12} />
                    {(syncT?.retry as string) ?? 'Retry'}
                  </button>
                )}
                {saveOk && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check size={12} /> {(syncT?.gitignoreSaved as string) ?? 'Saved'}
                  </span>
                )}
              </div>
              {error && (
                <div className="flex items-start gap-1.5 rounded-md bg-destructive/10 p-2 text-xs text-destructive" role="alert" aria-live="polite">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    {error.split('\n').map((line, i) => (
                      <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : ''}`}>{line}</span>
                    ))}
                  </div>
                </div>
              )}
              {refreshWarning && (
                <div className="flex items-start gap-1.5 rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] p-2 text-xs text-[var(--amber-text)]" role="status" aria-live="polite">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <span className="block">{(syncT?.syncStatusRefreshFailed as string) ?? 'Saved, but failed to refresh sync status'}</span>
                    {refreshWarning.split('\n').map((line, i) => (
                      <span key={i} className="block text-foreground/70">{line}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main SyncTab ──────────────────────────────────────────────── */

export function SyncTab({ t, visible }: SyncTabProps) {
  const syncT = t.settings?.sync as Record<string, unknown> | undefined;
  const { status, loaded, error: loadError, stale, fetchStatus } = useSyncStatus();
  const [toggling, setToggling] = useState(false);
  const [intervalSaving, setIntervalSaving] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const resetConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { syncing, syncResult, syncError, syncNow } = useSyncAction(fetchStatus, syncT);

  const showSuccess = useCallback((text: string) => {
    setMessage({ type: 'success', text });
    setTimeout(() => {
      setMessage(current => (current?.type === 'success' && current.text === text ? null : current));
    }, 3000);
  }, []);

  const refreshAfterAction = useCallback(async () => {
    try {
      await fetchStatus({ throwOnError: true });
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const prefix = (syncT?.statusRefreshFailed as string)
        ?? 'The change may have been saved, but MindOS could not refresh sync status. Retry status refresh before continuing.';
      setMessage({ type: 'error', text: `${prefix}\n${formatSyncError(raw, syncT)}` });
      return false;
    }
  }, [fetchStatus, syncT]);

  const clearResetConfirmation = useCallback(() => {
    setConfirmingReset(false);
    if (resetConfirmTimerRef.current) clearTimeout(resetConfirmTimerRef.current);
  }, []);

  // Refresh sync status when the tab becomes visible again (after being hidden via display:none)
  const prevVisible = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      void fetchStatus();
    }
    prevVisible.current = visible;
  }, [visible, fetchStatus]);

  useEffect(() => {
    if (syncResult === 'success') {
      showSuccess((syncT?.syncComplete as string) ?? 'Sync complete');
      return;
    }
    if (syncResult === 'error' && syncError) {
      setMessage({ type: 'error', text: syncError });
    }
  }, [showSuccess, syncError, syncResult, syncT]);

  useEffect(() => () => {
    if (resetConfirmTimerRef.current) clearTimeout(resetConfirmTimerRef.current);
  }, []);

  const blockUnsafeMutation = useCallback(() => {
    if (stale) {
      const prefix = (syncT?.statusRefreshRequired as string)
        ?? 'Sync status is outdated. Retry status refresh before changing sync settings.';
      setMessage({ type: 'error', text: loadError ? `${prefix}\n${formatSyncError(loadError, syncT)}` : prefix });
      return true;
    }
    if ((status?.conflicts?.length ?? 0) > 0) {
      setMessage({
        type: 'error',
        text: (syncT?.resolveConflictsBeforeSettings as string)
          ?? 'Resolve conflicts before changing sync settings.',
      });
      return true;
    }
    return false;
  }, [loadError, stale, status?.conflicts?.length, syncT]);

  const handleSyncNow = () => {
    if (blockUnsafeMutation()) return;
    setMessage(null);
    void syncNow();
  };

  const handleToggle = async () => {
    if (!status) return;
    if (blockUnsafeMutation()) return;
    setToggling(true);
    setMessage(null);
    const action = status.enabled ? 'off' : 'on';
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const refreshed = await refreshAfterAction();
      if (!refreshed) return;
      showSuccess(status.enabled ? ((syncT?.autoSyncDisabled as string) ?? 'Auto-sync disabled') : ((syncT?.autoSyncEnabled as string) ?? 'Auto-sync enabled'));
    } catch (err) {
      const raw = err instanceof Error ? err.message : ((syncT?.toggleFailed as string) ?? 'Failed to toggle sync');
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
    } finally {
      setToggling(false);
    }
  };

  const handleReset = async () => {
    if (blockUnsafeMutation()) return;
    if (!confirmingReset) {
      setConfirmingReset(true);
      setMessage(null);
      if (resetConfirmTimerRef.current) clearTimeout(resetConfirmTimerRef.current);
      resetConfirmTimerRef.current = setTimeout(() => setConfirmingReset(false), 3000);
      return;
    }
    clearResetConfirmation();
    setToggling(true);
    setMessage(null);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      await refreshAfterAction();
    } catch (err) {
      const raw = err instanceof Error ? err.message : ((syncT?.resetFailed as string) ?? 'Failed to reset sync configuration');
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
    } finally {
      setToggling(false);
    }
  };

  const handleUpdateIntervals = async (patch: { autoCommitInterval?: number; autoPullInterval?: number }) => {
    if (intervalSaving) return;
    if (blockUnsafeMutation()) return;
    setMessage(null);
    setIntervalSaving(true);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-intervals', ...patch }),
      });
      const refreshed = await refreshAfterAction();
      if (!refreshed) return;
      showSuccess((syncT?.settingsSaved as string) ?? 'Sync settings saved');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Failed to update sync settings';
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
    } finally {
      setIntervalSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError && !status) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-destructive">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">{(syncT?.loadFailedTitle as string) ?? 'Could not load sync status'}</h3>
              <p className="text-xs text-destructive/80">{formatSyncError(loadError, syncT)}</p>
            </div>
            <PrimaryButton onClick={() => void fetchStatus()} className="flex items-center gap-2">
              <RefreshCw size={14} />
              {(syncT?.retry as string) ?? 'Retry'}
            </PrimaryButton>
            <SyncActionMessage message={message} />
          </div>
        </div>
      </div>
    );
  }

  const shouldBlockUnsafeStaleActions = stale && status && loadError && (
    (!status.enabled && !status.configured) || !!status.needsSetup
  );

  if (shouldBlockUnsafeStaleActions) {
    const health = getSyncHealth(status, syncT, loadError);
    return (
      <div className="space-y-4">
        <div className={`rounded-xl border p-4 ${healthToneClass(health.tone)}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/65">
                {health.icon}
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">{health.title}</h3>
                <p className="text-xs leading-relaxed text-foreground/75">{health.description}</p>
                <p className="text-xs font-medium">{health.next}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void fetchStatus()}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-sm text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw size={13} />
              {(syncT?.retry as string) ?? 'Retry'}
            </button>
          </div>
        </div>
        <SyncActionMessage message={message} />
      </div>
    );
  }

  if (!status || (!status.enabled && !status.configured)) {
    return <SyncEmptyState t={t} onInitComplete={fetchStatus} />;
  }

  // Broken state: config says enabled but repo/remote is missing
  if (status.needsSetup) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10">
          <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-destructive">
              {(syncT?.brokenTitle as string) ?? 'Sync configuration is broken'}
            </h3>
            <p className="text-xs text-destructive/80">
              {status.lastError || ((syncT?.brokenDesc as string) ?? 'The git repository or remote is missing. Reset to re-configure.')}
            </p>
            <button
              type="button"
              onClick={handleReset}
              disabled={toggling}
              onBlur={() => { if (confirmingReset) clearResetConfirmation(); }}
              className={`mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                confirmingReset
                  ? 'border border-destructive/25 bg-destructive/10 text-destructive'
                  : 'bg-[var(--amber)] text-[var(--amber-foreground)]'
              }`}
            >
              {toggling && <Loader2 size={14} className="animate-spin" />}
              {confirmingReset
                ? ((syncT?.resetConfirm as string) ?? 'Confirm forget settings?')
                : ((syncT?.resetButton as string) ?? 'Forget local sync settings')}
            </button>
            <p className="text-xs text-destructive/70">
              {(syncT?.resetHelp as string) ?? 'Keeps your notes and Git repository. Clears MindOS sync settings so you can connect again.'}
            </p>
            <SyncActionMessage message={message} />
          </div>
        </div>
      </div>
    );
  }

  const conflicts = status.conflicts || [];
  const health = getSyncHealth(status, syncT, stale ? loadError : null);
  const unpushedCount = getUnpushedCount(status);
  const unpushedKnown = !hasUnknownUnpushedCount(status);
  const statusLevel = getStatusLevel(status, false);
  const showHealthSyncAction = !stale && conflicts.length === 0 && statusLevel !== 'off';
  const settingsMutationDisabled = stale || conflicts.length > 0;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${healthToneClass(health.tone)}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/65">
              {health.icon}
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-foreground">{health.title}</h3>
              <p className="text-xs leading-relaxed text-foreground/75">{health.description}</p>
              <p className="text-xs font-medium">{health.next}</p>
            </div>
          </div>
          {stale ? (
            <button
              type="button"
              onClick={() => void fetchStatus()}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-sm text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw size={13} />
              {(syncT?.retry as string) ?? 'Retry'}
            </button>
          ) : showHealthSyncAction && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={syncing}
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/80 px-3 text-sm text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
              {(syncT?.syncNow as string) ?? 'Sync now'}
            </button>
          )}
        </div>
      </div>

      <SettingCard
        icon={<GitBranch size={15} />}
        title={(syncT?.repositoryTitle as string) ?? 'Repository'}
        description={status.remote}
        badge={
          <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${
            status.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
          }`}>
            {status.enabled
              ? ((syncT?.labelEnabled as string) ?? 'Active')
              : ((syncT?.labelPaused as string) ?? 'Paused')}
          </span>
        }
      >
        {/* Status rows */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{(syncT?.labelBranch as string) ?? 'Branch'}</span>
            <span className="font-mono text-xs">{status.branch}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{(syncT?.labelLastSync as string) ?? 'Last sync'}</span>
            <span className="text-xs">
              {status.lastSync
                ? timeAgo(status.lastSync, syncT)
                : ((syncT?.labelNoSyncYet as string) ?? 'Not synced yet')}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{(syncT?.labelUnpushed as string) ?? 'Local changes'}</span>
            <span className="text-xs">
              {unpushedKnown && typeof status.unpushed === 'string' && /^\d+$/.test(status.unpushed)
                ? ((syncT?.unpushedCommits as ((n: number) => string))?.(unpushedCount) ?? `${unpushedCount} changes`)
                : ((syncT?.labelUnknown as string) ?? 'Unknown')}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {status.enabled ? (
            <>
              <button
                type="button"
                onClick={handleToggle}
                disabled={settingsMutationDisabled || toggling || syncing}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(syncT?.disableAutoSync as string) ?? 'Disable Auto-sync'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={settingsMutationDisabled || toggling || syncing}
                onBlur={() => { if (confirmingReset) clearResetConfirmation(); }}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  confirmingReset
                    ? 'border-destructive/25 bg-destructive/10 text-destructive'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {confirmingReset
                  ? ((syncT?.changeRepositoryConfirm as string) ?? 'Confirm change repository?')
                  : ((syncT?.changeRepositoryButton as string) ?? 'Change repository')}
              </button>
              <p className="basis-full text-xs text-muted-foreground">
                {(syncT?.changeRepositoryHelp as string) ?? 'Stops auto-sync and returns to setup so you can connect another remote. Notes and Git history stay on this device.'}
              </p>
            </>
          ) : (
            <>
              <PrimaryButton
                onClick={handleToggle}
                disabled={settingsMutationDisabled || toggling}
                className="flex min-h-9 items-center gap-2"
              >
                {toggling && <Loader2 size={14} className="animate-spin" />}
                {(syncT?.enableAutoSync as string) ?? 'Enable Auto-sync'}
              </PrimaryButton>
              <button
                type="button"
                onClick={handleReset}
                disabled={settingsMutationDisabled || toggling}
                onBlur={() => { if (confirmingReset) clearResetConfirmation(); }}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  confirmingReset
                    ? 'border-destructive/25 bg-destructive/10 text-destructive'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {confirmingReset
                  ? ((syncT?.resetConfirm as string) ?? 'Confirm forget settings?')
                  : ((syncT?.resetButton as string) ?? 'Forget local sync settings')}
              </button>
              <p className="basis-full text-xs text-muted-foreground">
                {(syncT?.resetHelp as string) ?? 'Keeps your notes and Git repository. Clears MindOS sync settings so you can connect again.'}
              </p>
            </>
          )}
        </div>

        <SyncActionMessage message={message} />
        {conflicts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {(syncT?.resolveConflictsBeforeSettings as string)
              ?? 'Resolve conflicts before changing sync settings.'}
          </p>
        )}
      </SettingCard>

      {conflicts.length > 0 && (
        <SettingCard
          icon={<AlertCircle size={15} />}
          title={(syncT?.conflictsTitle as ((n: number) => string))?.(conflicts.length) ?? `Conflicts (${conflicts.length})`}
          description={(syncT?.conflictSectionDesc as string) ?? 'Review each file below. Choose which version to keep before syncing again.'}
          className="border-destructive/25"
        >
          <p className="text-xs text-muted-foreground">
            {(syncT?.conflictExplain as string) ?? 'Choose which version to keep for each file.'}
          </p>
          <div className="space-y-2">
            {conflicts.map((c, i) => (
              <ConflictRow
                key={`${c.file}:${c.time ?? ''}`}
                file={c.file}
                time={c.time}
                noBackup={c.noBackup}
                localExists={c.localExists}
                remoteExists={c.remoteExists}
                syncT={syncT}
                disabled={stale}
                onResolved={refreshAfterAction}
              />
            ))}
          </div>
        </SettingCard>
      )}

      <SettingCard
        icon={<RefreshCw size={15} />}
        title={(syncT?.automationTitle as string) ?? 'Automation'}
        description={status.enabled
          ? ((syncT?.automationDesc as string) ?? 'MindOS keeps syncing in the background while you work.')
          : ((syncT?.automationPausedDesc as string) ?? 'Intervals apply when auto-sync is enabled.')}
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground">{(syncT?.autoCommitLabel as string) ?? 'Save changes every'}</span>
            <Select
              size="sm"
              value={String(status.autoCommitInterval ?? 30)}
              disabled={settingsMutationDisabled || intervalSaving}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                void handleUpdateIntervals({ autoCommitInterval: val });
              }}
            >
              <option value="10">10s</option>
              <option value="15">15s</option>
              <option value="30">30s</option>
              <option value="60">60s</option>
              <option value="120">120s</option>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground">{(syncT?.autoPullLabel as string) ?? 'Check for updates every'}</span>
            <Select
              size="sm"
              value={String(status.autoPullInterval ?? 300)}
              disabled={settingsMutationDisabled || intervalSaving}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                void handleUpdateIntervals({ autoPullInterval: val });
              }}
            >
              <option value="60">1min</option>
              <option value="120">2min</option>
              <option value="300">5min</option>
              <option value="600">10min</option>
              <option value="1800">30min</option>
              <option value="3600">60min</option>
            </Select>
          </div>
          {intervalSaving && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
              <Loader2 size={12} className="animate-spin" />
              {(syncT?.settingsSaving as string) ?? 'Saving sync settings...'}
            </div>
          )}
        </div>
      </SettingCard>

      <GitignoreEditor
        syncT={syncT}
        disabled={settingsMutationDisabled}
        onSaved={() => fetchSharedSyncStatus({ force: true, throwOnError: true })}
      />
    </div>
  );
}
