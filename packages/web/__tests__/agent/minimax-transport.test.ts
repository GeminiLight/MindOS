import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@earendil-works/pi-ai';

// Use the real saved-config resolver, Pi providers and SDK serializer. Only the
// HTTP transport is replaced; fixture credentials never leave this process.
vi.unmock('@/lib/settings');
// Bridge Vitest's VM module loader without replacing any Pi implementation.
vi.mock('../../../mindos/dist/foundation/native-import.js', () => ({ nativeImport: (specifier: string) => import(specifier) }));

const prompt: Context = { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] };
type SerializedBody = {
  model: string;
  thinking?: { type: string };
  output_config?: { effort: string };
  reasoning?: { effort: string };
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
  [key: string]: unknown;
};

describe('MiniMax serialized requests', () => {
  let home: string;
  let configPath: string;
  let requests: Array<{ url: string; body: SerializedBody }>;
  let toolResponse: boolean;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-minimax-'));
    fs.mkdirSync(path.join(home, '.mindos'));
    configPath = path.join(home, '.mindos/config.json');
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    requests = [];
    toolResponse = false;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const body = await request.json();
      requests.push({ url: request.url, body });
      if (request.url.endsWith('/chat/completions')) {
        return new Response(`data: ${JSON.stringify({
          id: 'fixture', object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
        })}\n\ndata: ${JSON.stringify({
          id: 'fixture', object: 'chat.completion.chunk', model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      }
      const content = toolResponse
        ? [
          { type: 'thinking', thinking: 'Keep this reasoning', signature: '' },
          { type: 'tool_use', id: 'call_1', name: 'lookup', input: { query: 'test' } },
        ]
        : [{ type: 'text', text: 'OK' }];
      const events = [
        { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: body.model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
        ...content.flatMap((content_block, index) => [
          { type: 'content_block_start', index, content_block },
          ...(content_block.type === 'tool_use' ? [{
            type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(content_block.input) },
          }] : []),
          { type: 'content_block_stop', index },
        ]),
        { type: 'message_delta', delta: { stop_reason: toolResponse ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function saveProvider(protocol: string, model = '', baseUrl = '') {
    fs.writeFileSync(configPath, JSON.stringify({
      ai: { activeProvider: 'p_fixture', providers: [{ id: 'p_fixture', name: 'Fixture', protocol, apiKey: 'fixture-only', model, baseUrl }] },
    }));
  }

  async function resolve() {
    const { getModelConfig } = await import('@/lib/agent/model');
    return getModelConfig();
  }

  for (const [provider, host] of [['minimax', 'api.minimax.io'], ['minimax-cn', 'api.minimaxi.com']]) {
    it(`sends the ${provider} default through the real completion SDK`, async () => {
      saveProvider(provider);
      const cfg = await resolve();
      expect(cfg.modelName).toBe('MiniMax-M3.1-Flash');
      expect(cfg.model.contextWindow).toBe(1_000_000);
      expect(cfg.model.maxTokens).toBe(524_288);
      const { completeWithPiModels } = await import('@/lib/agent/pi-models');
      const response = await completeWithPiModels(cfg.model, prompt, { apiKey: cfg.apiKey });
      expect(response.stopReason).toBe('stop');
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe(`https://${host}/anthropic/v1/messages`);
      expect(requests[0].body.model).toBe('MiniMax-M3.1-Flash');
      expect(requests[0].body.thinking?.type).not.toBe('disabled');
      expect(requests[0].body.output_config).toBeUndefined(); // Provider default: max.
      expect(requests[0].body.service_tier).toBeUndefined();
      expect(requests[0].body.reasoning_split).toBeUndefined();
    });

    it.each([undefined, 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
      `${provider} agent serialization preserves effort %s without disabling Flash`, async (reasoning) => {
        saveProvider(provider);
        const cfg = await resolve();
        const { builtinModels } = await import('@earendil-works/pi-ai/providers/all');
        const response = await builtinModels().completeSimple(cfg.model, prompt, { apiKey: cfg.apiKey, reasoning });
        expect(response.stopReason).toBe('stop');
        const body = requests[0].body;
        expect(body.model).toBe('MiniMax-M3.1-Flash');
        expect(body.thinking?.type).not.toBe('disabled');
        if (reasoning) {
          expect(body.thinking?.type).toBe('adaptive');
          expect(body.output_config?.effort).toBe(reasoning === 'minimal' ? 'low' : reasoning);
        } else {
          expect(body.output_config).toBeUndefined();
        }
        expect(body.service_tier).toBeUndefined();
      },
    );
  }

  it.each(['minimax', 'minimax-cn'])('runs the %s default through the real MindOS agent session', async (provider) => {
    saveProvider(provider);
    const { createMindosPiCodingAgentRuntime, runMindosPiAgentTurnSession } = await import('@geminilight/mindos/agent/mindos-pi');
    const runtime = await createMindosPiCodingAgentRuntime({
      messages: [], systemPrompt: 'Reply briefly.', projectRoot: home,
      agentDir: path.join(home, '.pi'), mindRoot: home,
      agentConfig: {}, serverSettings: {}, allowProjectBash: false,
      hostServices: { resolveModelConfig: resolve, toRuntimeProvider: value => value },
    });
    try {
      const result = await runMindosPiAgentTurnSession({
        session: runtime.session, prompt: 'Hello', provider, stepLimit: 2, send: () => {},
      });
      expect(result.status).toBe('completed');
      expect(requests).toHaveLength(1);
      expect(requests[0].body.model).toBe('MiniMax-M3.1-Flash');
      expect(requests[0].body.thinking?.type).toBe('adaptive');
      expect(requests[0].body.output_config?.effort).toBe('low'); // Pi clamps unavailable off to minimal.
    } finally {
      (runtime.session as { dispose?: () => void }).dispose?.();
    }
  });

  it.each([undefined, 'high'] as const)('preserves M3 optional thinking (%s)', async (reasoning) => {
    saveProvider('minimax', 'MiniMax-M3');
    const cfg = await resolve();
    const { builtinModels } = await import('@earendil-works/pi-ai/providers/all');
    const response = await builtinModels().completeSimple(cfg.model, prompt, { apiKey: cfg.apiKey, reasoning });
    expect(response.stopReason).toBe('stop');
    expect(requests[0].body.model).toBe('MiniMax-M3');
    expect(requests[0].body.thinking?.type).toBe(reasoning ? 'adaptive' : 'disabled');
  });

  it.each(['MiniMax-M2.7', 'private-model'])('preserves explicit %s and its custom endpoint', async (model) => {
    saveProvider('minimax', model, 'https://custom.example/prefix/anthropic');
    const cfg = await resolve();
    const { completeWithPiModels } = await import('@/lib/agent/pi-models');
    expect((await completeWithPiModels(cfg.model, prompt, { apiKey: cfg.apiKey })).stopReason).toBe('stop');
    expect(requests[0].url).toBe('https://custom.example/prefix/anthropic/v1/messages');
    expect(requests[0].body.model).toBe(model);
    expect(cfg.model.compat?.forceAdaptiveThinking).toBeUndefined();
    expect(cfg.model.thinkingLevelMap?.off).not.toBeNull();
  });

  it.each(['MiniMax-M2.7', 'gpt-4o'])('preserves explicit custom OpenAI model configuration for %s', async (model) => {
    saveProvider('openai', model, 'https://custom.example/v1');
    const cfg = await resolve();
    expect(cfg.model.id).toBe(model);
    expect(cfg.model.api).toBe('openai-completions');
    expect(cfg.model.baseUrl).toBe('https://custom.example/v1');
    expect(cfg.model.compat?.forceAdaptiveThinking).toBeUndefined();
    expect(cfg.model.thinkingLevelMap?.off).not.toBeNull();
  });

  it.each([undefined, 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const)(
    'uses the verified OpenRouter Flash route with effort %s', async reasoning => {
      saveProvider('openrouter', 'minimax/minimax-m3.1-flash:free');
      const cfg = await resolve();
      const { builtinModels } = await import('@earendil-works/pi-ai/providers/all');
      expect((await builtinModels().completeSimple(cfg.model, prompt, { apiKey: cfg.apiKey, reasoning })).stopReason).toBe('stop');
      expect(requests[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(requests[0].body.model).toBe('minimax/minimax-m3.1-flash:free');
      expect(requests[0].body.reasoning?.effort).toBe(reasoning === 'minimal' ? 'low' : reasoning);
      expect(requests[0].body.service_tier).toBeUndefined();
      expect(requests[0].body.reasoning_split).toBeUndefined();
      expect(cfg.model.contextWindow).toBe(1_000_000);
      expect(cfg.model.maxTokens).toBe(524_288);
    },
  );

  it('replays SDK thinking/tool blocks and preserves image content', async () => {
    saveProvider('minimax');
    const { getModelConfig } = await import('@/lib/agent/model');
    const cfg = await getModelConfig({ hasImages: true });
    const { completeWithPiModels } = await import('@/lib/agent/pi-models');
    toolResponse = true;
    const first = await completeWithPiModels(cfg.model, prompt, { apiKey: cfg.apiKey });
    expect(first.stopReason).toBe('toolUse');
    toolResponse = false;
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'aGVsbG8=' };
    const second = await completeWithPiModels(cfg.model, {
      messages: [
        ...prompt.messages, first,
        { role: 'toolResult', toolCallId: 'call_1', toolName: 'lookup', content: [{ type: 'text', text: 'found' }], isError: false, timestamp: 2 },
        { role: 'user', content: [image], timestamp: 3 },
      ],
    }, { apiKey: cfg.apiKey });
    expect(second.stopReason).toBe('stop');
    expect(requests[1].body.messages[1]).toEqual({
      role: 'assistant', content: [
        { type: 'thinking', thinking: 'Keep this reasoning', signature: '' },
        { type: 'tool_use', id: 'call_1', name: 'lookup', input: { query: 'test' } },
      ],
    });
    expect(requests[1].body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1', content: 'found' });
    expect(requests[1].body.messages[3].content[0]).toMatchObject({
      type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data },
    });
  });
});
