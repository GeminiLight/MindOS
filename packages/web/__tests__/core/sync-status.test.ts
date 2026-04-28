import { describe, it, expect } from 'vitest';
import { timeAgo } from '@/components/settings/SyncTab';
import { getStatusLevel } from '@/components/SyncStatusBar';
import type { SyncStatus } from '@/components/settings/types';

/* ------------------------------------------------------------------ */
/*  timeAgo                                                           */
/* ------------------------------------------------------------------ */

describe('timeAgo', () => {
  it('returns "never" for null/undefined', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo(undefined)).toBe('never');
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

  it('returns "off" when sync is not enabled', () => {
    expect(getStatusLevel({ ...base, enabled: false }, false)).toBe('off');
  });

  it('returns "error" when lastError is set', () => {
    expect(getStatusLevel({ ...base, lastError: 'push failed' }, false)).toBe('error');
  });

  it('error takes priority over conflicts and unpushed', () => {
    const status: SyncStatus = {
      ...base,
      lastError: 'network down',
      conflicts: [{ file: 'a.md', time: '2026-01-01T00:00:00Z' }],
      unpushed: '3',
    };
    expect(getStatusLevel(status, false)).toBe('error');
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

  it('returns "synced" when everything is clean', () => {
    expect(getStatusLevel(base, false)).toBe('synced');
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
