import { afterEach, expect, it, vi } from 'vitest';
import { executeStudyCoaching } from '@/lib/study-coaching-executor';
import type { StudyCoachingRequest } from '@geminilight/mindos/knowledge';
vi.mock('@/lib/settings', () => ({ effectiveAiConfig: vi.fn(() => ({ provider: 'ollama', model: 'fixture', baseUrl: 'http://localhost:9876/v1', apiKey: '' })) }));
const input: StudyCoachingRequest = { runtime: { adapter: 'isolated-chat-v1', provider: 'ollama', model: 'fixture', endpoint: 'http://localhost:9876/v1/chat/completions', temperature: 0, maxOutputTokens: 1024, tools: [] }, messages: [{ role: 'system', content: 'Frozen context' }, { role: 'user', content: 'Current question' }] };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('sends one exact frozen request with no tools, fallback or ambient context', async () => {
  const fetch = vi.fn(async () => Response.json({ model: 'reported-fixture', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Actual returned text' } }] })); vi.stubGlobal('fetch', fetch);
  expect(await executeStudyCoaching(input)).toEqual({ status: 'succeeded', output: 'Actual returned text', reportedModel: 'reported-fixture' });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(input.runtime.endpoint); expect(options.redirect).toBe('error');
  expect(JSON.parse(options.body as string)).toEqual({ model: 'fixture', messages: input.messages, stream: false, temperature: 0, max_tokens: 1024 });
  expect(JSON.stringify(options)).not.toMatch(/tools|Authorization|mind-root/);
});
it('refuses a provider, model or endpoint drift without sending credentials or making a request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const patch of [{ provider: 'unknown' }, { model: 'different' }, { endpoint: 'https://other.example/chat/completions' }]) {
    expect(await executeStudyCoaching({ ...input, runtime: { ...input.runtime, ...patch } })).toEqual({ status: 'failed', failure: 'configuration' });
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps provider failures, truncated/tool output, malformed and oversized responses out of the help record', async () => {
  for (const response of [new Response('SECRET PROVIDER ERROR', { status: 500 }), Response.json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }), Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'pretend', tool_calls: [{}] } }] }), new Response('not-json'), new Response('x'.repeat(131073)), Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'x'.repeat(8001) } }] })]) {
    const fetch = vi.fn(async () => response); vi.stubGlobal('fetch', fetch);
    const result = await executeStudyCoaching(input);
    expect(result.status).toBe('failed'); expect(JSON.stringify(result)).not.toMatch(/SECRET|pretend|partial/); expect(fetch).toHaveBeenCalledTimes(1);
  }
  vi.stubGlobal('fetch', vi.fn(async () => { throw Error('network secret'); }));
  expect(await executeStudyCoaching(input)).toEqual({ status: 'failed', failure: 'provider' });
});
it('does not start a request if its caller has already cancelled', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController(); controller.abort();
  expect(await executeStudyCoaching(input, controller.signal)).toEqual({ status: 'failed', failure: 'interrupted' });
  expect(fetch).not.toHaveBeenCalled();
});
it('reports local configuration readiness without making a provider request', async () => {
  const { studyExecutionReadiness } = await import('@/lib/study-coaching-config');
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const base = { execution: { adapter: 'isolated-chat-v1' as const, maxTurns: 2 }, conditions: [{ id: 'a', expectedRuntime: input.runtime }, { id: 'b', expectedRuntime: { ...input.runtime, model: 'missing' } }] };
  expect(studyExecutionReadiness(base)).toEqual([{ conditionId: 'a', configured: true }, { conditionId: 'b', configured: false }]);
  expect(studyExecutionReadiness({ ...base, execution: undefined })).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
