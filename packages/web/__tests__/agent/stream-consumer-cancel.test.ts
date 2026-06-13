/**
 * consumeUIMessageStream — abort must release the pending reader.
 *
 * The abort check inside the read loop only runs after a read resolves; a
 * stream that goes quiet (hung runtime, dead SSE connection) leaves the
 * consumer awaiting reader.read() forever. Aborting the signal must cancel
 * the pending read so the promise settles and the body stream is released.
 */
import { describe, expect, it } from 'vitest';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';

function encodeEvent(evt: object): Uint8Array {
  return new TextEncoder().encode(`data:${JSON.stringify(evt)}\n\n`);
}

describe('consumeUIMessageStream — abort cancellation', () => {
  it('settles while a read is pending and cancels the underlying stream on abort', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encodeEvent({ type: 'text_delta', delta: 'partial ' }));
        // No further chunks and no close — the next read pends forever.
      },
      cancel() {
        cancelled = true;
      },
    });

    const promise = consumeUIMessageStream(body, () => {}, controller.signal);
    // Let the consumer drain the first chunk and park on the second read.
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();

    const message = await promise;
    expect(message.content).toBe('partial ');
    expect(cancelled).toBe(true);
  });

  it('settles when the signal was already aborted before consumption started', async () => {
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    const message = await consumeUIMessageStream(body, () => {}, controller.signal);
    expect(message.role).toBe('assistant');
    expect(cancelled).toBe(true);
  });
});
