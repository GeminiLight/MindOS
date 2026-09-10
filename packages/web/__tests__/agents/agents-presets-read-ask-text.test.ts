import { describe, expect, it } from 'vitest';
import { readAskTextResponse } from '@/components/agents/AgentsPresetsSection';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function streamResponse(chunks: string[]): Response {
  return { body: streamFrom(chunks) } as unknown as Response;
}

describe('readAskTextResponse', () => {
  it('falls back to res.text() when the response has no body', async () => {
    const res = { body: null, text: async () => '  plain answer  ' } as unknown as Response;
    await expect(readAskTextResponse(res)).resolves.toBe('  plain answer  ');
  });

  it('returns an empty string when there is no body and no text()', async () => {
    await expect(readAskTextResponse({ body: null } as unknown as Response)).resolves.toBe('');
  });

  it('accumulates text_delta frames and trims the output', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data:{"type":"text_delta","delta":"  Hello "}\n\n',
      'data:{"type":"text_delta","delta":"world  "}\n\n',
      'data:{"type":"done"}\n\n',
    ]))).resolves.toBe('Hello world');
  });

  it('accumulates a frame split across chunks', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data:{"type":"text_delta",',
      '"delta":"Split"}\n\n',
    ]))).resolves.toBe('Split');
  });

  it('accepts data: frames with a leading space and skips the [DONE] sentinel', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data: {"type":"text_delta","delta":"Spaced"}\n\n',
      'data: [DONE]\n\n',
    ]))).resolves.toBe('Spaced');
  });

  it('skips malformed frames and non-text events', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data:{bad json}\n\n',
      'data:{"type":"tool_start","toolName":"read_file"}\n\n',
      'data:{"type":"text_delta","delta":"ok"}\n\n',
    ]))).resolves.toBe('ok');
  });

  it('throws event.error for error events', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data:{"type":"error","error":"quota exceeded","message":"ignored"}\n\n',
    ]))).rejects.toThrow('quota exceeded');
  });

  it('throws event.message for error events without an error field', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data:{"type":"error","message":"model failed"}\n\n',
    ]))).rejects.toThrow('model failed');
  });

  it('ignores error events that carry neither error nor message', async () => {
    await expect(readAskTextResponse(streamResponse([
      'data:{"type":"error"}\n\n',
      'data:{"type":"text_delta","delta":"still fine"}\n\n',
    ]))).resolves.toBe('still fine');
  });
});
