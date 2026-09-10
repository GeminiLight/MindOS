import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAiAvailable, consumeSpaceAiInitStream, findSpaceAiInitStreamError } from '@/lib/space-ai-init';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

describe('space AI init stream handling', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the active provider from the current settings payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ai: {
          activeProvider: 'p_openai01',
          providers: [
            { id: 'p_anthro01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
            { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-openai-test', model: 'gpt-5.4', baseUrl: '' },
          ],
        },
        envOverrides: {},
      }),
    }));

    await expect(checkAiAvailable()).resolves.toBe(true);
  });

  it('uses provider env fallback from the current settings payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ai: {
          activeProvider: 'p_anthro01',
          providers: [
            { id: 'p_anthro01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
          ],
        },
        envOverrides: { ANTHROPIC_API_KEY: true },
      }),
    }));

    await expect(checkAiAvailable()).resolves.toBe(true);
  });

  it('checks an explicit provider override even when the active provider has no key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ai: {
          activeProvider: 'p_anthro01',
          providers: [
            { id: 'p_anthro01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
            { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-openai-test', model: 'gpt-5.4', baseUrl: '' },
          ],
        },
        envOverrides: {},
      }),
    }));

    await expect(checkAiAvailable('p_openai01')).resolves.toBe(true);
  });

  it('detects MindOS SSE error events', () => {
    expect(findSpaceAiInitStreamError('data:{"type":"error","message":"No API key"}\n\n'))
      .toBe('No API key');
  });

  it('throws while draining a failed init stream', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"text_delta","delta":"Starting"}\n\n',
      'data:{"type":"error","message":"Model failed"}\n\n',
    ]))).rejects.toThrow('Model failed');
  });

  it('ignores malformed non-error stream lines', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{bad json}\n',
      'data:{"type":"done"}\n',
    ]))).resolves.toBeUndefined();
  });

  it('detects error events written as data: with a leading space', () => {
    expect(findSpaceAiInitStreamError('data: {"type":"error","message":"Spaced"}\n\n')).toBe('Spaced');
  });

  it('returns null when no error frame is present', () => {
    expect(findSpaceAiInitStreamError('data:{"type":"text_delta","delta":"hi"}\n\ndata:{"type":"done"}\n\n')).toBeNull();
    expect(findSpaceAiInitStreamError('')).toBeNull();
  });

  it('detects an error frame split across two chunks', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"error",',
      '"message":"Split failure"}\n\n',
    ]))).rejects.toThrow('Split failure');
  });

  it('detects an error frame with CRLF line endings', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"text_delta","delta":"x"}\r\n\r\n',
      'data:{"type":"error","message":"CRLF failure"}\r\n\r\n',
    ]))).rejects.toThrow('CRLF failure');
  });

  it('detects an error spread over multiple data lines', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"error",\n',
      'data:"message":"Multi-line failure"}\n\n',
    ]))).rejects.toThrow('Multi-line failure');
  });

  it('ignores non-error frames while draining', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"text_delta","delta":"Writing"}\n\n',
      'data:{"type":"tool_start","toolName":"write_file","toolCallId":"t1"}\n\n',
      'data:{"type":"tool_end","toolCallId":"t1"}\n\n',
      'data:{"type":"done"}\n\n',
    ]))).resolves.toBeUndefined();
  });

  it('detects a trailing error frame that has no closing blank line', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"done"}\n\n',
      'data:{"type":"error","message":"Tail failure"}',
    ]))).rejects.toThrow('Tail failure');
  });

  it('falls back to a generic message when the error frame has no message', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"error"}\n\n',
    ]))).rejects.toThrow('AI initialization failed');
  });
});
