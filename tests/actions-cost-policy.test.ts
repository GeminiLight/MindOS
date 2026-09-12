import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const workflow = (name: string) => parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

describe('Actions cost controls', () => {
  it('only scans the Obsidian corpus when explicitly dispatched', () => {
    const config = workflow('obsidian-corpus-nightly');
    expect(Object.keys(config.on)).toEqual(['workflow_dispatch']);
    expect(config.on.workflow_dispatch.inputs.top.default).toBe('200');
    expect(config.jobs.corpus['timeout-minutes']).toBeLessThanOrEqual(45);
  });

  it('cancels obsolete PR checks and bounds stalled jobs', () => {
    const config = workflow('test-reliability');
    expect(config.concurrency.group).toContain('github.event.pull_request.number');
    expect(config.concurrency['cancel-in-progress']).toBe(true);
    expect(config.jobs.regression['timeout-minutes']).toBe(30);
    expect(config.permissions).toEqual({ contents: 'read' });
    expect(config.on.pull_request).toBeNull();
  });

  it('installs and builds once per OS with one Linux typecheck per app', () => {
    const job = workflow('test-reliability').jobs.regression;
    expect(job.strategy.matrix).toContain('fromJSON(needs.plan.outputs.matrix)');
    const steps = job.steps as { run?: string; if?: string }[];
    expect(steps.filter((s) => s.run?.includes('pnpm install'))).toHaveLength(1);
    expect(steps.filter((s) => s.run?.includes('@geminilight/mindos run build'))).toHaveLength(1);
    const typechecks = steps.filter((s) => s.run?.includes('typecheck'));
    expect(typechecks).toHaveLength(2);
    for (const step of typechecks) expect(step.if).toContain("matrix.os == 'ubuntu-latest'");
    const tests = steps.filter((s) => /vitest run|@mindos\/mobile test/.test(s.run ?? ''));
    expect(tests).toHaveLength(4);
    for (const step of tests) {
      expect(step.if).toMatch(/^needs.plan.outputs.(channel|reliability) == 'true'$/);
      expect(step.if).not.toContain('matrix.os');
    }
  });

  it('cancels outdated Tauri PR verification without interrupting manual packaging', () => {
    const config = workflow('build-tauri-desktop');
    expect(config.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
    expect(config.jobs.verify['timeout-minutes']).toBe(30);
  });

  it('preserves serialized public sync and release triggers', () => {
    const sync = workflow('sync-to-mindos');
    expect(sync.concurrency['cancel-in-progress']).toBe(false);
    expect(sync.on.push.branches).toContain('main');
    expect(sync.on.push.tags.length).toBeGreaterThan(0);
  });
});
