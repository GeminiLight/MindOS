import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeAllMindosDatabases, type MindosDatabase } from './sqlite.js';
import {
  LeaseBusyError,
  STATE_DB_RELATIVE_PATH,
  acquireLease,
  openStateDatabase,
  readLease,
  releaseLease,
  renewLease,
  tryAcquireLease,
} from './leases.js';

const KEY = { kind: 'automations', key: 'state' };

let root = '';
let db: MindosDatabase;

describe('foundation/storage/leases', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-leases-'));
    db = openStateDatabase(root);
  });

  afterEach(() => {
    closeAllMindosDatabases();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('openStateDatabase', () => {
    it('creates the state database under .mindos/db and reuses the handle', () => {
      expect(fs.existsSync(path.join(root, STATE_DB_RELATIVE_PATH))).toBe(true);
      expect(openStateDatabase(root)).toBe(db);
    });

    it('refuses a .mindos directory that escapes the mind root through a symlink', () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-leases-outside-'));
      const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-leases-root-'));
      try {
        fs.symlinkSync(outside, path.join(other, '.mindos'));
        expect(() => openStateDatabase(other)).toThrow(/Access denied/);
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('tryAcquireLease', () => {
    it('grants a free lease with the requested ttl and a generated owner', () => {
      const now = 1_700_000_000_000;
      const result = tryAcquireLease(db, { ...KEY, ttlMs: 30_000, now: () => now });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.lease).toMatchObject({ ...KEY, acquiredAt: now, leaseUntil: now + 30_000 });
      expect(result.lease.owner).toMatch(/^pid-\d+-[0-9a-f-]{36}$/);
      expect(readLease(db, KEY)).toEqual(result.lease);
    });

    it('reports the current holder instead of taking over a fresh lease', () => {
      const first = tryAcquireLease(db, { ...KEY, ttlMs: 30_000, owner: 'first' });
      const second = tryAcquireLease(db, { ...KEY, ttlMs: 30_000, owner: 'second' });
      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, holder: expect.objectContaining({ owner: 'first' }) });
      expect(readLease(db, KEY)?.owner).toBe('first');
    });

    it('takes over a lease whose lease_until has passed', () => {
      const t0 = 1_700_000_000_000;
      tryAcquireLease(db, { ...KEY, ttlMs: 1_000, owner: 'dead', now: () => t0 });
      const takeover = tryAcquireLease(db, { ...KEY, ttlMs: 5_000, owner: 'alive', now: () => t0 + 1_000 });
      expect(takeover.ok).toBe(true);
      expect(readLease(db, KEY)).toMatchObject({ owner: 'alive', acquiredAt: t0 + 1_000, leaseUntil: t0 + 6_000 });
    });

    it('does not take over one millisecond before expiry', () => {
      const t0 = 1_700_000_000_000;
      tryAcquireLease(db, { ...KEY, ttlMs: 1_000, owner: 'holder', now: () => t0 });
      const early = tryAcquireLease(db, { ...KEY, ttlMs: 1_000, owner: 'eager', now: () => t0 + 999 });
      expect(early.ok).toBe(false);
    });

    it('keeps leases with a different kind or key independent', () => {
      expect(tryAcquireLease(db, { ...KEY, ttlMs: 1_000, owner: 'a' }).ok).toBe(true);
      expect(tryAcquireLease(db, { kind: 'automations', key: 'other', ttlMs: 1_000, owner: 'b' }).ok).toBe(true);
      expect(tryAcquireLease(db, { kind: 'connections', key: 'state', ttlMs: 1_000, owner: 'c' }).ok).toBe(true);
      expect(readLease(db, KEY)?.owner).toBe('a');
      expect(readLease(db, { kind: 'connections', key: 'state' })?.owner).toBe('c');
    });

    it('accepts unicode and whitespace-bearing keys verbatim', () => {
      const key = { kind: 'automations', key: '知识库 état 🚀 with space' };
      expect(tryAcquireLease(db, { ...key, ttlMs: 1_000, owner: 'u' }).ok).toBe(true);
      expect(readLease(db, key)?.key).toBe(key.key);
    });

    it.each([
      ['empty kind', { kind: '', key: 'state', ttlMs: 1_000 }],
      ['blank key', { kind: 'automations', key: '   ', ttlMs: 1_000 }],
      ['overlong key', { kind: 'automations', key: 'k'.repeat(201), ttlMs: 1_000 }],
      ['zero ttl', { ...KEY, ttlMs: 0 }],
      ['negative ttl', { ...KEY, ttlMs: -5 }],
      ['NaN ttl', { ...KEY, ttlMs: Number.NaN }],
      ['infinite ttl', { ...KEY, ttlMs: Number.POSITIVE_INFINITY }],
      ['empty owner', { ...KEY, ttlMs: 1_000, owner: '' }],
    ])('rejects %s without touching the table', (_label, options) => {
      expect(() => tryAcquireLease(db, options as never)).toThrow(/lease/i);
      expect(readLease(db, KEY)).toBeNull();
    });
  });

  describe('releaseLease', () => {
    it('deletes the row only when the owner matches', () => {
      const result = tryAcquireLease(db, { ...KEY, ttlMs: 30_000, owner: 'holder' });
      if (!result.ok) throw new Error('expected acquisition');
      expect(releaseLease(db, { ...result.lease, owner: 'impostor' })).toBe(false);
      expect(readLease(db, KEY)?.owner).toBe('holder');
      expect(releaseLease(db, result.lease)).toBe(true);
      expect(readLease(db, KEY)).toBeNull();
    });

    it('returns false when the lease was already taken over by someone else', () => {
      const t0 = 1_700_000_000_000;
      const stale = tryAcquireLease(db, { ...KEY, ttlMs: 10, owner: 'slow', now: () => t0 });
      tryAcquireLease(db, { ...KEY, ttlMs: 10_000, owner: 'fast', now: () => t0 + 10 });
      if (!stale.ok) throw new Error('expected acquisition');
      expect(releaseLease(db, stale.lease)).toBe(false);
      expect(readLease(db, KEY)?.owner).toBe('fast');
    });
  });

  describe('renewLease', () => {
    it('extends lease_until for the owner and returns the refreshed lease', () => {
      const t0 = 1_700_000_000_000;
      const result = tryAcquireLease(db, { ...KEY, ttlMs: 1_000, owner: 'holder', now: () => t0 });
      if (!result.ok) throw new Error('expected acquisition');
      const renewed = renewLease(db, result.lease, 5_000, () => t0 + 500);
      expect(renewed).toMatchObject({ owner: 'holder', acquiredAt: t0, leaseUntil: t0 + 5_500 });
      expect(readLease(db, KEY)?.leaseUntil).toBe(t0 + 5_500);
    });

    it('refuses to renew for a non-owner or after expiry', () => {
      const t0 = 1_700_000_000_000;
      const result = tryAcquireLease(db, { ...KEY, ttlMs: 1_000, owner: 'holder', now: () => t0 });
      if (!result.ok) throw new Error('expected acquisition');
      expect(renewLease(db, { ...result.lease, owner: 'impostor' }, 5_000, () => t0 + 10)).toBeNull();
      expect(renewLease(db, result.lease, 5_000, () => t0 + 1_000)).toBeNull();
      expect(readLease(db, KEY)?.leaseUntil).toBe(t0 + 1_000);
    });
  });

  describe('acquireLease', () => {
    it('returns immediately when the lease is free without sleeping', () => {
      const sleeps: number[] = [];
      const lease = acquireLease(db, { ...KEY, ttlMs: 1_000, sleep: (ms) => sleeps.push(ms) });
      expect(lease.owner).toMatch(/^pid-/);
      expect(sleeps).toEqual([]);
    });

    it('waits with a bounded backoff and succeeds once the holder releases', () => {
      const holder = tryAcquireLease(db, { ...KEY, ttlMs: 60_000, owner: 'holder' });
      if (!holder.ok) throw new Error('expected acquisition');
      const sleeps: number[] = [];
      const lease = acquireLease(db, {
        ...KEY,
        ttlMs: 1_000,
        waitMs: 1_000,
        sleep: (ms) => {
          sleeps.push(ms);
          if (sleeps.length === 3) releaseLease(db, holder.lease);
        },
      });
      expect(lease.owner).not.toBe('holder');
      expect(sleeps).toEqual([5, 10, 20]);
      expect(readLease(db, KEY)?.owner).toBe(lease.owner);
    });

    it('never sleeps past the holder\'s remaining lease time', () => {
      const t0 = 1_700_000_000_000;
      let now = t0;
      tryAcquireLease(db, { ...KEY, ttlMs: 12, owner: 'holder', now: () => now });
      const sleeps: number[] = [];
      const lease = acquireLease(db, {
        ...KEY,
        ttlMs: 1_000,
        waitMs: 1_000,
        now: () => now,
        sleep: (ms) => { sleeps.push(ms); now += ms; },
      });
      expect(sleeps).toEqual([5, 7]);
      expect(lease.acquiredAt).toBe(t0 + 12);
    });

    it('throws LeaseBusyError with the holder once the wait budget is spent', () => {
      const t0 = 1_700_000_000_000;
      let now = t0;
      tryAcquireLease(db, { ...KEY, ttlMs: 600_000, owner: 'holder', now: () => now });
      const sleeps: number[] = [];
      let caught: unknown;
      try {
        acquireLease(db, {
          ...KEY,
          ttlMs: 1_000,
          waitMs: 1_000,
          now: () => now,
          sleep: (ms) => { sleeps.push(ms); now += ms; },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LeaseBusyError);
      expect((caught as LeaseBusyError).holder?.owner).toBe('holder');
      expect((caught as LeaseBusyError).message).toMatch(/automations\/state.*busy/);
      expect(sleeps.slice(0, 5)).toEqual([5, 10, 20, 40, 50]);
      expect(Math.max(...sleeps)).toBeLessThanOrEqual(50);
      expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(1_000);
      expect(readLease(db, KEY)?.owner).toBe('holder');
    });

    it('treats an external contention signal like a held lease and does not touch the table meanwhile', () => {
      let contended = true;
      const sleeps: number[] = [];
      let rowsSeenWhileContended = 0;
      const lease = acquireLease(db, {
        ...KEY,
        ttlMs: 1_000,
        isContended: () => {
          if (contended && readLease(db, KEY)) rowsSeenWhileContended += 1;
          return contended;
        },
        sleep: (ms) => {
          sleeps.push(ms);
          if (sleeps.length === 2) contended = false;
        },
      });
      expect(lease.owner).toMatch(/^pid-/);
      expect(rowsSeenWhileContended).toBe(0);
      expect(sleeps).toEqual([5, 10]);
    });

    it('gives up on external contention after the budget with a null holder', () => {
      let now = 0;
      let caught: unknown;
      try {
        acquireLease(db, {
          ...KEY,
          ttlMs: 1_000,
          waitMs: 100,
          now: () => now,
          isContended: () => true,
          sleep: (ms) => { now += ms; },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LeaseBusyError);
      expect((caught as LeaseBusyError).holder).toBeNull();
      expect(readLease(db, KEY)).toBeNull();
    });

    it('rejects a non-positive wait budget', () => {
      expect(() => acquireLease(db, { ...KEY, ttlMs: 1_000, waitMs: 0 })).toThrow(/waitMs/);
    });
  });
});
