import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The reliability workflow was authored on `codex/reliability-ci-followup-302` but
 * could not be pushed: GitHub rejects a push that adds `.github/workflows/*` when
 * the credential lacks the `workflow` scope. It therefore lives as a template under
 * `wiki/refs/` until someone installs it with an authorized credential.
 *
 * These assertions hold in both states: they validate the template, and the
 * installed copy too once it exists, so installation cannot silently drift.
 */
const TEMPLATE = resolve('wiki/refs/test-reliability.workflow.yml');
const INSTALLED = resolve('.github/workflows/test-reliability.yml');
const REFS_DIR = resolve('wiki/refs');

function reliabilitySources(): Array<{ label: string; source: string }> {
  const sources = [{ label: 'template', source: readFileSync(TEMPLATE, 'utf8') }];
  if (existsSync(INSTALLED)) sources.push({ label: 'installed', source: readFileSync(INSTALLED, 'utf8') });
  return sources;
}

describe('reliability regression workflow', () => {
  it('is available as a template, and as an installed workflow once authorized', () => {
    expect(existsSync(TEMPLATE)).toBe(true);
    const template = readFileSync(TEMPLATE, 'utf8');
    expect(template).toContain('copy to .github/workflows/test-reliability.yml');
    expect(template).toContain('`workflow` scope');
  });

  it('runs the baseline on all desktop OS families without deployment credentials', () => {
    for (const { label, source } of reliabilitySources()) {
      expect(source, label).toContain('pull_request:');
      expect(source, label).toContain('os: [ubuntu-latest, macos-latest, windows-latest]');
      expect(source, label).toContain("node-version: '22.19.0'");
      expect(source, label).toContain('contents: read');
      expect(source, label).not.toMatch(/pull_request_target|secrets\./);
    }
  });

  it('includes ownership, recovery, mobile persistence and Web boundary regressions', () => {
    for (const { label, source } of reliabilitySources()) {
      for (const entry of [
        'src/server/connections', 'src/agent/capsules',
        'pnpm --filter @mindos/mobile test',
        '__tests__/components/agent-run-observatory.test.tsx',
        '__tests__/agent/active-recall-receipt.test.ts',
      ]) expect(source, `${label}: ${entry}`).toContain(entry);
    }
  });
});

describe('pending workflow templates', () => {
  it('name their install target and the reason they are not installed', () => {
    const templates = readdirSync(REFS_DIR).filter((name) => name.endsWith('.workflow.yml'));
    expect(templates.length).toBeGreaterThan(0);
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
});
