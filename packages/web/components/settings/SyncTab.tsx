'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, Loader2, GitBranch } from 'lucide-react';
import { PrimaryButton, SettingCard, Select } from './Primitives';
import { apiFetch } from '@/lib/api';
import type { SyncTabProps } from './types';
import { formatSyncError, getStatusLevel, getUnpushedCount, hasUnknownUnpushedCount, timeAgo } from '@/lib/sync-ui';
import { fetchSharedSyncStatus, useSyncAction, useSyncStatus } from '@/lib/sync-status-store';
import SyncEmptyState from './SyncEmptyState';
import { ConflictRow } from './sync/ConflictRow';
import { GitignoreEditor } from './sync/GitignoreEditor';
import { SyncActionMessage } from './sync/SyncActionMessage';
import { getSyncHealth, healthToneClass } from './sync/sync-health';

export { getSyncErrorHint, timeAgo } from '@/lib/sync-ui';

/* ── Main SyncTab ──────────────────────────────────────────────── */

export function SyncTab({ t, visible }: SyncTabProps) {
  const syncT = t.settings?.sync as Record<string, unknown> | undefined;
  const { status, loaded, error: loadError, stale, fetchStatus } = useSyncStatus();
  const [toggling, setToggling] = useState(false);
  const [intervalSaving, setIntervalSaving] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const resetConfirmTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const successMessageTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { syncing, syncResult, syncError, syncNow } = useSyncAction(fetchStatus, syncT);

  const showSuccess = useCallback((text: string) => {
    if (successMessageTimerRef.current) clearTimeout(successMessageTimerRef.current);
    setMessage({ type: 'success', text });
    successMessageTimerRef.current = setTimeout(() => {
      setMessage(current => (current?.type === 'success' && current.text === text ? null : current));
      successMessageTimerRef.current = undefined;
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
    if (syncResult !== 'success' && !(syncResult === 'error' && syncError)) return;
    const id = window.setTimeout(() => {
      if (syncResult === 'success') {
        showSuccess((syncT?.syncComplete as string) ?? 'Sync complete');
        return;
      }
      if (syncResult === 'error' && syncError) {
        setMessage({ type: 'error', text: syncError });
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [showSuccess, syncError, syncResult, syncT]);

  useEffect(() => () => {
    if (resetConfirmTimerRef.current) clearTimeout(resetConfirmTimerRef.current);
    if (successMessageTimerRef.current) clearTimeout(successMessageTimerRef.current);
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
                <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/75">{health.description}</p>
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
              <p className="whitespace-pre-line text-xs leading-relaxed text-foreground/75">{health.description}</p>
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
            {conflicts.map(c => (
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
