import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleMonitoringGet,
  resetMonitoringStatsCacheForTests,
  type MonitoringPayload,
} from './monitoring.js';

let root: string;

function metricsSnapshot() {
  return {
    processStartTime: Date.now() - 1000,
    agentRequests: 0,
    toolExecutions: 0,
    totalTokens: { input: 0, output: 0 },
    avgResponseTimeMs: 0,
    errors: 0,
  };
}

function getPayload(services: Parameters<typeof handleMonitoringGet>[0]): MonitoringPayload {
  const res = handleMonitoringGet(services);
  const body = res.body as unknown;
  return (typeof body === 'string' ? JSON.parse(body) : body) as MonitoringPayload;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mindos-monitoring-'));
  resetMonitoringStatsCacheForTests();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('handleMonitoringGet knowledge base stats', () => {
  it('counts files and sizes recursively, skipping ignored dirs', () => {
    writeFileSync(join(root, 'a.md'), 'hello');
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'b.md'), 'world!');
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'ignored.md'), 'x'.repeat(100));

    const payload = getPayload({ mindRoot: root, metricsSnapshot });
    expect(payload.knowledgeBase.fileCount).toBe(2);
    expect(payload.knowledgeBase.totalSizeBytes).toBe(5 + 6);
  });

  it('reuses cached stats while the tree version is unchanged', () => {
    writeFileSync(join(root, 'a.md'), 'hello');
    const services = { mindRoot: root, metricsSnapshot, getTreeVersion: () => 1 };

    expect(getPayload(services).knowledgeBase.fileCount).toBe(1);
    // The file system changed but the version did not → stale cached stats served,
    // proving no walk happened on the second request.
    writeFileSync(join(root, 'b.md'), 'world');
    expect(getPayload(services).knowledgeBase.fileCount).toBe(1);
  });

  it('rebuilds stats when the tree version changes', () => {
    writeFileSync(join(root, 'a.md'), 'hello');
    let version = 1;
    const services = { mindRoot: root, metricsSnapshot, getTreeVersion: () => version };

    expect(getPayload(services).knowledgeBase.fileCount).toBe(1);
    writeFileSync(join(root, 'b.md'), 'world');
    version = 2;
    expect(getPayload(services).knowledgeBase.fileCount).toBe(2);
  });

  it('falls back to a short TTL when no tree version source is provided', () => {
    vi.useFakeTimers();
    writeFileSync(join(root, 'a.md'), 'hello');
    const services = { mindRoot: root, metricsSnapshot };

    expect(getPayload(services).knowledgeBase.fileCount).toBe(1);
    writeFileSync(join(root, 'b.md'), 'world');
    // Within the TTL the cached value is served.
    expect(getPayload(services).knowledgeBase.fileCount).toBe(1);
    vi.advanceTimersByTime(31_000);
    expect(getPayload(services).knowledgeBase.fileCount).toBe(2);
  });

  it('does not leak stats across different roots', () => {
    writeFileSync(join(root, 'a.md'), 'hello');
    const otherRoot = mkdtempSync(join(tmpdir(), 'mindos-monitoring-other-'));
    try {
      writeFileSync(join(otherRoot, 'a.md'), 'x');
      writeFileSync(join(otherRoot, 'b.md'), 'y');

      expect(
        getPayload({ mindRoot: root, metricsSnapshot, getTreeVersion: () => 1 }).knowledgeBase.fileCount,
      ).toBe(1);
      expect(
        getPayload({ mindRoot: otherRoot, metricsSnapshot, getTreeVersion: () => 1 }).knowledgeBase.fileCount,
      ).toBe(2);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('returns zero stats for a missing root', () => {
    const payload = getPayload({
      mindRoot: join(root, 'does-not-exist'),
      metricsSnapshot,
    });
    expect(payload.knowledgeBase.fileCount).toBe(0);
    expect(payload.knowledgeBase.totalSizeBytes).toBe(0);
  });
});
