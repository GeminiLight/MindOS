/**
 * Async diff computation using worker_threads.
 * Falls back to synchronous diff if worker is unavailable.
 */
import { Worker } from 'worker_threads';
import path from 'path';
import type { DiffLine } from '@/components/changes/line-diff';

/** Minimal worker surface — lets tests substitute a fake worker. */
export interface DiffWorkerLike {
  postMessage(value: unknown): void;
  terminate(): Promise<number> | void;
  on(event: string, handler: (...args: never[]) => void): unknown;
}

let _worker: DiffWorkerLike | null = null;
let _nextId = 0;
const _pending = new Map<number, { resolve: (result: DiffLine[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

const DIFF_TIMEOUT_MS = 5_000; // 5 second timeout for worker computation

let _workerFactory: (() => DiffWorkerLike) | null = null;

/** Test hook: substitute the worker construction. Pass null to restore. */
export function __setDiffWorkerFactoryForTest(factory: (() => DiffWorkerLike) | null): void {
  _workerFactory = factory;
  _worker = null;
}

function createWorker(): DiffWorkerLike {
  if (_workerFactory) return _workerFactory();
  // Use import.meta-style URL resolution for Next.js/TypeScript compatibility.
  // Falls back to __dirname for Node.js CJS environments.
  const workerPath = path.resolve(__dirname, 'diff-worker.js');
  return new Worker(workerPath);
}

function getWorker(): DiffWorkerLike | null {
  if (_worker) return _worker;
  try {
    const worker = createWorker();
    worker.on('message', (({ id, result, error }: { id: number; result: DiffLine[] | null; error: string | null }) => {
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result!);
    }) as never);
    worker.on('error', () => { if (_worker === worker) _worker = null; drainPending(); });
    worker.on('exit', () => { if (_worker === worker) _worker = null; drainPending(); });
    _worker = worker;
    return _worker;
  } catch {
    return null;
  }
}

/**
 * Compute diff asynchronously using a worker thread.
 * Times out after 5 seconds and returns null (caller should fallback to summary).
 */
export function computeDiffAsync(before: string, after: string): Promise<DiffLine[] | null> {
  const worker = getWorker();
  if (!worker) return Promise.resolve(null);

  const id = _nextId++;
  return new Promise<DiffLine[] | null>((resolve) => {
    const timer = setTimeout(() => {
      _pending.delete(id);
      // A timed-out worker is almost certainly wedged on pathological input;
      // recycle it so later diffs get a fresh worker instead of queueing
      // behind the stuck computation.
      if (_worker === worker) _worker = null;
      void worker.terminate();
      resolve(null); // Timeout — caller will use fallback
    }, DIFF_TIMEOUT_MS);

    _pending.set(id, {
      resolve: (result) => resolve(result),
      reject: () => resolve(null),
      timer,
    });

    worker.postMessage({ id, before, after });
  });
}

/** Resolve all pending requests and clear timers (worker died or was terminated). */
function drainPending(): void {
  for (const [, p] of _pending) {
    clearTimeout(p.timer);
    p.resolve([]);
  }
  _pending.clear();
}

/** Terminate the worker (for cleanup/tests). */
export function terminateDiffWorker(): void {
  if (_worker) {
    void _worker.terminate();
    _worker = null;
  }
  drainPending();
}
