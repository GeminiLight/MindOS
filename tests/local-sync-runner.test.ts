import { privateCheckout } from './helpers/private-checkout';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

describe.skipIf(!privateCheckout)('manual isolated sync runner', () => {
  // Vitest still collects skipped suites. Read the private workflow in the tests.
  const readSync = () => parse(readFileSync('.github/workflows/sync-to-mindos.yml', 'utf8'));
  it('offers hosted execution by default and a bounded local alternative', () => {
    const sync = readSync();
    const input = sync.on.workflow_dispatch?.inputs?.runner;
    expect(input).toMatchObject({ type: 'choice', default: 'ubuntu-latest' });
    expect(input.options).toEqual(['ubuntu-latest', 'local-sync']);
    expect(sync.jobs.sync['timeout-minutes']).toBe(30);
  });

  it('reserves the isolated label for explicit manual selection', () => {
    const sync = readSync();
    expect(sync.jobs.sync['runs-on']).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.runner == 'local-sync' && 'mindos-sync-isolated' || 'ubuntu-latest' }}");
    expect(Object.keys(sync.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(sync.on.push.tags).toEqual(['v*.*.*', 'desktop-v*', 'clipper-v*']);
  });

  it('rejects manual dispatch on old branches or tags and serializes writes', () => {
    const sync = readSync();
    expect(sync.jobs.sync.if).toBe("github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'");
    expect(sync.concurrency).toEqual({ group: 'sync-to-mindos', 'cancel-in-progress': false });
    expect(sync.jobs.sync.steps[0].with['fetch-depth']).toBe(0);
  });
});

describe.skipIf(!privateCheckout)('local sync runner kit', () => {
  // The kit lives under .github/ but outside workflows/, so it is never copied
  // to the public mirror — and it must stay that way: .syncinclude blocks any
  // file named Dockerfile, which would fail the sync's leak check.
  const kit = (f: string) => readFileSync(`.github/local-sync-runner/${f}`, 'utf8');

  it('verifies the official runner package before running anything from it', () => {
    const dockerfile = kit('Dockerfile');
    expect(dockerfile).toMatch(/ARG RUNNER_SHA256=[0-9a-f]{64}/);
    expect(dockerfile).toContain('sha256sum -c -');
    expect(dockerfile.indexOf('sha256sum -c -')).toBeLessThan(dockerfile.indexOf('installdependencies.sh'));
    expect(dockerfile).toContain('USER runner');
  });

  it('registers one ephemeral runner with only the dedicated label', () => {
    const entry = kit('entrypoint.sh');
    expect(entry).toContain('--ephemeral');
    expect(entry).toContain('--labels mindos-sync-isolated --no-default-labels');
    // Token on stdin, never in argv or the environment.
    expect(entry).toContain('IFS= read -r TOKEN');
    expect(entry).toContain('unset TOKEN');
  });

  it('runs the container isolated and leaves nothing behind', () => {
    const run = kit('run.sh');
    for (const flag of ['--rm', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=', '--memory=', '--cpus=']) {
      expect(run, flag).toContain(flag);
    }
    expect(run).not.toMatch(/docker run[^\n]*\s-v\s/);
    expect(run).not.toContain('docker.sock');
    expect(run).toContain('cleanup_registration');
    expect(run).toContain('-f runner=local-sync');
    // The script refuses to report success it did not observe.
    expect(run).toContain('[ "$CONCLUSION" = success ]');
  });

  it('is never published', () => {
    const syncinclude = readFileSync('.syncinclude', 'utf8');
    expect(syncinclude).not.toMatch(/^\s*-\s*\.github\s*$/m);
    const workflow = readFileSync('.github/workflows/sync-to-mindos.yml', 'utf8');
    expect(workflow).toContain('for wf in .github/workflows/*.yml; do');
  });
});
