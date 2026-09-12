// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPluginDataBridge } from '@/lib/obsidian-compat/browser-host/data-bridge';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('accepts only the trusted parent reply and sends no plugin identity or credentials', async () => {
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const bridge = createPluginDataBridge();
  const pending = bridge.load();
  const request = post.mock.calls[0][0];
  expect(Object.keys(request).sort()).toEqual(['id', 'kind', 'operation']);
  let resolved = false;
  void pending.then(() => { resolved = true; });
  const reply = { kind: 'plugin-data-result', id: request.id, data: { label: '中文' } };
  window.dispatchEvent(new MessageEvent('message', { source: null, data: reply }));
  await Promise.resolve();
  expect(resolved).toBe(false);
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, data: reply }));
  await expect(pending).resolves.toEqual({ label: '中文' });
  bridge.close();
});

it('bounds outstanding requests, cancels them on close and cannot be reopened', async () => {
  vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const bridge = createPluginDataBridge();
  const pending = Array.from({ length: 32 }, () => bridge.load().catch(error => error.message));
  await expect(bridge.load()).rejects.toThrow(/Too many/);
  bridge.close();
  expect(await Promise.all(pending)).toEqual(Array(32).fill('Plugin configuration session closed.'));
  await expect(bridge.load()).rejects.toThrow(/closed/);
});

it('expires missing replies and clears timers when message delivery itself fails', async () => {
  vi.useFakeTimers();
  const post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  const bridge = createPluginDataBridge();
  const timedOut = expect(bridge.load()).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(10_000);
  await timedOut;
  post.mockImplementation(() => { throw new Error('frame gone'); });
  await expect(bridge.load()).rejects.toThrow('frame gone');
  expect(vi.getTimerCount()).toBe(0);
  bridge.close();
});
