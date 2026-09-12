import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { nativeImport } from '../../foundation/native-import.js';

/** Adapt only HTTP framing. Pi still owns message conversion, tools, usage, history and compaction. */
export function createOpenAIProxyFetch(fetchImpl: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/chat/completions')) return fetchImpl(request);
    const payload = await request.json() as Record<string, unknown>;
    const options = { method: request.method, headers: request.headers, signal: request.signal, body: JSON.stringify(payload) };
    let response = await fetchImpl(new Request(request.url, options));
    // Some user-configured proxy URLs omit the conventional /v1 prefix.
    const url = new URL(request.url);
    if (response.status === 404 && !/\/v\d+(?:\/|$)/.test(url.pathname)) {
      await response.body?.cancel();
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '/v1/chat/completions');
      response = await fetchImpl(new Request(url, options));
    }
    // Keep native streaming; retry only a proxy's explicit protocol refusal.
    if (payload.stream && [400, 422].includes(response.status) && /stream/i.test(await response.clone().text())) {
      await response.body?.cancel();
      const { stream_options: _streamOptions, ...body } = payload;
      response = await fetchImpl(new Request(url, { ...options, body: JSON.stringify({ ...body, stream: false }) }));
    }
    if (!response.ok || response.headers.get('content-type')?.includes('text/event-stream')) return response;
    const text = await response.text();
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/event-stream');
    headers.delete('content-length');
    headers.delete('content-encoding');
    if (text.trimStart().startsWith('data:')) return new Response(text, { status: response.status, headers });
    let completion: Record<string, unknown>;
    try { completion = JSON.parse(text); } catch { throw new Error('Proxy returned an invalid completion response.'); }
    if (!completion || !Array.isArray(completion.choices) || completion.choices.length === 0) {
      throw new Error('Proxy returned an invalid completion response.');
    }
    const choices = completion.choices.map((choice, index) => {
      if (!choice || typeof choice !== 'object' || !choice.message || typeof choice.message !== 'object') {
        throw new Error('Proxy returned an invalid completion response.');
      }
      const message = choice.message;
      return {
        index: choice.index ?? index,
        delta: {
          ...message,
          ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls.map((call: Record<string, unknown>, i: number) => ({ ...call, index: i })) } : {}),
        },
        finish_reason: choice.finish_reason ?? 'stop',
      };
    });
    return new Response(`data: ${JSON.stringify({ ...completion, choices })}\n\ndata: [DONE]\n\n`, { status: response.status, headers });
  };
}

/** Per-session provider registration preserves the SDK's auth and session ownership. */
export async function installMindosProxyTransport(session: {
  model?: Model<Api>;
  modelRuntime: Pick<ModelRuntime, 'registerProvider'>;
}): Promise<void> {
  const model = session.model;
  if (!model || model.api !== 'openai-completions' || !model.baseUrl || new URL(model.baseUrl).hostname === 'api.openai.com') return;
  const api = await nativeImport<typeof import('@earendil-works/pi-ai/api/openai-completions')>('@earendil-works/pi-ai/api/openai-completions');
  session.modelRuntime.registerProvider(model.provider, {
    api: 'openai-completions',
    streamSimple: (selected, context, options) => api.streamSimple(selected as Model<'openai-completions'>, context, {
      ...options,
      fetch: createOpenAIProxyFetch(options?.fetch),
    }),
  });
}
