import { describe, expect, it } from 'vitest';
import { appendSummaryStreamChunk, consumeSummaryStream } from '@/components/renderers/summary/SummaryRenderer';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

describe('appendSummaryStreamChunk', () => {
  it('accumulates text_delta and thinking_delta frames', () => {
    const text = appendSummaryStreamChunk('', [
      'data:{"type":"text_delta","delta":"Hello "}',
      '',
      'data:{"type":"thinking_delta","delta":"world"}',
      '',
    ].join('\n'));
    expect(text).toBe('Hello world');
  });

  it('starts from the existing accumulator', () => {
    expect(appendSummaryStreamChunk('abc', 'data:{"type":"text_delta","delta":"d"}\n\n')).toBe('abcd');
  });

  it('accepts data: frames with a leading space', () => {
    expect(appendSummaryStreamChunk('', 'data: {"type":"text_delta","delta":"Spaced"}\n\n')).toBe('Spaced');
  });

  it('throws the message from an error frame', () => {
    expect(() => appendSummaryStreamChunk('', 'data:{"type":"error","message":"Model failed"}\n\n'))
      .toThrow('Model failed');
    expect(() => appendSummaryStreamChunk('', 'data:{"type":"error"}\n\n')).toThrow('Stream error');
  });

  it('appends legacy 0:"..." lines with escapes decoded', () => {
    expect(appendSummaryStreamChunk('', '0:"Hi\\n"\n0:"\\"there\\""\n')).toBe('Hi\n"there"');
  });

  it('ignores d: and e: metadata lines and malformed data frames', () => {
    expect(appendSummaryStreamChunk('', 'd:{"finishReason":"stop"}\ne:{"x":1}\ndata:{bad}\n\n')).toBe('');
  });

  it('appends plain text lines as a fallback', () => {
    expect(appendSummaryStreamChunk('', 'plain text')).toBe('plain text');
  });

  it('ignores non-text frames', () => {
    expect(appendSummaryStreamChunk('', 'data:{"type":"tool_start","toolName":"read_file"}\n\n')).toBe('');
  });
});

describe('consumeSummaryStream', () => {
  it('calls onUpdate with growing accumulators and resolves with the final text', async () => {
    const updates: string[] = [];
    const result = await consumeSummaryStream(streamFrom([
      'data:{"type":"text_delta","delta":"A"}\n\n',
      'data:{"type":"thinking_delta","delta":"B"}\n\ndata:{"type":"text_delta","delta":"C"}\n\n',
    ]), (acc) => { updates.push(acc); });

    expect(updates).toEqual(['A', 'AB', 'ABC']);
    expect(result).toBe('ABC');
  });

  it('accumulates a frame split across chunks', async () => {
    const result = await consumeSummaryStream(streamFrom([
      'data:{"type":"text_delta",',
      '"delta":"Split"}\n',
      '\n',
    ]), () => {});
    expect(result).toBe('Split');
  });

  it('processes a trailing frame without a closing blank line', async () => {
    const result = await consumeSummaryStream(streamFrom(['data:{"type":"text_delta","delta":"Tail"}']), () => {});
    expect(result).toBe('Tail');
  });

  it('rejects with the message from an error frame', async () => {
    await expect(consumeSummaryStream(streamFrom([
      'data:{"type":"text_delta","delta":"partial"}\n\n',
      'data:{"type":"error","message":"Model failed"}\n\n',
    ]), () => {})).rejects.toThrow('Model failed');
  });

  it('accumulates legacy 0:"..." lines', async () => {
    const updates: string[] = [];
    const result = await consumeSummaryStream(streamFrom(['0:"Legacy "\n', '0:"stream"\n']), (acc) => { updates.push(acc); });
    expect(updates).toEqual(['Legacy ', 'Legacy stream']);
    expect(result).toBe('Legacy stream');
  });

  it('stops reading once the abort signal fires', async () => {
    const controller = new AbortController();
    const result = await consumeSummaryStream(streamFrom([
      'data:{"type":"text_delta","delta":"first"}\n\n',
      'data:{"type":"text_delta","delta":" second"}\n\n',
    ]), () => { controller.abort(); }, controller.signal);
    expect(result).toBe('first');
  });
});
