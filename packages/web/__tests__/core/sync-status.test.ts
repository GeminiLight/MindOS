import { describe, it, expect } from 'vitest';
import { formatSyncError, getGitRemoteHost, getStatusLevel, getSyncErrorHint, getSyncLabel, getUnpushedCount, hasUnknownUnpushedCount, timeAgo } from '@/lib/sync-ui';
import type { SyncStatus } from '@/components/settings/types';
import { messages } from '@/lib/i18n';

/* ------------------------------------------------------------------ */
/*  timeAgo                                                           */
/* ------------------------------------------------------------------ */

describe('timeAgo', () => {
  it('returns "never" for null/undefined', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo(undefined)).toBe('never');
  });

  it('does not emit NaN for invalid timestamps', () => {
    expect(timeAgo('not-a-date')).toBe('unknown');
  });

  it('returns "just now" for < 60s ago', () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns minutes for < 1h ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours for < 24h ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(timeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('returns days for >= 24h ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect(timeAgo(threeDaysAgo)).toBe('3d ago');
  });
});

/* ------------------------------------------------------------------ */
/*  getStatusLevel                                                    */
/* ------------------------------------------------------------------ */

const base: SyncStatus = {
  enabled: true,
  provider: 'git',
  remote: 'origin',
  branch: 'main',
  lastSync: new Date().toISOString(),
  lastPull: null,
  unpushed: '0',
  conflicts: [],
  lastError: null,
  autoCommitInterval: 30,
  autoPullInterval: 300,
};

describe('getStatusLevel', () => {
  it('returns "syncing" when syncing flag is true, regardless of status', () => {
    expect(getStatusLevel(null, true)).toBe('syncing');
    expect(getStatusLevel(base, true)).toBe('syncing');
    expect(getStatusLevel({ ...base, lastError: 'fail' }, true)).toBe('syncing');
  });

  it('returns "off" when status is null', () => {
    expect(getStatusLevel(null, false)).toBe('off');
  });

  it('returns "off" when sync is not enabled and not configured', () => {
    expect(getStatusLevel({ ...base, enabled: false }, false)).toBe('off');
  });

  it('returns "paused" when sync is configured but disabled', () => {
    expect(getStatusLevel({ ...base, enabled: false, configured: true }, false)).toBe('paused');
  });

  it('keeps attention states visible even when auto-sync is paused', () => {
    expect(getStatusLevel({
      ...base,
      enabled: false,
      configured: true,
      conflicts: [{ file: 'a.md', time: '2026-01-01T00:00:00Z' }],
    }, false)).toBe('conflicts');
    expect(getStatusLevel({ ...base, enabled: false, configured: true, lastError: 'push failed' }, false)).toBe('error');
    expect(getStatusLevel({ ...base, enabled: false, configured: true, unpushed: '?' }, false)).toBe('unknown');
    expect(getStatusLevel({ ...base, enabled: false, configured: true, unpushed: '2' }, false)).toBe('unpushed');
  });

  it('returns "error" when lastError is set', () => {
    expect(getStatusLevel({ ...base, lastError: 'push failed' }, false)).toBe('error');
  });

  it('conflicts take priority over error and unpushed', () => {
    const status: SyncStatus = {
      ...base,
      lastError: 'network down',
      conflicts: [{ file: 'a.md', time: '2026-01-01T00:00:00Z' }],
      unpushed: '3',
    };
    expect(getStatusLevel(status, false)).toBe('conflicts');
  });

  it('returns "conflicts" when conflicts exist (and no error)', () => {
    const status: SyncStatus = {
      ...base,
      conflicts: [{ file: 'notes.md', time: '2026-01-01T00:00:00Z' }],
    };
    expect(getStatusLevel(status, false)).toBe('conflicts');
  });

  it('conflicts take priority over unpushed', () => {
    const status: SyncStatus = {
      ...base,
      conflicts: [{ file: 'a.md', time: '2026-01-01T00:00:00Z' }],
      unpushed: '5',
    };
    expect(getStatusLevel(status, false)).toBe('conflicts');
  });

  it('returns "unpushed" when unpushed > 0', () => {
    expect(getStatusLevel({ ...base, unpushed: '3' }, false)).toBe('unpushed');
    expect(getStatusLevel({ ...base, unpushed: '1' }, false)).toBe('unpushed');
  });

  it('returns "unknown" when unpushed count cannot be read', () => {
    expect(getStatusLevel({ ...base, unpushed: '?' }, false)).toBe('unknown');
  });

  it('treats legacy invalid numeric unpushed counts as unknown', () => {
    const negative = { ...base, unpushed: -1 } as SyncStatus & { unpushed: number };
    const infinite = { ...base, unpushed: Infinity } as SyncStatus & { unpushed: number };

    expect(getUnpushedCount(negative)).toBe(0);
    expect(getUnpushedCount(infinite)).toBe(0);
    expect(hasUnknownUnpushedCount(negative)).toBe(true);
    expect(hasUnknownUnpushedCount(infinite)).toBe(true);
    expect(getStatusLevel(negative, false)).toBe('unknown');
    expect(getStatusLevel(infinite, false)).toBe('unknown');
  });

  it('returns "synced" when everything is clean', () => {
    expect(getStatusLevel(base, false)).toBe('synced');
  });

  it('returns "ready" when sync is configured but no backup has completed yet', () => {
    expect(getStatusLevel({ ...base, lastSync: null, unpushed: '0' }, false)).toBe('ready');
  });

  it('returns "synced" when unpushed is "0"', () => {
    expect(getStatusLevel({ ...base, unpushed: '0' }, false)).toBe('synced');
  });

  it('returns "synced" when unpushed is empty string', () => {
    expect(getStatusLevel({ ...base, unpushed: '' }, false)).toBe('synced');
  });

  it('returns "synced" when conflicts is empty array', () => {
    expect(getStatusLevel({ ...base, conflicts: [] }, false)).toBe('synced');
  });
});

