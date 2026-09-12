import { afterEach, expect, it, vi } from 'vitest';
import { readObsidianPackageText } from '@/lib/obsidian-compat/package-asset-reader';

afterEach(() => vi.useRealTimers());
it('decodes Unicode split across chunks within the actual byte budget', async () => {
  const bytes = new TextEncoder().encode('中文 📚');
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  expect(await readObsidianPackageText(response, bytes.length, 1000, 'main.js')).toBe('中文 📚');
});
it('rejects a dishonest content length and cancels an oversized stream before reading it all', async () => {
  const cancel = vi.fn(); let pulls = 0;
  const response = new Response(new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(4)); }, cancel }), { headers: { 'content-length': '1' } });
  await expect(readObsidianPackageText(response, 5, 1000, 'main.js')).rejects.toThrow(/too large/);
  expect(cancel).toHaveBeenCalledOnce(); expect(pulls).toBeLessThanOrEqual(3);
});
it('cancels a stalled body even after the response headers have arrived', async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  const response = new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel }));
  const pending = expect(readObsidianPackageText(response, 8, 10, 'main.js')).rejects.toThrow(/Timed out/);
  await vi.advanceTimersByTimeAsync(10); await pending;
  expect(cancel).toHaveBeenCalledOnce();
});
it('rejects oversized declared lengths, invalid UTF-8 and invalid limits', async () => {
  await expect(readObsidianPackageText(new Response('', { headers: { 'content-length': '100' } }), 8, 1000, 'main.js')).rejects.toThrow(/too large/);
  await expect(readObsidianPackageText(new Response(Uint8Array.of(255)), 8, 1000, 'main.js')).rejects.toThrow();
  await expect(readObsidianPackageText(new Response(''), Infinity, 1000, 'main.js')).rejects.toThrow(/limit/);
});
