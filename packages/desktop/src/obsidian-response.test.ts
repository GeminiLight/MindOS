import { describe, expect, it, vi } from 'vitest';
import { readObsidianJson } from './obsidian-response';

describe('bounded Obsidian response reader', () => {
  it('reads UTF-8 JSON split across arbitrary packet boundaries, exactly at the byte limit', async () => {
    const bytes = new TextEncoder().encode('{"note":"中文📝"}');
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
    expect(await readObsidianJson(response, bytes.length, new AbortController().signal, 'Test')).toEqual({ note: '中文📝' });
  });

  it('does not wait forever for a broken stream to acknowledge cancellation after overflow', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel }));
    await expect(readObsidianJson(response, 10, new AbortController().signal, 'Test')).rejects.toThrow(/large/i);
    expect(cancel).toHaveBeenCalled();
    expect(response.body!.locked).toBe(false);
  });

  it('enforces a deadline after response headers even when the body never finishes', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    await expect(readObsidianJson(response, 10, AbortSignal.timeout(10), 'Test')).rejects.toThrow(/timeout/i);
    expect(cancel).toHaveBeenCalled();
    expect(response.body!.locked).toBe(false);
  });

  it.each(['[]', 'null', 'not-json'])('rejects malformed document/package JSON: %s', async text => {
    await expect(readObsidianJson(new Response(text), 100, new AbortController().signal, 'Test')).rejects.toThrow();
  });

  it('rejects malformed UTF-8 instead of silently replacing corrupt bytes', async () => {
    const response = new Response(Uint8Array.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
    await expect(readObsidianJson(response, 100, new AbortController().signal, 'Test')).rejects.toThrow();
  });

  it('does not return already buffered data after the lifetime is aborted', async () => {
    const lifetime = new AbortController(); lifetime.abort(new Error('Window closed'));
    await expect(readObsidianJson(new Response('{}'), 100, lifetime.signal, 'Test')).rejects.toThrow(/closed/i);
  });
});
