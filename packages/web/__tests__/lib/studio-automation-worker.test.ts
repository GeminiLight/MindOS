import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tick: vi.fn(),
  runHeadlessAgent: vi.fn(),
}));

vi.mock('@geminilight/mindos/server', () => ({
  tickStudioAutomationWorker: mocks.tick,
}));

vi.mock('@/lib/agent/headless', () => ({
  runHeadlessAgent: mocks.runHeadlessAgent,
}));

vi.mock('@/lib/fs', () => ({
  getMindRoot: () => '/tmp/mindos-worker-test',
}));

const job = {
  id: 'studio-research-radar',
  title: 'Research radar',
  prompt: 'Build today\'s research radar.',
  scope: 'mind',
  schedule: 'daily-0900',
  timezone: 'Asia/Shanghai',
  model: 'gpt-5.5',
  effort: 'extra-high',
  permissionMode: 'auto',
  status: 'active',
  retry: 'once',
  timeoutMs: 600_000,
  overlap: 'skip',
  runtime: 'mindos-pi',
  source: 'mindos-durable',
  controlPlaneScheduleId: 'studio-automation-research-radar',
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  runCount: 0,
  lastStatus: 'pending',
  history: [],
} as const;

describe('Studio automation Web worker bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runHeadlessAgent.mockResolvedValue({ text: 'done', thinking: '', toolCalls: [] });
    mocks.tick.mockImplementation(async (options) => {
      const controller = new AbortController();
      await options.executor(job, { runId: 'run-1', attempt: 1, signal: controller.signal });
      return { recovered: 0, claimed: 1, completed: 1, succeeded: 1, failed: 0, timedOut: 0, retried: 0 };
    });
  });

  it('maps durable job policy into a cancellable headless Pi run', async () => {
    const { runStudioAutomationWorkerTick } = await import('@/lib/studio-automation-worker');
    await runStudioAutomationWorkerTick({ mindRoot: '/tmp/explicit-mind' });

    expect(mocks.tick).toHaveBeenCalledWith(expect.objectContaining({
      mindRoot: '/tmp/explicit-mind',
      ownerId: `web-${process.pid}`,
      executor: expect.any(Function),
    }));
    expect(mocks.runHeadlessAgent).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: job.prompt,
      permissionMode: 'auto',
      maxSteps: 80,
      modelOverride: 'gpt-5.5',
      workDir: '/tmp/mindos-worker-test',
      entrypoint: 'schedule',
      automationId: job.id,
      runId: 'run-1',
      signal: expect.any(AbortSignal),
    }));
  });
});
