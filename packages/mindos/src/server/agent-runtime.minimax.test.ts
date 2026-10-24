import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Api, Model } from '@earendil-works/pi-ai';
import { createStandalonePiHostServices } from './agent-runtime.js';

// Vitest's VM cannot execute new Function(import); keep the imported SDK real.
vi.mock('../foundation/native-import.js', () => ({ nativeImport: (specifier: string) => import(specifier) }));

describe('standalone MiniMax request path', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['minimax', '', 'https://api.minimax.io/anthropic/v1/messages'],
    ['minimax-cn', '', 'https://api.minimaxi.com/anthropic/v1/messages'],
    ['minimax', 'MiniMax-M3', 'https://api.minimax.io/anthropic/v1/messages'],
    ['minimax', 'MiniMax-M2.7', 'https://api.minimax.io/anthropic/v1/messages'],
    ['openrouter', 'minimax/minimax-m3.1-flash:free', 'https://openrouter.ai/api/v1/chat/completions'],
  ])('serializes %s / %s using the standalone resolver', async (protocol, model, expectedUrl) => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.json();
      requests.push({ url: request.url, body });
      const events = protocol === 'openrouter'
        ? `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        : [
          { type: 'message_start', message: { id: 'fixture', model: body.model, usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'OK' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
      return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
    });
    const host = createStandalonePiHostServices({ ai: {
      activeProvider: 'p_fixture', providers: [{ id: 'p_fixture', protocol, model, apiKey: 'fixture-only', baseUrl: '' }],
    } });
    const cfg = await host.resolveModelConfig({ messages: [], hasImages: false });
    const result = await builtinModels().completeSimple(cfg.model as Model<Api>, {
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    }, { apiKey: cfg.apiKey });
    expect(result.stopReason).toBe('stop');
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(expectedUrl);
    expect(requests[0].body.model).toBe(model || 'MiniMax-M3.1-Flash');
    if (!model || model.includes('flash')) {
      expect(requests[0].body.thinking).toBeUndefined();
      expect(requests[0].body.reasoning).toBeUndefined();
    }
    expect(requests[0].body.service_tier).toBeUndefined();
  });
});
