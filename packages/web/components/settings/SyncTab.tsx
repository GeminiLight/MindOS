'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2, GitBranch, Check, ChevronRight, FileX2, GitCommitHorizontal } from 'lucide-react';
import { PrimaryButton, SettingCard, Select } from './Primitives';
import { apiFetch } from '@/lib/api';
import type { SyncStatus, SyncTabProps } from './types';
import { formatSyncError, getSyncErrorHint, getUnpushedCount, SYNC_ACTION_TIMEOUT_MS, timeAgo } from '@/lib/sync-ui';
import { useSyncStatus } from '@/lib/sync-status-store';
import SyncEmptyState from './SyncEmptyState';

export { getSyncErrorHint, timeAgo } from '@/lib/sync-ui';

function getSyncHealth(status: SyncStatus, syncT?: Record<string, unknown>) {
  const conflictCount = status.conflicts?.length ?? 0;
  const unpushedCount = getUnpushedCount(status);

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

  if (unpushedCount > 0) {
    return {
      tone: 'warning' as const,
      title: (syncT?.healthUnpushedTitle as ((n: number) => string))?.(unpushedCount)
        ?? `${unpushedCount} local change${unpushedCount === 1 ? '' : 's'} waiting to upload`,
      description: (syncT?.healthUnpushedDesc as string)
        ?? 'MindOS will push them automatically, or you can run Sync now.',
      next: (syncT?.healthUnpushedNext as string) ?? 'Next: sync now or keep working',
      icon: <GitCommitHorizontal size={18} />,
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

/* ── Conflict Row ──────────────────────────────────────────────── */

function ConflictRow({ file, time, syncT, onResolved }: {
  file: string; time: string; syncT?: Record<string, unknown>; onResolved: () => void;
}) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{ local: string; remote: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const loadPreview = async () => {
    setRowError(null);
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
    if (!preview) {
      setExpanded(true);
      await loadPreview();
      return;
    }
    setRowError(null);
    setResolving(strategy === 'keep-local' ? 'local' : 'remote');
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve-conflict', file, strategy, remote: file, branch: strategy }),
      });
      onResolved();
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
        <span className="text-muted-foreground shrink-0">{timeAgo(time, syncT)}</span>
        {!preview && (
          <span className="text-2xs text-muted-foreground">
            {(syncT?.viewDiffFirst as string) ?? 'View diff first'}
          </span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => handleResolve('keep-local')}
            disabled={!!resolving || !preview}
            className="inline-flex min-h-8 items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-muted transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={(syncT?.keepLocalHint as string) ?? 'Keep this device\'s version'}
          >
            {resolving === 'local' ? <Loader2 size={10} className="animate-spin" /> : ((syncT?.keepLocal as string) ?? 'Keep local')}
          </button>
          <button
            type="button"
            onClick={() => handleResolve('keep-remote')}
            disabled={!!resolving || !preview}
            className="inline-flex min-h-8 items-center gap-1 px-2.5 py-1 rounded-md border border-border text-xs hover:bg-muted transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={(syncT?.keepRemoteHint as string) ?? 'Replace with remote version'}
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
            <div className="grid grid-cols-2 divide-x divide-border/50 text-2xs font-mono max-h-60 overflow-auto">
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
                <pre className="whitespace-pre-wrap text-foreground/80 leading-relaxed">{preview.remote || ((syncT?.emptyFile as string) ?? '(empty)')}</pre>
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

function GitignoreEditor({ syncT }: { syncT?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const dirty = content !== saved;

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    setLoading(true);
    apiFetch<{ content: string }>('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'gitignore-get' }),
    }).then(data => {
      setContent(data.content);
      setSaved(data.content);
      setError(null);
    }).catch((err) => {
      const raw = err instanceof Error ? err.message : ((syncT?.gitignoreLoadFailed as string) ?? 'Failed to load .gitignore');
      setError(formatSyncError(raw, syncT));
    }).finally(() => setLoading(false));
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gitignore-save', content }),
      });
      setSaved(content);
      setSaveOk(true);
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
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
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
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                placeholder={(syncT?.gitignorePlaceholder as string) ?? '# Files to exclude from sync\n*.tmp\nsecret/'}
                spellCheck={false}
              />
              <div className="flex items-center gap-2">
                {dirty && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />}
                    {(syncT?.gitignoreSave as string) ?? 'Save'}
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
  const { status, loaded, error: loadError, fetchStatus } = useSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [intervalSaving, setIntervalSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showSuccess = useCallback((text: string) => {
    setMessage({ type: 'success', text });
    setTimeout(() => {
      setMessage(current => (current?.type === 'success' && current.text === text ? null : current));
    }, 3000);
  }, []);

  // Refresh sync status when the tab becomes visible again (after being hidden via display:none)
  const prevVisible = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      void fetchStatus();
    }
    prevVisible.current = visible;
  }, [visible, fetchStatus]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'now' }),
        timeout: SYNC_ACTION_TIMEOUT_MS, // sync can take 60s+ for large repos
      });
      showSuccess((syncT?.syncComplete as string) ?? 'Sync complete');
      await fetchStatus();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Sync failed';
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    setMessage(null);
    const action = status.enabled ? 'off' : 'on';
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchStatus();
      showSuccess(status.enabled ? ((syncT?.autoSyncDisabled as string) ?? 'Auto-sync disabled') : ((syncT?.autoSyncEnabled as string) ?? 'Auto-sync enabled'));
    } catch (err) {
      const raw = err instanceof Error ? err.message : ((syncT?.toggleFailed as string) ?? 'Failed to toggle sync');
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
    } finally {
      setToggling(false);
    }
  };

  const handleReset = async () => {
    setToggling(true);
    setMessage(null);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      await fetchStatus();
    } catch (err) {
      const raw = err instanceof Error ? err.message : ((syncT?.resetFailed as string) ?? 'Failed to reset sync configuration');
      setMessage({ type: 'error', text: formatSyncError(raw, syncT) });
    } finally {
      setToggling(false);
    }
  };

  const handleUpdateIntervals = async (patch: { autoCommitInterval?: number; autoPullInterval?: number }) => {
    if (intervalSaving) return;
    setMessage(null);
    setIntervalSaving(true);
    try {
      await apiFetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-intervals', ...patch }),
      });
      await fetchStatus();
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
          </div>
        </div>
      </div>
    );
  }

  if (!status || (!status.enabled && !status.configured)) {
    return <SyncEmptyState t={t} onInitComplete={fetchStatus} />;
  }

  if (!status.enabled && status.configured) {
    return (
      <div className="space-y-4">
        <SettingCard
          icon={<GitBranch size={15} />}
          title={(syncT?.repositoryTitle as string) ?? 'Repository'}
          description={status.remote || ((syncT?.notConfigured as string) ?? '(not configured)')}
          badge={
            <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
              {(syncT?.labelPaused as string) ?? 'Paused'}
            </span>
          }
        >
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{(syncT?.labelBranch as string) ?? 'Branch'}</span>
              <span className="font-mono text-xs">{status.branch || 'main'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{(syncT?.labelLastSync as string) ?? 'Last sync'}</span>
              <span className="text-xs">{timeAgo(status.lastSync, syncT)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <PrimaryButton
              onClick={handleToggle}
              disabled={toggling}
              className="flex min-h-9 items-center gap-2"
            >
              {toggling && <Loader2 size={14} className="animate-spin" />}
              {(syncT?.enableAutoSync as string) ?? 'Enable Auto-sync'}
            </PrimaryButton>
            <button
              type="button"
              onClick={handleReset}
              disabled={toggling}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(syncT?.resetButton as string) ?? 'Reset & Re-configure'}
            </button>
          </div>

          {message && (
            <div className="flex items-start gap-1.5 text-xs" role="status" aria-live="polite">
              {message.type === 'success' ? (
                <><CheckCircle2 size={13} className="text-success shrink-0 mt-0.5" /><span className="text-success">{message.text}</span></>
              ) : (
                <>
                  <AlertCircle size={13} className="text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    {message.text.split('\n').map((line, i) => (
                      <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : 'text-destructive'}`}>{line}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </SettingCard>
      </div>
    );
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
            <PrimaryButton
              onClick={handleReset}
              disabled={toggling}
              className="flex items-center gap-2 mt-2"
            >
              {toggling && <Loader2 size={14} className="animate-spin" />}
              {(syncT?.resetButton as string) ?? 'Reset & Re-configure'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  const conflicts = status.conflicts || [];
  const health = getSyncHealth(status, syncT);
  const unpushedCount = getUnpushedCount(status);
  const showHealthSyncAction = conflicts.length === 0;

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
          {showHealthSyncAction && (
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
          <span className="text-2xs px-1.5 py-0.5 rounded bg-success/15 text-success font-medium">
            {(syncT?.labelEnabled as string) ?? 'Active'}
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
            <span className="text-xs">{timeAgo(status.lastSync, syncT)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{(syncT?.labelUnpushed as string) ?? 'Local changes'}</span>
            <span className="text-xs">
              {typeof status.unpushed === 'string' && /^\d+$/.test(status.unpushed)
                ? ((syncT?.unpushedCommits as ((n: number) => string))?.(unpushedCount) ?? `${unpushedCount} changes`)
                : `${status.unpushed ?? '?'} changes`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleToggle}
            disabled={toggling}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(syncT?.disableAutoSync as string) ?? 'Disable Auto-sync'}
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className="flex items-start gap-1.5 text-xs" role="status" aria-live="polite">
            {message.type === 'success' ? (
              <><CheckCircle2 size={13} className="text-success shrink-0 mt-0.5" /><span className="text-success">{message.text}</span></>
            ) : (
              <>
                <AlertCircle size={13} className="text-destructive shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {message.text.split('\n').map((line, i) => (
                    <span key={i} className={`block ${i > 0 ? 'text-destructive/70' : 'text-destructive'}`}>{line}</span>
                  ))}
                </div>
              </>
            )}
          </div>
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
              <ConflictRow key={i} file={c.file} time={c.time} syncT={syncT} onResolved={fetchStatus} />
            ))}
          </div>
        </SettingCard>
      )}

      <SettingCard
        icon={<RefreshCw size={15} />}
        title={(syncT?.automationTitle as string) ?? 'Automation'}
        description={(syncT?.automationDesc as string) ?? 'MindOS keeps syncing in the background while you work.'}
      >
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground">{(syncT?.autoCommitLabel as string) ?? 'Save changes every'}</span>
            <Select
              size="sm"
              value={String(status.autoCommitInterval ?? 30)}
              disabled={intervalSaving}
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
              disabled={intervalSaving}
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

      <GitignoreEditor syncT={syncT} />
    </div>
  );
}