describe('getSyncLabel', () => {
  it('uses sidebar sync time localization for synced labels', () => {
    const lastSync = new Date(Date.now() - 5 * 60_000).toISOString();
    const label = getSyncLabel('synced', { ...base, lastSync }, messages.zh.sidebar.sync as Record<string, unknown>);

    expect(label.label).toContain('已同步');
    expect(label.label).toContain('5 分钟前');
    expect(label.label).not.toContain('5m ago');
  });

  it('does not call a clean repository synced when no sync has ever been recorded', () => {
    const label = getSyncLabel('ready', { ...base, lastSync: null });

    expect(label.label).toBe('Sync ready');
    expect(label.tooltip).toContain('No completed sync has been recorded');
    expect(label.label).not.toContain('never');
  });

  it('uses user-facing language for pending local changes', () => {
    const label = getSyncLabel('unpushed', { ...base, unpushed: '3' });

    expect(label.label).toBe('3 changes to upload');
    expect(label.tooltip).toContain('Run Sync now');
  });

  it('uses recovery language for conflicts', () => {
    const label = getSyncLabel('conflicts', {
      ...base,
      conflicts: [
        { file: 'a.md', time: '2026-01-01T00:00:00Z' },
        { file: 'b.md', time: '2026-01-01T00:00:00Z' },
      ],
    });

    expect(label.label).toBe('Resolve 2 conflicts');
    expect(label.tooltip).toContain('Open Settings > Sync');
  });

  it('uses paused language for configured disabled repositories', () => {
    const label = getSyncLabel('paused', { ...base, enabled: false, configured: true });

    expect(label.label).toBe('Sync paused');
    expect(label.tooltip).toContain('Auto-sync is disabled');
  });

  it('uses unknown language when Git upstream cannot be inspected', () => {
    const label = getSyncLabel('unknown', { ...base, unpushed: '?' });

    expect(label.label).toBe('Sync status unknown');
    expect(label.tooltip).toContain('could not confirm');
  });

  it('normalizes sync lock errors into user-facing guidance', () => {
    const message = formatSyncError('SYNC_LOCKED: Sync is already running (owner=manual-sync, pid=123)');

    expect(message).toContain('Sync is already running');
    expect(message).not.toContain('pid=123');
    expect(message).toContain('Another sync operation is already running');
  });
});

describe('sync error hints', () => {
  it('derives SSH host commands from the configured remote', () => {
    expect(getGitRemoteHost('git@gitlab.com:me/mind.git')).toBe('gitlab.com');
    expect(getGitRemoteHost('ssh://git@git.my-company.com/team/mind.git')).toBe('git.my-company.com');
    expect(getSyncErrorHint('Permission denied (publickey)', 'git@gitlab.com:me/mind.git'))
      .toContain('ssh -T git@gitlab.com');
    expect(getSyncErrorHint('Host key verification failed', 'ssh://git@git.my-company.com/team/mind.git'))
      .toContain('ssh-keyscan git.my-company.com');
  });

  it('does not show GitHub token guidance for GitLab and self-hosted HTTPS remotes', () => {
    expect(getSyncErrorHint('Authentication failed', 'https://gitlab.com/me/mind.git'))
      .toContain('GitLab User Settings');
    const selfHosted = getSyncErrorHint('Authentication failed', 'https://git.my-company.com/team/mind.git');
    expect(selfHosted).toContain('git.my-company.com');
    expect(selfHosted).not.toContain('GitHub');
  });
});
