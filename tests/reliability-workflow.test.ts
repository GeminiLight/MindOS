import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The reliability workflow was authored on `codex/reliability-ci-followup-302` but
 * could not be pushed at the time: GitHub rejects a push that adds
 * `.github/workflows/*` when the credential lacks the `workflow` scope. It lived as
 * a template under `wiki/refs/` until the scope was granted (2026-09-11), and is now
 * installed.
 *
 * Two contracts are kept here:
 *   1. The installed workflow keeps the properties that make it safe and useful.
 *   2. A template under `wiki/refs/` only exists while its target is *not* installed,
 *      so the two copies can never drift apart.
 */
const INSTALLED = resolve('.github/workflows/test-reliability.yml');
const WORKFLOWS_DIR = resolve('.github/workflows');
const REFS_DIR = resolve('wiki/refs');

describe('reliability regression workflow', () => {
  it('is installed under .github/workflows', () => {
    expect(existsSync(INSTALLED)).toBe(true);
  });

  it('runs the baseline on all desktop OS families without deployment credentials', () => {
    const source = readFileSync(INSTALLED, 'utf8');
    expect(source).toContain('pull_request:');
    expect(source).toContain('os: [ubuntu-latest, macos-latest, windows-latest]');
    expect(source).toContain("node-version: '22.19.0'");
    expect(source).toContain('contents: read');
    expect(source).not.toMatch(/pull_request_target|secrets\./);
  });

  it('includes ownership, recovery, mobile persistence and Web boundary regressions', () => {
    const source = readFileSync(INSTALLED, 'utf8');
    for (const entry of [
      'src/server/connections', 'src/agent/capsules',
      'pnpm --filter @mindos/mobile test',
      '__tests__/components/agent-run-observatory.test.tsx',
      '__tests__/agent/active-recall-receipt.test.ts',
    ]) expect(source, entry).toContain(entry);
  });
});

describe('workflow templates under wiki/refs', () => {
  const templates = existsSync(REFS_DIR)
    ? readdirSync(REFS_DIR).filter((name) => name.endsWith('.workflow.yml'))
    : [];

  it('name their install target and the reason they are not installed', () => {
    for (const name of templates) {
      const source = readFileSync(resolve(REFS_DIR, name), 'utf8');
      const target = name.replace(/\.workflow\.yml$/, '.yml');
      expect(source, name).toContain(`copy to .github/workflows/${target}`);
      expect(source, name).toContain('`workflow` scope');
      // A template must still be a workflow: it declares a name and at least one job.
      expect(source, name).toMatch(/^name: /m);
      expect(source, name).toMatch(/^jobs:$/m);
    }
  });

  it('are removed once their target is installed, so the two copies cannot drift', () => {
    for (const name of templates) {
      const target = name.replace(/\.workflow\.yml$/, '.yml');
      expect(existsSync(resolve(WORKFLOWS_DIR, target)), `${name} is stale: ${target} is already installed`).toBe(false);
    }
  });
});
