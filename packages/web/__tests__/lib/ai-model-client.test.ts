import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/settings', () => ({ effectiveAiConfig: () => ({ provider: 'openai', model: 'fake', apiKey: 'fake', baseUrl: 'https://proxy.invalid/v1' }) }));
import { createDefaultModelClient } from '@/lib/ai/model-client';
afterEach(() => vi.unstubAllGlobals());
it('uses the SDK to read JSON completions from a proxy for tool-free tasks', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }] }))));
  const result = await createDefaultModelClient().completeText({ taskId: 'test', promptVersion: '1', modelProfile: 'fast-structured', messages: [{ role: 'user', content: 'hello' }] });
  expect(result.text).toBe('answer');
});
it('preserves proxy authentication errors instead of returning empty text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"denied"}}', { status: 401 })));
  await expect(createDefaultModelClient().completeText({ taskId: 'test', promptVersion: '1', modelProfile: 'fast-structured', messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow(/401|denied/);
});
