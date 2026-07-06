import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PiHandler = () => Promise<void> | void;

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
  await handlers.get('session_shutdown')?.();
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
  it('registers schedule_prompt and executes a once prompt as a Pi follow-up', async () => {
    const mindosSchedulePrompt = await loadExtension();
    const harness = makePiHarness();

    await mindosSchedulePrompt(harness.pi as any);
    await harness.handlers.get('session_start')?.();

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
      { sessionManager: { getEntries: () => [] } },
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
    await harness.handlers.get('session_start')?.();

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
    await harness.handlers.get('session_start')?.();
    await shutdown(harness.handlers);

    expect(readStore(tempHome).jobs).toEqual([
      expect.objectContaining({
        id: 'studio-paused',
        enabled: false,
        mindos: expect.objectContaining({ source: 'mindos-studio-automation' }),
      }),
    ]);
  });
});
