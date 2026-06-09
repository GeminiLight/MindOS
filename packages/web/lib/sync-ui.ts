import type { SyncStatus } from '@/components/settings/types';

export const SYNC_ACTION_TIMEOUT_MS = 120_000;

export type StatusLevel = 'synced' | 'ready' | 'unpushed' | 'conflicts' | 'error' | 'paused' | 'unknown' | 'off' | 'syncing';

export function timeAgo(iso: string | null | undefined, syncT?: Record<string, unknown>): string {
  if (!iso) return (syncT?.timeNever as string) ?? 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return (syncT?.timeUnknown as string) ?? 'unknown';
  if (diff < 0) return (syncT?.timeJustNow as string) ?? 'just now';
  if (diff < 60000) return (syncT?.timeJustNow as string) ?? 'just now';
  const m = Math.floor(diff / 60000);
  if (diff < 3600000) return (syncT?.timeMinAgo as ((n: number) => string))?.(m) ?? `${m}m ago`;
  const h = Math.floor(diff / 3600000);
  if (diff < 86400000) return (syncT?.timeHourAgo as ((n: number) => string))?.(h) ?? `${h}h ago`;
  const d = Math.floor(diff / 86400000);
  return (syncT?.timeDayAgo as ((n: number) => string))?.(d) ?? `${d}d ago`;
}

export function getUnpushedCount(status: SyncStatus): number {
  const value = (status as SyncStatus & { unpushed?: string | number }).unpushed;
  const parsed = typeof value === 'number' ? value : parseInt(value || '0', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function hasUnknownUnpushedCount(status: SyncStatus): boolean {
  const value = (status as SyncStatus & { unpushed?: string | number }).unpushed;
  if (typeof value === 'number') return !Number.isFinite(value) || value < 0;
  return typeof value === 'string' && value !== '' && !/^\d+$/.test(value);
}

export function getStatusLevel(status: SyncStatus | null, syncing: boolean): StatusLevel {
  if (syncing) return 'syncing';
  if (!status) return 'off';
  if (!status.enabled && !status.configured) return 'off';
  if (status.conflicts && status.conflicts.length > 0) return 'conflicts';
  if (status.lastError) return 'error';
  if (hasUnknownUnpushedCount(status)) return 'unknown';
  if (getUnpushedCount(status) > 0) return 'unpushed';
  if (!status.enabled) return 'paused';
  if (!status.lastSync) return 'ready';
  return 'synced';
}

/** Return an actionable hint for common sync errors. */
export function getGitRemoteHost(remote?: string | null): string | null {
  const value = remote?.trim();
  if (!value) return null;
  const scpLike = value.match(/^[^@\s]+@([^:\s]+):/);
  if (scpLike?.[1]) return scpLike[1];
  try {
    const parsed = new URL(value);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function getHttpsAuthHint(remote?: string | null, syncT?: Record<string, unknown>): string {
  const host = getGitRemoteHost(remote);
  if (!host) {
    return (syncT?.hintHttpsAuth as string)
      ?? 'Access token or Git credentials may be expired or missing. Check this Git host\'s credential settings.';
  }
  if (typeof syncT?.hintHttpsAuthForHost === 'function') {
    return (syncT.hintHttpsAuthForHost as (host: string) => string)(host);
  }
  if (host?.toLowerCase().includes('github.com')) {
    return 'Access token may be expired or missing. Check GitHub Developer settings -> Personal access tokens.';
  }
  if (host?.toLowerCase().includes('gitlab.com')) {
    return 'Access token may be expired or missing. Check GitLab User Settings -> Access Tokens.';
  }
  return `Access token or Git credentials may be expired or missing. Check the credential settings for ${host}.`;
}

/** Return an actionable hint for common sync errors. */
export function getSyncErrorHint(error: string, remote?: string | null, syncT?: Record<string, unknown>): string {
  const lower = error.toLowerCase();
  const host = getGitRemoteHost(remote);

  if (lower.includes('sync_locked') || lower.includes('sync is already running')) {
    return (syncT?.hintSyncLocked as string) ?? 'Another sync operation is already running. Wait a moment, then try again.';
  }
  if (lower.includes('permission denied') || lower.includes('publickey')) {
    if (host) {
      return (syncT?.hintSshAuthForHost as ((host: string) => string))?.(host)
        ?? `SSH key may not be configured. Run: ssh-keygen -t ed25519 && ssh -T git@${host}`;
    }
    return (syncT?.hintSshAuth as string)
      ?? 'SSH key may not be configured. Check the SSH key for this Git host.';
  }
  if (lower.includes('host key') || lower.includes('known_hosts') || lower.includes('fingerprint')) {
    if (host) {
      return (syncT?.hintSshHostForHost as ((host: string) => string))?.(host)
        ?? `Run: ssh-keyscan ${host} >> ~/.ssh/known_hosts`;
    }
    return (syncT?.hintSshHost as string)
      ?? 'Add this Git host to ~/.ssh/known_hosts with ssh-keyscan.';
  }
  if (
    lower.includes('authentication failed') ||
    lower.includes('invalid credentials') ||
    lower.includes('could not read username') ||
    lower.includes('terminal prompts disabled') ||
    lower.includes('password authentication was removed') ||
    lower.includes('401') ||
    lower.includes('403')
  ) {
    return getHttpsAuthHint(remote, syncT);
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
  const message = normalizeSyncError(raw, syncT);
  const hint = getSyncErrorHint(raw, undefined, syncT);
  return hint ? `${message}\n${hint}` : message;
}

function normalizeSyncError(raw: string, syncT?: Record<string, unknown>): string {
  if (/SYNC_LOCKED/i.test(raw) || /Sync is already running/i.test(raw)) {
    return (syncT?.syncLocked as string) ?? 'Sync is already running';
  }
  return raw;
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
      if (!status?.lastSync) {
        return {
          label: (syncT?.syncReady as string) ?? 'Sync ready',
          tooltip: (syncT?.syncReadyHint as string)
            ?? 'No completed sync has been recorded yet. Run Sync Now to create the first backup.',
        };
      }
      const lastSync = timeAgo(status?.lastSync, syncT);
      const l = `${(syncT?.synced as string) ?? 'Synced'} · ${lastSync}`;
      return { label: l, tooltip: l };
    }
    case 'ready':
      return {
        label: (syncT?.syncReady as string) ?? 'Sync ready',
        tooltip: (syncT?.syncReadyHint as string)
          ?? 'No completed sync has been recorded yet. Run Sync Now to create the first backup.',
      };
    case 'unpushed': {
      const n = status ? getUnpushedCount(status) : 0;
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
    case 'paused':
      return {
        label: (syncT?.syncPaused as string) ?? 'Sync paused',
        tooltip: (syncT?.syncPausedHint as string)
          ?? 'Auto-sync is disabled for this repository. Open Settings > Sync to enable it.',
      };
    case 'unknown':
      return {
        label: (syncT?.syncUnknown as string) ?? 'Sync status unknown',
        tooltip: (syncT?.syncUnknownHint as string)
          ?? 'MindOS could not confirm whether local changes have been uploaded. Open Settings > Sync for details.',
      };
    default: {
      const l = (syncT?.syncOff as string) ?? 'Sync off';
      return { label: l, tooltip: l };
    }
  }
}
