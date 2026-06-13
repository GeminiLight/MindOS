/**
 * computeDiffAsync — worker lifecycle on timeout.
 *
 * A diff that exceeds the deadline usually means the worker is wedged
 * (pathological input). The wedged worker must be terminated and replaced,
 * otherwise every later diff queues behind it and also times out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setDiffWorkerFactoryForTest,
  computeDiffAsync,
  terminateDiffWorker,
} from '@/lib/agent/diff-async';

type Handler = (...args: unknown[]) => void;

function makeFakeWorker() {
  const handlers = new Map<string, Handler[]>();
  const worker = {
    posted: [] as Array<{ id: number; before: string; after: string }>,
    terminated: 0,
    postMessage(value: { id: number; before: string; after: string }) {
      worker.posted.push(value);
    },
    terminate() {
      worker.terminated += 1;
      for (const handler of handlers.get('exit') ?? []) handler(0);
      return Promise.resolve(0);
    },
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return worker;
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return worker;
}

describe('computeDiffAsync worker recycling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    __setDiffWorkerFactoryForTest(null);
    terminateDiffWorker();
    vi.useRealTimers();
  });

  it('resolves with the worker result before the deadline', async () => {
    const worker = makeFakeWorker();
    __setDiffWorkerFactoryForTest(() => worker as never);

    const promise = computeDiffAsync('a', 'b');
    expect(worker.posted).toHaveLength(1);
    worker.emit('message', { id: worker.posted[0].id, result: [{ type: 'add', text: 'b' }], error: null });

    await expect(promise).resolves.toEqual([{ type: 'add', text: 'b' }]);
    expect(worker.terminated).toBe(0);
  });

  it('terminates a wedged worker on timeout and spawns a fresh one for the next diff', async () => {
    const first = makeFakeWorker();
    const second = makeFakeWorker();
    const workers = [first, second];
    __setDiffWorkerFactoryForTest(() => workers.shift() as never);

    const timedOut = computeDiffAsync('a', 'b');
    await vi.advanceTimersByTimeAsync(5_100);
    await expect(timedOut).resolves.toBeNull();
    expect(first.terminated).toBeGreaterThan(0);

    // Next call must not reuse the wedged worker.
    const next = computeDiffAsync('c', 'd');
    expect(second.posted).toHaveLength(1);
    second.emit('message', { id: second.posted[0].id, result: [], error: null });
    await expect(next).resolves.toEqual([]);
  });
});
