import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mutateStudioAutomationState, readStudioAutomationState } from './store.js';

const LOCK = '.mindos/automations/state.lock';

describe('studio automation state lock', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-automation-lock-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('releases its own lock after a mutation', () => {
    mutateStudioAutomationState(root, (state) => { state.notifications = []; });
    expect(existsSync(join(root, LOCK))).toBe(false);
    expect(readStudioAutomationState(root)).toBeTruthy();
  });

  it('takes over a stale lock left by a dead writer', () => {
    mkdirSync(join(root, LOCK), { recursive: true });
    writeFileSync(join(root, LOCK, 'owner'), '999999\n0\nstale-token\n');
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(join(root, LOCK), old, old);

    expect(() => mutateStudioAutomationState(root, () => undefined)).not.toThrow();
    expect(existsSync(join(root, LOCK))).toBe(false);
  });

  it('never removes a fresh lock held by someone else', () => {
    mkdirSync(join(root, LOCK), { recursive: true });
    writeFileSync(join(root, LOCK, 'owner'), `${process.pid}\n${Date.now()}\nforeign-token\n`);

    expect(() => mutateStudioAutomationState(root, () => undefined)).toThrow(/busy/);
    expect(existsSync(join(root, LOCK))).toBe(true);
    expect(readFileSync(join(root, LOCK, 'owner'), 'utf-8')).toContain('foreign-token');
  });
});
