import type { SyncStatus } from '@/components/settings/types';

export const SYNC_ACTION_TIMEOUT_MS = 120_000;

export type StatusLevel = 'synced' | 'unpushed' | 'conflicts' | 'error' | 'off' | 'syncing';

export function timeAgo(iso: string | null | undefined, syncT?: Record<string, unknown>): string {
  if (!iso) return (syncT?.timeNever as string) ?? 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return (syncT?.timeJustNow as string) ?? 'just now';
  const m = Math.floor(diff / 60000);
  if (diff < 3600000) return (syncT?.timeMinAgo as ((n: number) => string))?.(m) ?? `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (diff < 86400000) return (syncT?.timeHourAgo as ((n: number) => string))?.(h) ?? `${h}h ago`;
  const d = Math.floor(diff / 86400000);
  return (syncT?.timeDayAgo as ((n: number) => string))?.(d) ?? `${d}d ago`;
}

export function getUnpushedCount(status: SyncStatus): number {
  const parsed = parseInt(status.unpushed || '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getStatusLevel(status: SyncStatus | null, syncing: boolean): StatusLevel {
  if (syncing) return 'syncing';
  if (!status || !status.enabled) return 'off';
  if (status.conflicts && status.conflicts.length > 0) return 'conflicts';
  if (status.lastError) return 'error';
  if (getUnpushedCount(status) > 0) return 'unpushed';
  return 'synced';
}

/** Return an actionable hint for common sync errors. */
export function getSyncErrorHint(error: string, _remote?: string | null, syncT?: Record<string, unknown>): string {
  const lower = error.toLowerCase();

  if (lower.includes('permission denied') || lower.includes('publickey')) {
    return (syncT?.hintSshAuth as string) ?? 'SSH key may not be configured. Run: ssh-keygen -t ed25519 && ssh -T git@github.com';
  }
  if (lower.includes('host key') || lower.includes('known_hosts') || lower.includes('fingerprint')) {
    return (syncT?.hintSshHost as string) ?? 'Run: ssh-keyscan github.com >> ~/.ssh/known_hosts';
  }
  if (lower.includes('authentication failed') || lower.includes('invalid credentials') || lower.includes('401') || lower.includes('403')) {
    return (syncT?.hintHttpsAuth as string) ?? 'Access token may be expired or missing. Check Settings -> Developer settings -> Personal access tokens.';
  }
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('could not resolve')) {
    return (syncT?.hintNetwork as string) ?? 'Check your network connection and try again.';
  }
  if (lower.includes('not found') || lower.includes('does not exist') || lower.includes('repository not found')) {
    return (syncT?.hintNotFound as string) ?? 'Repository not found. Check the URL and ensure the repo exists.';
  }
  if (lower.includes('non-fast-forward') || lower.includes('rejected') || lower.includes('fetch first')) {
    return (syncT?.hintPushRejected as string) ?? 'Remote has changes. Click "Sync Now" to pull and retry.';
  }
  if (lower.includes('conflict') || lower.includes('merge')) {
    return (syncT?.hintConflict as string) ?? 'Merge conflict detected. Check the Conflicts section below.';
  }

  return '';
}

/** Classify a raw sync error and return a user-friendly message with action hint. */
export function formatSyncError(raw: string, syncT?: Record<string, unknown>): string {
  const hint = getSyncErrorHint(raw, undefined, syncT);
  return hint ? `${raw}\n${hint}` : raw;
}

/** Shared status label formatter — used by SyncStatusBar and SyncPopover. */
export function getSyncLabel(
  level: StatusLevel,
  status: SyncStatus | null,
  syncT?: Record<string, unknown>,
): { label: string; tooltip: string } {
  switch (level) {
    case 'syncing': {
      const l = (syncT?.syncing as string) ?? 'Syncing...';
      return { label: l, tooltip: l };
    }
    case 'synced': {
      const lastSync = timeAgo(status?.lastSync, syncT);
      const l = `${(syncT?.synced as string) ?? 'Synced'} · ${lastSync}`;
      return { label: l, tooltip: l };
    }
    case 'unpushed': {
      const n = parseInt(status?.unpushed || '0', 10);
      return {
        label: (syncT?.changesToUpload as string)?.replace('{n}', String(n)) ?? `${n} changes to upload`,
        tooltip: (syncT?.changesToUploadHint as string)
          ?? `${n} local change(s) are not backed up yet. Run Sync now or let auto-sync upload them.`,
      };
    }
    case 'conflicts': {
      const n = status?.conflicts?.length || 0;
      return {
        label: (syncT?.resolveConflicts as string)?.replace('{n}', String(n)) ?? `Resolve ${n} conflicts`,
        tooltip: (syncT?.resolveConflictsHint as string)
          ?? `${n} file(s) changed in two places. Open Settings > Sync to choose which version to keep.`,
      };
    }
    case 'error':
      return {
        label: (syncT?.syncError as string) ?? 'Sync error',
        tooltip: status?.lastError || ((syncT?.syncError as string) ?? 'Sync error'),
      };
    default: {
      const l = (syncT?.syncOff as string) ?? 'Sync off';
      return { label: l, tooltip: l };
    }
  }
}
