import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { planChecks, changedFiles } from '../scripts/ci/change-plan.mjs';

describe('PR regression selection', () => {
  it('does not allocate test runners for documentation and website changes', () => {
    expect(planChecks(['README_zh.md', 'wiki/notes.md', 'landing/index.html']).required).toBe(false);
  });
  it('shares the matrix when both runtime boundaries changed', () => {
    const plan = planChecks(['packages/web/lib/im/config.ts', 'packages/mobile/app/index.tsx']);
    expect(plan).toMatchObject({ channel: true, reliability: true, required: true });
    expect(plan.matrix.os).toHaveLength(3);
  });
  it('runs channel changes without unrelated mobile regressions', () => {
    expect(planChecks(['packages/web/lib/im/adapters/qq.ts'])).toMatchObject({ channel: true, reliability: false });
  });
  it('runs mobile changes without unrelated channel regressions', () => {
    expect(planChecks(['packages/mobile/lib/storage.ts'])).toMatchObject({ channel: false, reliability: true });
  });
  it.each(['pnpm-lock.yaml', 'packages/mindos/src/index.ts', 'packages/web/lib/new-module.ts', 'unknown/runtime.conf'])(
    'conservatively checks both boundaries for %s', (file) => {
      expect(planChecks([file])).toMatchObject({ channel: true, reliability: true });
    },
  );
  it('keeps desktop-specific work in its dedicated workflow', () => {
    expect(planChecks(['packages/desktop/src/main.ts', 'packages/desktop-tauri/src-tauri/main.rs']).required).toBe(false);
  });
  it('checks workflow policy changes on Linux without a full runtime matrix', () => {
    expect(planChecks(['tests/ci-change-plan.test.ts', 'scripts/ci/change-plan.mjs'])).toMatchObject({
      channel: false, reliability: false, contracts: true, matrix: { os: ['ubuntu-latest'] },
    });
  });
  it.each([null, undefined, [], [''], [7], ['../outside'], ['/absolute']])(
    'falls back to all regressions when the change list cannot be trusted: %j', (input) => {
      expect(planChecks(input)).toMatchObject({ channel: true, reliability: true, contracts: true });
    },
  );
  it('handles Unicode, spaces and repeated paths without interpreting them as commands', () => {
    expect(planChecks(['docs/中文 空格.md', 'docs/中文 空格.md']).required).toBe(false);
    expect(planChecks(['packages/mobile/$(touch nope).ts']).reliability).toBe(true);
  });
  it('selects all checks for manual runs', () => {
    expect(planChecks(['README.md'], true)).toMatchObject({ channel: true, reliability: true, contracts: true });
  });
  it('falls back on missing or invalid Git revisions', () => {
    expect(changedFiles({ base: 'bad; ref', head: 'HEAD' })).toBeNull();
    expect(changedFiles({ base: '0'.repeat(40), head: '1'.repeat(40) })).toBeNull();
  });
  it('includes both sides of renames and deleted files, including embedded newlines', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mindos-ci-plan-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    try {
      git('init', '--quiet'); git('config', 'user.name', 'CI Test'); git('config', 'user.email', 'ci@example.invalid');
      writeFileSync(join(cwd, 'old.ts'), 'content'); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      git('mv', 'old.ts', 'new\nname.ts'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qam', 'rename');
      expect(changedFiles({ base, head: git('rev-parse', 'HEAD'), cwd })).toEqual(expect.arrayContaining(['old.ts', 'new\nname.ts']));
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
