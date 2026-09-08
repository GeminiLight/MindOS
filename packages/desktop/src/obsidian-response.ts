import { Buffer } from 'node:buffer';

/** Shared main-process endpoint policy for native owners and authenticated transports. */
export function managedObsidianBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Invalid managed local server URL.');
  }
  return url;
}

/** Cancels pending I/O or native approval, never synchronous plugin execution. */
export async function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let cancel!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason ?? new Error('Plugin session closed.'));
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    const result = await Promise.race([promise, aborted]);
    // A fulfilled read can win Promise.race when both operands are already settled.
    signal.throwIfAborted();
    return result;
  }
  finally { signal.removeEventListener('abort', cancel); }
}

/** Single allocation also bounds memory when a peer sends millions of tiny chunks. */
export async function readObsidianJson(response: Response, maxBytes: number, signal: AbortSignal, subject: string): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error(`Empty ${subject} response.`);
  const reader = response.body.getReader();
  const buffer = Buffer.allocUnsafe(maxBytes);
  let size = 0;
  try {
    while (true) {
      const { value, done } = await untilAbort(reader.read(), signal);
      if (done) break;
      if (value.byteLength > maxBytes - size) throw new Error(`${subject} response is too large.`);
      buffer.set(value, size); size += value.byteLength;
    }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Invalid ${subject} response.`);
    return data as Record<string, unknown>;
  } catch (error) {
    // A broken stream's cancel promise must not hold up revocation.
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}
