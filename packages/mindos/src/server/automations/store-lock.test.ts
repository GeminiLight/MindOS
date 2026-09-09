import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeAllMindosDatabases } from '../../foundation/storage/sqlite.js';
import {
  STATE_DB_RELATIVE_PATH,
  openStateDatabase,
  readLease,
  tryAcquireLease,
} from '../../foundation/storage/leases.js';
import {
  STUDIO_AUTOMATION_STATE_LEASE,
  mutateStudioAutomationState,
  readStudioAutomationState,
} from './store.js';

const LOCK = '.mindos/automations/state.lock';
const STATE = '.mindos/automations/state.json';

describe('studio automation state lease', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-automation-lock-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeAllMindosDatabases();
    rmSync(root, { recursive: true, force: true });
  });

  it('releases its own lease after a mutation and never creates a lock directory', () => {
    mutateStudioAutomationState(root, (state) => { state.notifications = []; });
    expect(existsSync(join(root, LOCK))).toBe(false);
    expect(existsSync(join(root, STATE_DB_RELATIVE_PATH))).toBe(true);
    expect(readLease(openStateDatabase(root), STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
    expect(readStudioAutomationState(root)).toBeTruthy();
  });

  it('holds the lease while the operation runs', () => {
    const db = openStateDatabase(root);
    let ownerDuringOperation: string | undefined;
    mutateStudioAutomationState(root, () => {
      ownerDuringOperation = readLease(db, STUDIO_AUTOMATION_STATE_LEASE)?.owner;
    });
    expect(ownerDuringOperation).toMatch(new RegExp(`^pid-${process.pid}-`));
    expect(readLease(db, STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
  });

  it('reports busy while another owner holds a fresh lease and leaves that lease untouched', () => {
    const db = openStateDatabase(root);
    const held = tryAcquireLease(db, { ...STUDIO_AUTOMATION_STATE_LEASE, ttlMs: 60_000, owner: 'foreign-owner' });
    expect(held.ok).toBe(true);
    const started = Date.now();

    expect(() => mutateStudioAutomationState(root, () => undefined)).toThrow(/busy/);

    expect(Date.now() - started).toBeGreaterThanOrEqual(800);
    expect(readLease(db, STUDIO_AUTOMATION_STATE_LEASE)).toMatchObject({ owner: 'foreign-owner' });
    expect(existsSync(join(root, STATE))).toBe(false);
  });

  it('takes over an expired lease left by a dead owner', () => {
    const db = openStateDatabase(root);
    const stale = tryAcquireLease(db, {
      ...STUDIO_AUTOMATION_STATE_LEASE,
      ttlMs: 1_000,
      owner: 'dead-owner',
      now: () => Date.now() - 120_000,
    });
    expect(stale.ok).toBe(true);

    expect(() => mutateStudioAutomationState(root, () => undefined)).not.toThrow();
    expect(readLease(db, STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
    expect(existsSync(join(root, STATE))).toBe(true);
  });

  it('releases the lease and writes nothing when the operation throws', () => {
    expect(() => mutateStudioAutomationState(root, () => { throw new Error('boom'); })).toThrow('boom');
    expect(readLease(openStateDatabase(root), STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
    expect(existsSync(join(root, STATE))).toBe(false);
  });

  it('applies back-to-back read-modify-write mutations without losing one', () => {
    for (let index = 0; index < 50; index += 1) {
      mutateStudioAutomationState(root, (state) => { state.migration.importedCount += 1; });
    }
    expect(readStudioAutomationState(root).migration.importedCount).toBe(50);
  });

  describe('legacy directory lock compatibility', () => {
    it('takes over a stale lock left by a dead writer, removes it and logs the removal once', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mkdirSync(join(root, LOCK), { recursive: true });
      writeFileSync(join(root, LOCK, 'owner'), '999999\n0\nstale-token\n');
      const old = (Date.now() - 120_000) / 1000;
      utimesSync(join(root, LOCK), old, old);

      expect(() => mutateStudioAutomationState(root, () => undefined)).not.toThrow();
      expect(existsSync(join(root, LOCK))).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('state.lock');

      mutateStudioAutomationState(root, () => undefined);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('never removes a fresh lock held by someone else', () => {
      mkdirSync(join(root, LOCK), { recursive: true });
      writeFileSync(join(root, LOCK, 'owner'), `${process.pid}\n${Date.now()}\nforeign-token\n`);

      expect(() => mutateStudioAutomationState(root, () => undefined)).toThrow(/busy/);
      expect(existsSync(join(root, LOCK))).toBe(true);
      expect(readFileSync(join(root, LOCK, 'owner'), 'utf-8')).toContain('foreign-token');
      expect(readLease(openStateDatabase(root), STUDIO_AUTOMATION_STATE_LEASE)).toBeNull();
    });

    it('sweeps graveyard directories the previous takeover could leave behind', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mkdirSync(join(root, `${LOCK}.stale-4242-abc`), { recursive: true });
      writeFileSync(join(root, `${LOCK}.stale-4242-abc`, 'owner'), 'leftover\n');

      mutateStudioAutomationState(root, () => undefined);
      expect(existsSync(join(root, `${LOCK}.stale-4242-abc`))).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
