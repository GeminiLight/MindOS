import { afterEach, it, expect, vi } from 'vitest';
import { executeMethodComparison, executeStudyCoaching } from '@/lib/study-coaching-executor';
vi.mock('@/lib/study-coaching-config', () => ({ configuredStudyRuntime: () => ({ endpoint: 'http://localhost:9/v1/chat/completions', apiKey: '' }) }));
afterEach(() => vi.unstubAllGlobals());
const input = { runtime: { adapter: 'isolated-chat-v1' as const, provider: 'ollama', model: 'qa', endpoint: 'http://localhost:9/v1/chat/completions', temperature: 0 as const, maxOutputTokens: 1024 as const, tools: [] as never[] }, messages: [{ role: 'user' as const, content: 'Task' }] };
it('retains the provider response identity for comparisons without changing the study v1 result contract', async () => {
  const fetch = vi.fn(async () => Response.json({ id: 'provider-123', model: 'qa', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Output' } }] })); vi.stubGlobal('fetch', fetch);
  expect(await executeMethodComparison(input)).toEqual({ status: 'succeeded', output: 'Output', reportedModel: 'qa', responseId: 'provider-123' });
  expect(await executeStudyCoaching(input)).toEqual({ status: 'succeeded', output: 'Output', reportedModel: 'qa' });
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ model: 'qa', messages: input.messages, stream: false, temperature: 0, max_tokens: 1024 });
});
it('does not accept a malformed response identifier or invent a missing one', async () => {
  const response = (id?: unknown) => Response.json({ id, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Output' } }] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(12)).mockResolvedValueOnce(response()));
  expect(await executeMethodComparison(input)).toEqual({ status: 'failed', failure: 'invalid-output' });
  expect(await executeMethodComparison(input)).toEqual({ status: 'succeeded', output: 'Output' });
});
it('sends the frozen reasoning-inclusive budget and still rejects truncated output', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'Incomplete answer' } }] }));
  vi.stubGlobal('fetch', fetch);
  expect(await executeMethodComparison({ ...input, runtime: { ...input.runtime, maxOutputTokens: 4096 } })).toEqual({ status: 'failed', failure: 'invalid-output' });
  expect(JSON.parse(fetch.mock.calls[0][1].body).max_tokens).toBe(4096);
});
