import { describe, expect, it } from 'vitest';
import { consumeSpaceAiInitStream, findSpaceAiInitStreamError } from '@/lib/space-ai-init';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

describe('space AI init stream handling', () => {
  it('detects MindOS SSE error events', () => {
    expect(findSpaceAiInitStreamError('data:{"type":"error","message":"No API key"}\n\n'))
      .toBe('No API key');
  });

  it('throws while draining a failed init stream', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{"type":"text_delta","delta":"Starting"}\n',
      'data:{"type":"error","message":"Model failed"}\n\n',
    ]))).rejects.toThrow('Model failed');
  });

  it('ignores malformed non-error stream lines', async () => {
    await expect(consumeSpaceAiInitStream(streamFrom([
      'data:{bad json}\n',
      'data:{"type":"done"}\n',
    ]))).resolves.toBeUndefined();
  });
});
