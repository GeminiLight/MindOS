import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const sync = parse(readFileSync('.github/workflows/sync-to-mindos.yml', 'utf8'));

describe('manual isolated sync runner', () => {
  it('offers hosted execution by default and a bounded local alternative', () => {
    const input = sync.on.workflow_dispatch?.inputs?.runner;
    expect(input).toMatchObject({ type: 'choice', default: 'ubuntu-latest' });
    expect(input.options).toEqual(['ubuntu-latest', 'local-sync']);
    expect(sync.jobs.sync['timeout-minutes']).toBe(30);
  });

  it('reserves the isolated label for explicit manual selection', () => {
    expect(sync.jobs.sync['runs-on']).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.runner == 'local-sync' && 'mindos-sync-isolated' || 'ubuntu-latest' }}");
    expect(Object.keys(sync.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(sync.on.push.tags).toEqual(['v*.*.*', 'desktop-v*', 'clipper-v*']);
  });

  it('rejects manual dispatch on old branches or tags and serializes writes', () => {
    expect(sync.jobs.sync.if).toBe("github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'");
    expect(sync.concurrency).toEqual({ group: 'sync-to-mindos', 'cancel-in-progress': false });
    expect(sync.jobs.sync.steps[0].with['fetch-depth']).toBe(0);
  });
});
