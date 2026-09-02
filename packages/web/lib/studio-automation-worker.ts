import {
  tickStudioAutomationWorker,
  type StudioAutomationJob,
} from '@geminilight/mindos/server';
import { getMindRoot } from '@/lib/fs';

const TICK_INTERVAL_MS = 15_000;
const globalState = globalThis as typeof globalThis & {
  __mindosStudioAutomationWorker?: { timer: ReturnType<typeof setInterval>; running: boolean };
};

export async function runStudioAutomationWorkerTick({ mindRoot = getMindRoot() }: { mindRoot?: string } = {}) {
  return tickStudioAutomationWorker({
    mindRoot,
    ownerId: `web-${process.pid}`,
    executor: executeAutomation,
  });
}

export function startStudioAutomationWorker(): void {
  if (globalState.__mindosStudioAutomationWorker) return;
  const state = {
    running: false,
    timer: setInterval(() => { void tickOnce(state); }, TICK_INTERVAL_MS),
  };
  state.timer.unref?.();
  globalState.__mindosStudioAutomationWorker = state;
  void tickOnce(state);
}

async function tickOnce(state: { running: boolean }): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    await runStudioAutomationWorkerTick();
  } catch {
    console.warn('[studio-automation] Worker tick failed; it will retry on the next interval.');
  } finally {
    state.running = false;
  }
}

async function executeAutomation(job: StudioAutomationJob, context: { runId: string; signal: AbortSignal }) {
  // Keep the Pi runtime out of Next.js instrumentation's startup bundle. It is
  // only needed after a durable occurrence has actually been claimed.
  const { runHeadlessAgent } = await import('@/lib/agent/headless');
  return runHeadlessAgent({
    userMessage: job.prompt,
    permissionMode: job.permissionMode,
    maxSteps: effortMaxSteps(job.effort),
    ...(job.model === 'gpt-5.5' ? { modelOverride: job.model } : {}),
    workDir: getMindRoot(),
    entrypoint: 'schedule',
    automationId: job.id,
    runId: context.runId,
    signal: context.signal,
  });
}

function effortMaxSteps(effort: StudioAutomationJob['effort']): number {
  if (effort === 'extra-high') return 80;
  if (effort === 'high') return 50;
  return 30;
}
