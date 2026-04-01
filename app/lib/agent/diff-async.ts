/**
 * Async diff computation using worker_threads.
 * Falls back to synchronous diff if worker is unavailable.
 */
import { Worker } from 'worker_threads';
import path from 'path';
import type { DiffLine } from '@/components/changes/line-diff';

let _worker: Worker | null = null;
let _nextId = 0;
const _pending = new Map<number, { resolve: (result: DiffLine[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

const DIFF_TIMEOUT_MS = 5_000; // 5 second timeout for worker computation

function getWorker(): Worker | null {
  if (_worker) return _worker;
  try {
    // Use import.meta-style URL resolution for Next.js/TypeScript compatibility.
    // Falls back to __dirname for Node.js CJS environments.
    const workerPath = path.resolve(__dirname, 'diff-worker.js');
    _worker = new Worker(workerPath);
    _worker.on('message', ({ id, result, error }: { id: number; result: DiffLine[] | null; error: string | null }) => {
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result!);
    });
    _worker.on('error', () => { _worker = null; });
    _worker.on('exit', () => { _worker = null; });
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

/** Terminate the worker (for cleanup/tests). */
export function terminateDiffWorker(): void {
  if (_worker) {
    _worker.terminate();
    _worker = null;
  }
  for (const [, p] of _pending) {
    clearTimeout(p.timer);
    p.resolve([]);
  }
  _pending.clear();
}
