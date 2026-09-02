import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveExistingSafe } from '../../foundation/security/index.js';
import { tickStudioAutomationWorker } from './worker.js';
import type {
  StudioAutomationExecutor,
} from './types.js';
import type {
  TickStudioAutomationWorkerOptions,
  TickStudioAutomationWorkerResult,
} from './worker.js';

export const STUDIO_AUTOMATION_WORKER_HEARTBEAT_FILE = '.mindos/automations/worker.json';
export const DEFAULT_STUDIO_AUTOMATION_TICK_INTERVAL_MS = 15_000;

export type StudioAutomationWorkerHeartbeat = {
  schemaVersion: 1;
  ownerId: string;
  pid: number;
  status: 'running' | 'idle' | 'error' | 'stopped';
  updatedAt: string;
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastError?: string;
};

type StudioAutomationTick = (
  options: TickStudioAutomationWorkerOptions,
) => Promise<TickStudioAutomationWorkerResult>;

export type RunStudioAutomationWorkerOptions = {
  mindRoot: string;
  executor: StudioAutomationExecutor;
  ownerId?: string;
  tick?: StudioAutomationTick;
};

export type RunStudioAutomationWorkerServiceOptions = RunStudioAutomationWorkerOptions & {
  intervalMs?: number;
  signal?: AbortSignal;
};

export async function runStudioAutomationWorkerOnce(
  options: RunStudioAutomationWorkerOptions,
): Promise<TickStudioAutomationWorkerResult> {
  const ownerId = normalizeOwnerId(options.ownerId ?? `automation-service-${process.pid}`);
  const tick = options.tick ?? tickStudioAutomationWorker;
  const startedAt = new Date();
  writeStudioAutomationWorkerHeartbeat(options.mindRoot, {
    schemaVersion: 1,
    ownerId,
    pid: process.pid,
    status: 'running',
    updatedAt: startedAt.toISOString(),
    lastTickStartedAt: startedAt.toISOString(),
  });
  try {
    const result = await tick({
      mindRoot: options.mindRoot,
      executor: options.executor,
      ownerId,
    });
    const finishedAt = new Date();
    writeStudioAutomationWorkerHeartbeat(options.mindRoot, {
      schemaVersion: 1,
      ownerId,
      pid: process.pid,
      status: 'idle',
      updatedAt: finishedAt.toISOString(),
      lastTickStartedAt: startedAt.toISOString(),
      lastTickFinishedAt: finishedAt.toISOString(),
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
    writeStudioAutomationWorkerHeartbeat(options.mindRoot, {
      schemaVersion: 1,
      ownerId,
      pid: process.pid,
      status: 'error',
      updatedAt: finishedAt.toISOString(),
      lastTickStartedAt: startedAt.toISOString(),
      lastTickFinishedAt: finishedAt.toISOString(),
      lastError: compactError(error),
    });
    throw error;
  }
}

export async function runStudioAutomationWorkerService(
  options: RunStudioAutomationWorkerServiceOptions,
): Promise<void> {
  const ownerId = normalizeOwnerId(options.ownerId ?? `automation-service-${process.pid}`);
  const intervalMs = Math.max(1, Math.min(60 * 60_000, options.intervalMs ?? DEFAULT_STUDIO_AUTOMATION_TICK_INTERVAL_MS));
  while (!options.signal?.aborted) {
    try {
      await runStudioAutomationWorkerOnce({ ...options, ownerId });
    } catch {
      // The heartbeat preserves the failure. A resident service must continue
      // polling because config, provider, or filesystem failures can recover.
    }
    if (options.signal?.aborted) break;
    await abortableDelay(intervalMs, options.signal);
  }
  const previous = readStudioAutomationWorkerHeartbeat(options.mindRoot);
  const stoppedAt = new Date().toISOString();
  writeStudioAutomationWorkerHeartbeat(options.mindRoot, {
    schemaVersion: 1,
    ownerId,
    pid: process.pid,
    status: 'stopped',
    updatedAt: stoppedAt,
    ...(previous?.lastTickStartedAt ? { lastTickStartedAt: previous.lastTickStartedAt } : {}),
    ...(previous?.lastTickFinishedAt ? { lastTickFinishedAt: previous.lastTickFinishedAt } : {}),
    ...(previous?.lastError ? { lastError: previous.lastError } : {}),
  });
}

export function readStudioAutomationWorkerHeartbeat(mindRoot: string): StudioAutomationWorkerHeartbeat | null {
  const file = resolveExistingSafe(mindRoot, STUDIO_AUTOMATION_WORKER_HEARTBEAT_FILE);
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf-8')) as Partial<StudioAutomationWorkerHeartbeat>;
    if (value.schemaVersion !== 1 || typeof value.ownerId !== 'string' || typeof value.pid !== 'number'
      || (value.status !== 'running' && value.status !== 'idle' && value.status !== 'error' && value.status !== 'stopped')
      || typeof value.updatedAt !== 'string') return null;
    return value as StudioAutomationWorkerHeartbeat;
  } catch {
    return null;
  }
}

function writeStudioAutomationWorkerHeartbeat(mindRoot: string, heartbeat: StudioAutomationWorkerHeartbeat): void {
  const file = resolveExistingSafe(mindRoot, STUDIO_AUTOMATION_WORKER_HEARTBEAT_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(heartbeat, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

function normalizeOwnerId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  return normalized || `automation-service-${process.pid}`;
}

function compactError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 1_000);
}
