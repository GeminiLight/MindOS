import { describe, expect, it } from 'vitest';
import { encodeMindosSseEvent } from '@geminilight/mindos/agent/turn';
import { prependMindosSseStatusEvent } from '@/app/api/agent/_lib/turn-sse';
import { normalizeAgentSessionTurnBody } from '@/app/api/agent/_lib/turn-request';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

async function readAll(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  let text = '';
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe('prependMindosSseStatusEvent', () => {
  it('emits exactly one visible status frame before the lane output', async () => {
    const lane = sseResponse(['data:{"type":"text_delta","delta":"hi"}\n\n']);
    const wrapped = prependMindosSseStatusEvent(lane, 'Reasoning effort "turbo" is not supported; using the runtime default.');

    const text = await readAll(wrapped);
    const expectedPrefix = encodeMindosSseEvent({
      type: 'status',
      message: 'Reasoning effort "turbo" is not supported; using the runtime default.',
      visible: true,
    });
    expect(text.startsWith(expectedPrefix)).toBe(true);
    expect(text.slice(expectedPrefix.length)).toBe('data:{"type":"text_delta","delta":"hi"}\n\n');
    expect(text.split('data:').length - 1).toBe(2);
    expect(wrapped.headers.get('content-type')).toContain('text/event-stream');
    expect(wrapped.status).toBe(200);
  });

  it('passes non-SSE responses through untouched (JSON error replies keep their body)', async () => {
    const json = new Response('{"error":"bad"}', { status: 400, headers: { 'Content-Type': 'application/json' } });
    expect(prependMindosSseStatusEvent(json, 'notice')).toBe(json);
    expect(await json.text()).toBe('{"error":"bad"}');
  });

  it('passes through when there is no notice or no body', () => {
    const lane = sseResponse(['data:{"type":"done"}\n\n']);
    expect(prependMindosSseStatusEvent(lane, undefined)).toBe(lane);
    const bodyless = new Response(null, { headers: { 'Content-Type': 'text/event-stream' } });
    expect(prependMindosSseStatusEvent(bodyless, 'notice')).toBe(bodyless);
  });
});

describe('normalizeAgentSessionTurnBody effortNotice forwarding', () => {
  it('forwards the effort fallback notice for an unknown reasoning effort on a known runtime kind', () => {
    const result = normalizeAgentSessionTurnBody({
      message: { text: 'hello' },
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeOptions: { reasoningEffort: 'turbo' },
    }, 'ses-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.effortNotice).toBe('string');
    expect(result.effortNotice).toContain('turbo');
    // The unsupported effort must not reach the runtime body.
    expect((result.body as { runtimeOptions?: { reasoningEffort?: string } }).runtimeOptions?.reasoningEffort).toBeUndefined();
  });

  it('omits effortNotice for a supported effort level', () => {
    const result = normalizeAgentSessionTurnBody({
      message: { text: 'hello' },
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeOptions: { reasoningEffort: 'high' },
    }, 'ses-2');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effortNotice).toBeUndefined();
  });

  it('still reports invalid bodies without a notice', () => {
    const result = normalizeAgentSessionTurnBody({ bogusField: 1 }, 'ses-3');
    expect(result.ok).toBe(false);
  });
});
