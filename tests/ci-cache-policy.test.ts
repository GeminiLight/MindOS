import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
const read = (path: string) => parse(readFileSync(path, 'utf8'));
const workflow = (name: string) => read(`.github/workflows/${name}.yml`);

describe('CI dependency cache ownership', () => {
  it('restores an exact cache without ever writing one from the shared setup action', () => {
    const action = read('scripts/ci/setup/action.yml');
    const steps = action.runs.steps;
    expect(action.inputs['lookup-only'].default).toBe('false');
    expect(steps.some((s: any) => s.uses === 'actions/cache/restore@v4')).toBe(true);
    expect(steps.some((s: any) => s.uses?.startsWith('actions/cache/save'))).toBe(false);
    const node = steps.find((s: any) => s.uses?.startsWith('actions/setup-node@'));
    expect(node.with.cache).toBeUndefined();
    const restore = steps.find((s: any) => s.uses === 'actions/cache/restore@v4');
    expect(restore.with['fail-on-cache-miss']).not.toBe(true);
    expect(restore['continue-on-error']).toBe(true);
    expect(restore.env.SEGMENT_DOWNLOAD_TIMEOUT_MINS).toBe('1');
    // Runner's composite-action schema does not support step timeout-minutes.
    for (const step of steps) expect(step['timeout-minutes']).toBeUndefined();
    expect(restore.with.key).toContain('runner.os');
    expect(restore.with.key).toContain('runner.arch');
    expect(restore.with.key).toContain('node22.19.0-pnpm10.18.3');
    expect(restore.with.key).toContain("hashFiles('pnpm-lock.yaml', 'pnpm-workspace.yaml')");
    expect(restore.with['restore-keys']).toBeUndefined();
    expect(restore.with['lookup-only']).toBe("${{ inputs.lookup-only == 'true' }}");
  });
  it('allows one serialized writer on main only, triggered by dependency changes', () => {
    const w = workflow('cache-ci-dependencies');
    expect(Object.keys(w.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(w.on.push.branches).toEqual(['main']);
    expect(w.on.push.paths).toContain('pnpm-lock.yaml');
    expect(w.concurrency['cancel-in-progress']).toBe(false);
    expect(w.jobs.warm.if).toBe("github.ref == 'refs/heads/main'");
    expect(w.jobs.warm.steps.find((s: any) => s.uses === './scripts/ci/setup').with['lookup-only']).toBe('true');
    const save = w.jobs.warm.steps.find((s: any) => s.uses === 'actions/cache/save@v4');
    expect(save.if).toContain("steps.setup.outputs.cache-hit != 'true'");
    expect(save['timeout-minutes']).toBeLessThanOrEqual(3);
    expect(save['continue-on-error']).toBe(true);
    const install = w.jobs.warm.steps.find((s: any) => s.run?.includes('pnpm install'));
    expect(install.if).toContain("steps.setup.outputs.cache-hit != 'true'");
  });
  it.each(['test-reliability', 'test-desktop-install', 'build-tauri-desktop'])(
    '%s installs even after a cache miss and has no implicit pnpm cache save', (name) => {
      const w = workflow(name);
      for (const job of Object.values(w.jobs) as any[]) {
        if (!job.steps?.some((s: any) => s.run?.includes('pnpm install'))) continue;
        expect(job.steps.find((s: any) => s.uses === './scripts/ci/setup')['timeout-minutes']).toBe(5);
        expect(job.steps.some((s: any) => s.uses?.startsWith('actions/setup-node') && s.with?.cache)).toBe(false);
        for (const step of job.steps.filter((s: any) => s.run?.includes('pnpm install'))) {
          expect(step.run).toContain('--frozen-lockfile');
          expect(step.if ?? '').not.toContain('cache-hit');
        }
      }
    },
  );
  it('preserves the inexpensive Rust cache to avoid repeated cold compilation', () => {
    const steps = workflow('build-tauri-desktop').jobs.verify.steps;
    expect(steps.find((s: any) => s.uses === 'Swatinem/rust-cache@v2').with['save-if'])
      .toBeUndefined();
  });
  it('ships every local action required by public workflows through existing script sync', () => {
    const sync = readFileSync('.github/workflows/sync-to-mindos.yml', 'utf8');
    expect(sync).toContain('cancel-in-progress: false');
    expect(read('.syncinclude').directories).toContain('scripts');
    for (const name of readdirSync('.github/workflows')) {
      const w = read(`.github/workflows/${name}`);
      for (const job of Object.values(w.jobs) as any[]) {
        for (const step of job.steps ?? []) {
          if (step.uses?.startsWith('./scripts/')) expect(existsSync(`${step.uses}/action.yml`)).toBe(true);
        }
      }
    }
  });
});
