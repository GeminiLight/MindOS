import { describe, expect, it, vi } from 'vitest';
import { createOpenAIProxyFetch } from './proxy-transport.js';

describe('OpenAI proxy transport', () => {
  it('converts a JSON tool response to the SDK stream without executing tools', async () => {
    const fetch = vi.fn(async (_request: Request) => new Response(JSON.stringify({
      id: 'reply', choices: [{ index: 0, message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    })));
    const response = await createOpenAIProxyFetch(fetch as typeof globalThis.fetch)('https://proxy.invalid/v1/chat/completions', {
      method: 'POST', headers: { authorization: 'Bearer fake' }, body: JSON.stringify({ stream: true, stream_options: { include_usage: true }, messages: [] }),
    });
    const request = fetch.mock.calls[0]![0];
    expect(await request.json()).toMatchObject({ stream: true });
    expect(request.headers.get('authorization')).toBe('Bearer fake');
    const text = await response.text();
    expect(text).toContain('"index":0');
    expect(text).toContain('"tool_calls"');
    expect(text).toContain('"prompt_tokens":12');
    expect(text).toContain('[DONE]');
  });

  it('preserves streaming for compatible proxies', async () => {
    const data = 'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const response = await createOpenAIProxyFetch(async () => new Response(data, { headers: { 'content-type': 'text/event-stream' } }))('https://proxy.invalid/chat/completions', { method: 'POST', body: '{}' });
    expect(await response.text()).toBe(data);
  });

  it('preserves authentication failures and rejects malformed success responses', async () => {
    const failed = await createOpenAIProxyFetch(async () => new Response('denied', { status: 401 }))('https://proxy.invalid/chat/completions', { method: 'POST', body: '{}' });
    expect(failed.status).toBe(401);
    await expect(createOpenAIProxyFetch(async () => new Response('{}'))('https://proxy.invalid/chat/completions', { method: 'POST', body: '{}' })).rejects.toThrow(/invalid.*response/i);
  });
});

it('retries only an explicit streaming refusal without changing tool or message payloads', async () => {
  const requests: any[] = [];
  const fetch = vi.fn(async (request: Request) => {
    requests.push(await request.json());
    return requests.length === 1 ? new Response('{"error":"streaming is not supported"}', { status: 400 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
  });
  const response = await createOpenAIProxyFetch(fetch as typeof globalThis.fetch)('https://proxy.invalid/v1/chat/completions', {
    method: 'POST', body: JSON.stringify({ stream: true, stream_options: { include_usage: true }, messages: [{ role: 'user', content: 'hello' }] }),
  });
  expect(await response.text()).toContain('ok');
  expect(requests[0].stream).toBe(true);
  expect(requests[1]).toEqual({ stream: false, messages: requests[0].messages });
});
