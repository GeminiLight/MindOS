import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStudioAutomationsPost } from '../handlers/studio-automations.js';
import {
  readStudioAutomationWorkerHeartbeat,
  runStudioAutomationWorkerOnce,
  runStudioAutomationWorkerService,
} from './service.js';

describe('standalone Studio automation worker service', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('runs a tick without importing or starting the Web host', async () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-service-'));
    roots.push(mindRoot);
    const tick = vi.fn(async () => ({ recovered: 0, claimed: 0, completed: 0, succeeded: 0, failed: 0, timedOut: 0, retried: 0, waitingApproval: 0 }));
    const result = await runStudioAutomationWorkerOnce({ mindRoot, executor: vi.fn(), tick, ownerId: 'test-worker' });
    expect(result).toMatchObject({ claimed: 0 });
    expect(tick).toHaveBeenCalledWith(expect.objectContaining({ mindRoot, ownerId: 'test-worker' }));
    expect(existsSync(join(mindRoot, '.mindos/automations/worker.json'))).toBe(true);
    expect(readStudioAutomationWorkerHeartbeat(mindRoot)).toMatchObject({ ownerId: 'test-worker', status: 'idle' });
    expect(readFileSync(join(mindRoot, '.mindos/automations/worker.json'), 'utf-8')).not.toContain('Web');
  });

  it('prevents overlapping ticks and stops cleanly through AbortSignal', async () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-loop-'));
    roots.push(mindRoot);
    const controller = new AbortController();
    let active = 0;
    let maxActive = 0;
    const tick = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      if (tick.mock.calls.length === 2) controller.abort();
      return { recovered: 0, claimed: 0, completed: 0, succeeded: 0, failed: 0, timedOut: 0, retried: 0, waitingApproval: 0 };
    });

    await runStudioAutomationWorkerService({
      mindRoot,
      executor: vi.fn(),
      tick,
      ownerId: 'loop-worker',
      intervalMs: 1,
      signal: controller.signal,
    });

    expect(tick).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    expect(readStudioAutomationWorkerHeartbeat(mindRoot)).toMatchObject({ ownerId: 'loop-worker', status: 'stopped' });
  });

  it('claims and completes a durable job without a Web or Desktop process', async () => {
    const mindRoot = mkdtempSync(join(tmpdir(), 'mindos-automation-once-'));
    roots.push(mindRoot);
    const now = new Date('2000-01-01T00:00:00.000Z');
    const created = handleStudioAutomationsPost({
      action: 'create',
      draft: {
        title: 'Standalone once', prompt: 'Summarize the queue.', scope: 'mind', schedule: 'manual',
        model: 'mindos-auto', effort: 'normal', permissionMode: 'read', retry: 'never',
      },
    }, { mindRoot, now: () => now });
    const jobId = 'automations' in created.body ? created.body.automations[0]!.id : '';
    handleStudioAutomationsPost({ action: 'run-now', id: jobId }, { mindRoot, now: () => now });

    const executor = vi.fn(async () => ({ text: 'Standalone result', toolCalls: [] }));
    await expect(runStudioAutomationWorkerOnce({ mindRoot, executor, ownerId: 'once-worker' }))
      .resolves.toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ id: jobId }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
