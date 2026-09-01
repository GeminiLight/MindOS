import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PiHandler = (event: unknown, ctx: ReturnType<typeof makeExtensionContext>) => Promise<void> | void;

function makeExtensionContext(sessionId = 'mindos-test-session') {
  return {
    cwd: process.cwd(),
    sessionManager: {
      getEntries: () => [],
      getSessionId: () => sessionId,
    },
  };
}

function storePath(home: string): string {
  return path.join(home, '.mindos', 'schedule-prompts.json');
}

function readStore(home: string): { jobs: Array<Record<string, unknown>>; version: number } {
  return JSON.parse(fs.readFileSync(storePath(home), 'utf-8'));
}

function writeStore(home: string, jobs: Array<Record<string, unknown>>): void {
  const file = storePath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ jobs, version: 1 }, null, 2)}\n`, 'utf-8');
}

function makePiHarness() {
  const handlers = new Map<string, PiHandler>();
  let registeredTool: any;
  const pi = {
    registerTool: vi.fn((tool: unknown) => {
      registeredTool = tool;
    }),
    on: vi.fn((event: string, handler: PiHandler) => {
      handlers.set(event, handler);
    }),
    events: { emit: vi.fn() },
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
  };
  return {
    pi,
    handlers,
    get tool() {
      return registeredTool;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAssertion(assertion: () => void, timeoutMs = 4_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(50);
    }
  }
  if (lastError) throw lastError;
  assertion();
}

async function loadExtension() {
  vi.resetModules();
  const module = await import('../../lib/schedule-prompt/index');
  return module.default;
}

async function shutdown(handlers: Map<string, PiHandler>): Promise<void> {
  await handlers.get('session_shutdown')?.({}, makeExtensionContext());
}

let tempHome: string;
let previousHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-schedule-prompt-home-'));
  previousHome = process.env.HOME;
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = previousHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('MindOS schedule-prompt wrapper', () => {
  it('ignores scheduler-owned runtime status writes when deciding whether to reload', async () => {
    vi.resetModules();
    const { scheduleStoreFingerprint } = await import('../../lib/schedule-prompt/index');
    const scheduled = {
      jobs: [{
        id: 'long-model-job',
        name: 'Long model job',
        schedule: '+1s',
        prompt: 'Work for longer than the watcher debounce.',
        enabled: true,
        type: 'once',
        runCount: 0,
      }],
      version: 1,
    };
    const running = {
      ...scheduled,
      jobs: [{
        ...scheduled.jobs[0],
        lastStatus: 'running',
        lastRun: new Date().toISOString(),
        nextRun: new Date(Date.now() + 60_000).toISOString(),
        runCount: 1,
      }],
    };

    expect(scheduleStoreFingerprint(JSON.stringify(running))).toBe(
      scheduleStoreFingerprint(JSON.stringify(scheduled)),
    );
    expect(scheduleStoreFingerprint(JSON.stringify({
      ...scheduled,
      jobs: [{ ...scheduled.jobs[0], prompt: 'Externally edited prompt.' }],
    }))).not.toBe(scheduleStoreFingerprint(JSON.stringify(scheduled)));
  });

  it('does not stop a long once job when the scheduler disables it in storage', async () => {
    vi.resetModules();
    const { createMindosSchedulePromptExtension } = await import('../../lib/schedule-prompt/index');
    let schedulerStops = 0;
    let schedulerAdds = 0;

    class FakeStorage {
      storePath = '';
      piDir = '';
      jobs = [{ id: 'once-model', enabled: true }];
      save(): void {
        fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
        fs.writeFileSync(this.storePath, JSON.stringify({ jobs: this.jobs, version: 1 }));
      }
      getAllJobs() {
        if (!this.storePath || !fs.existsSync(this.storePath)) return this.jobs;
        return JSON.parse(fs.readFileSync(this.storePath, 'utf-8')).jobs;
      }
      updateJob(id: string, partial: Record<string, unknown>): void {
        this.jobs = this.jobs.map((job) => job.id === id ? { ...job, ...partial } : job);
        this.save();
      }
      removeJob(id: string): void {
        this.jobs = this.jobs.filter((job) => job.id !== id);
        this.save();
      }
    }

    class FakeScheduler {
      constructor(private storage: FakeStorage) {}
      start(): void {
        setTimeout(() => this.storage.updateJob('once-model', { enabled: false, lastStatus: 'running' }), 10);
      }
      addJob(): void { schedulerAdds += 1; }
      updateJob(): void {}
      removeJob(): void {}
      stop(): void { schedulerStops += 1; }
    }

    const extension = createMindosSchedulePromptExtension(async () => ({
      CronStorage: FakeStorage,
      CronScheduler: FakeScheduler,
      createCronTool: () => ({}),
    }) as any);
    const harness = makePiHarness();
    await extension(harness.pi as any);
    await harness.handlers.get('session_start')?.({ reason: 'startup' }, makeExtensionContext());

    await sleep(100);
    writeStore(tempHome, [
      { id: 'once-model', enabled: false, lastStatus: 'running' },
      { id: 'external-job', enabled: true, type: 'once', schedule: new Date(Date.now() + 5_000).toISOString() },
    ]);
    await sleep(600);
    expect(schedulerStops).toBe(0);
    expect(schedulerAdds).toBe(1);

    await shutdown(harness.handlers);
    expect(schedulerStops).toBe(1);
  });

  it('registers schedule_prompt and executes a once prompt as a Pi follow-up', async () => {
    const mindosSchedulePrompt = await loadExtension();
    const harness = makePiHarness();

    await mindosSchedulePrompt(harness.pi as any);
    await harness.handlers.get('session_start')?.({ reason: 'startup' }, makeExtensionContext());

    const result = await harness.tool.execute(
      'tool-call-1',
      {
        action: 'add',
        type: 'once',
        name: 'runtime-proof',
        schedule: '+1s',
        prompt: 'Run the schedule wrapper proof.',
      },
      undefined,
      undefined,
      makeExtensionContext(),
    );

    expect(result.details).toMatchObject({ action: 'add', jobName: 'runtime-proof' });
    expect(readStore(tempHome).jobs[0]).toMatchObject({
      name: 'runtime-proof',
      prompt: 'Run the schedule wrapper proof.',
      enabled: true,
      type: 'once',
    });

    await waitForAssertion(() => {
      expect(harness.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        customType: 'scheduled_prompt',
        details: expect.objectContaining({ jobName: 'runtime-proof' }),
      }));
      expect(harness.pi.sendUserMessage).toHaveBeenCalledWith(
        'Run the schedule wrapper proof.',
        { deliverAs: 'followUp' },
      );
    });

    await shutdown(harness.handlers);
  });

  it('reloads the running scheduler when the schedule store is changed externally', async () => {
    const mindosSchedulePrompt = await loadExtension();
    const harness = makePiHarness();

    await mindosSchedulePrompt(harness.pi as any);
    await harness.handlers.get('session_start')?.({ reason: 'startup' }, makeExtensionContext());

    writeStore(tempHome, [{
      id: 'external-file-job',
      name: 'External file job',
      schedule: new Date(Date.now() + 3_000).toISOString(),
      prompt: 'Run the externally written prompt.',
      enabled: true,
      type: 'once',
      createdAt: new Date().toISOString(),
      runCount: 0,
    }]);

    await waitForAssertion(() => {
      expect(harness.pi.sendUserMessage).toHaveBeenCalledWith(
        'Run the externally written prompt.',
        { deliverAs: 'followUp' },
      );
    }, 8_000);

    await shutdown(harness.handlers);
  });

  it('reinitializes a session without duplicating scheduled prompt timers', async () => {
    writeStore(tempHome, [{
      id: 'single-timer',
      name: 'Single timer',
      schedule: '+1s',
      prompt: 'Run exactly once.',
      enabled: true,
      type: 'interval',
      intervalMs: 1_000,
      session: 'mindos-test-session',
      createdAt: new Date().toISOString(),
      runCount: 0,
    }]);
    const mindosSchedulePrompt = await loadExtension();
    const harness = makePiHarness();
    const context = makeExtensionContext();

    await mindosSchedulePrompt(harness.pi as any);
    await harness.handlers.get('session_start')?.({ reason: 'startup' }, context);
    await harness.handlers.get('session_start')?.({ reason: 'resume' }, context);

    await waitForAssertion(() => {
      expect(harness.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    });
    await sleep(250);
    expect(harness.pi.sendUserMessage).toHaveBeenCalledTimes(1);

    await shutdown(harness.handlers);
  });

  it('keeps paused Studio automations while cleaning up other disabled jobs on shutdown', async () => {
    writeStore(tempHome, [
      {
        id: 'disabled-external',
        name: 'Disabled external',
        schedule: '0 0 9 * * *',
        prompt: 'Remove me',
        enabled: false,
        type: 'cron',
        createdAt: new Date().toISOString(),
        runCount: 0,
      },
      {
        id: 'studio-paused',
        name: 'Paused Studio automation',
        schedule: '0 0 9 * * *',
        prompt: 'Keep me',
        enabled: false,
        type: 'cron',
        createdAt: new Date().toISOString(),
        runCount: 0,
        mindos: {
          schemaVersion: 1,
          source: 'mindos-studio-automation',
          scope: 'worktree',
          studioSchedule: 'daily-0900',
          model: 'mindos-auto',
          effort: 'high',
          controlPlaneScheduleId: 'studio-automation-paused',
        },
      },
    ]);

    const mindosSchedulePrompt = await loadExtension();
    const harness = makePiHarness();

    await mindosSchedulePrompt(harness.pi as any);
    await harness.handlers.get('session_start')?.({ reason: 'startup' }, makeExtensionContext());
    await shutdown(harness.handlers);

    expect(readStore(tempHome).jobs).toEqual([
      expect.objectContaining({
        id: 'studio-paused',
        enabled: false,
        mindos: expect.objectContaining({ source: 'mindos-studio-automation' }),
      }),
    ]);
  });

  it('preserves disabled jobs owned by another session during cleanup', async () => {
    writeStore(tempHome, [
      {
        id: 'current-session-disabled',
        name: 'Current session disabled',
        schedule: '0 0 9 * * *',
        prompt: 'Remove me',
        enabled: false,
        type: 'cron',
        session: 'mindos-test-session',
        createdAt: new Date().toISOString(),
        runCount: 0,
      },
      {
        id: 'foreign-session-disabled',
        name: 'Foreign session disabled',
        schedule: '0 0 9 * * *',
        prompt: 'Keep me',
        enabled: false,
        type: 'cron',
        session: 'another-session',
        createdAt: new Date().toISOString(),
        runCount: 0,
      },
    ]);
    const mindosSchedulePrompt = await loadExtension();
    const harness = makePiHarness();

    await mindosSchedulePrompt(harness.pi as any);
    await harness.handlers.get('session_start')?.({ reason: 'startup' }, makeExtensionContext());
    await shutdown(harness.handlers);

    expect(readStore(tempHome).jobs).toEqual([
      expect.objectContaining({ id: 'foreign-session-disabled', session: 'another-session' }),
    ]);
  });
});
