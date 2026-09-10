import { describe, expect, it } from 'vitest';
import {
  createSseParser,
  createUtf8StreamDecoder,
  type SseFrame,
} from '@/lib/sse-parser';

const encoder = new TextEncoder();

function collect(): { frames: SseFrame[]; parser: ReturnType<typeof createSseParser> } {
  const frames: SseFrame[] = [];
  const parser = createSseParser((frame) => frames.push(frame));
  return { frames, parser };
}

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe('createSseParser', () => {
  it('dispatches id / event / data frames and keeps lastEventId across events', () => {
    const { frames, parser } = collect();
    parser.push(bytes('id: 7\nevent: tree.changed\ndata: {"type":"tree.changed","version":3}\n\n'));
    parser.push(bytes('event: heartbeat\ndata: {"type":"heartbeat"}\n\n'));

    expect(frames).toEqual([
      { event: 'tree.changed', data: '{"type":"tree.changed","version":3}', lastEventId: '7' },
      { event: 'heartbeat', data: '{"type":"heartbeat"}', lastEventId: '7' },
    ]);
  });

  it('defaults the event name to message and strips exactly one leading space from values', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data:  two spaces\n\n'));
    parser.push(bytes('data:no space\n\n'));

    expect(frames.map((frame) => [frame.event, frame.data])).toEqual([
      ['message', ' two spaces'],
      ['message', 'no space'],
    ]);
  });

  it('joins multi-line data with newlines', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data: first\ndata: second\ndata:\ndata: fourth\n\n'));

    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe('first\nsecond\n\nfourth');
  });

  it('reassembles a data line that is split across chunks and dispatches it once', () => {
    const { frames, parser } = collect();
    parser.push(bytes('event: agent-run.ev'));
    parser.push(bytes('ent\ndata: {"type":"agent-run.event","run'));
    parser.push(bytes('Id":"r1"}\n'));
    expect(frames).toHaveLength(0);
    parser.push(bytes('\n'));

    expect(frames).toEqual([
      { event: 'agent-run.event', data: '{"type":"agent-run.event","runId":"r1"}', lastEventId: '' },
    ]);
  });

  it('reassembles a multi-byte UTF-8 character split across chunks (built-in decoder)', () => {
    const { frames, parser } = collect();
    const text = 'data: 知识库\n\n';
    const encoded = bytes(text);
    // "知" is 3 bytes; cut after the first byte of it (after "data: " = 6 bytes).
    parser.push(encoded.slice(0, 7));
    parser.push(encoded.slice(7, 10));
    parser.push(encoded.slice(10));

    expect(frames).toEqual([{ event: 'message', data: '知识库', lastEventId: '' }]);
  });

  it('reassembles a 4-byte emoji split across chunks', () => {
    const { frames, parser } = collect();
    const encoded = bytes('data: a😀b\n\n');
    for (let i = 0; i < encoded.length; i += 1) parser.push(encoded.slice(i, i + 1));

    expect(frames).toEqual([{ event: 'message', data: 'a😀b', lastEventId: '' }]);
  });

  it('treats CRLF as one line terminator', () => {
    const { frames, parser } = collect();
    parser.push(bytes('id: 1\r\nevent: x\r\ndata: a\r\n\r\n'));

    expect(frames).toEqual([{ event: 'x', data: 'a', lastEventId: '1' }]);
  });

  it('treats a bare CR as a line terminator', () => {
    const { frames, parser } = collect();
    parser.push(bytes('event: x\rdata: a\r\r'));

    expect(frames).toEqual([{ event: 'x', data: 'a', lastEventId: '' }]);
  });

  it('does not emit an empty line when CR ends one chunk and LF starts the next', () => {
    const { frames, parser } = collect();
    parser.push(bytes('event: x\r'));
    parser.push(bytes('\ndata: a\r'));
    parser.push(bytes('\n\r\n'));

    expect(frames).toEqual([{ event: 'x', data: 'a', lastEventId: '' }]);
  });

  it('ignores comment lines such as heartbeats and does not dispatch for them', () => {
    const { frames, parser } = collect();
    parser.push(bytes(': keep-alive\n\n'));
    parser.push(bytes(':\n: another\ndata: real\n\n'));

    expect(frames).toEqual([{ event: 'message', data: 'real', lastEventId: '' }]);
  });

  it('records a numeric retry field and ignores a non-numeric one', () => {
    const { frames, parser } = collect();
    parser.push(bytes('retry: 5000\ndata: a\n\n'));
    parser.push(bytes('retry: soon\ndata: b\n\n'));

    expect(frames[0].retryMs).toBe(5000);
    expect(frames[1].retryMs).toBeUndefined();
  });

  it('applies an id from a block without data but does not dispatch that block', () => {
    const { frames, parser } = collect();
    parser.push(bytes('id: 42\n\n'));
    expect(frames).toHaveLength(0);
    parser.push(bytes('data: later\n\n'));

    expect(frames).toEqual([{ event: 'message', data: 'later', lastEventId: '42' }]);
  });

  it('ignores an id containing NUL', () => {
    const { frames, parser } = collect();
    parser.push(bytes('id: 5\ndata: a\n\n'));
    parser.push(bytes('id: 6\u0000\ndata: b\n\n'));

    expect(frames.map((frame) => frame.lastEventId)).toEqual(['5', '5']);
  });

  it('treats a line without a colon as a field name with an empty value', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data\n\n'));
    parser.push(bytes('data\ndata: x\n\n'));

    expect(frames.map((frame) => frame.data)).toEqual(['', '\nx']);
  });

  it('resets the event name after each dispatch', () => {
    const { frames, parser } = collect();
    parser.push(bytes('event: custom\ndata: a\n\ndata: b\n\n'));

    expect(frames.map((frame) => frame.event)).toEqual(['custom', 'message']);
  });

  it('strips a leading byte order mark', () => {
    const { frames, parser } = collect();
    parser.push(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('data: a\n\n')]));

    expect(frames).toEqual([{ event: 'message', data: 'a', lastEventId: '' }]);
  });

  it('accepts string chunks as well as bytes', () => {
    const { frames, parser } = collect();
    parser.push('data: from');
    parser.push(' string\n\n');

    expect(frames).toEqual([{ event: 'message', data: 'from string', lastEventId: '' }]);
  });

  it('discards an incomplete event on end()', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data: partial\n'));
    parser.end();
    parser.push(bytes('\n'));

    expect(frames).toHaveLength(0);
  });

  it('flush() dispatches a pending block whose last line has no terminator', () => {
    const { frames, parser } = collect();
    parser.push(bytes('event: x\ndata: first\ndata: sec'));
    parser.push(bytes('ond'));
    expect(frames).toHaveLength(0);
    parser.flush();

    expect(frames).toEqual([{ event: 'x', data: 'first\nsecond', lastEventId: '' }]);
  });

  it('flush() dispatches a block that ended with a newline but no blank line', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data: {"type":"done"}\n'));
    parser.flush();

    expect(frames).toEqual([{ event: 'message', data: '{"type":"done"}', lastEventId: '' }]);
  });

  it('flush() dispatches nothing when no data is pending and leaves the parser usable', () => {
    const { frames, parser } = collect();
    parser.flush();
    parser.push(bytes('data: a\n\n'));
    parser.flush();
    parser.push(bytes(': comment'));
    parser.flush();
    parser.push(bytes('id: 9'));
    parser.flush();

    expect(frames).toEqual([{ event: 'message', data: 'a', lastEventId: '' }]);
  });

  it('flush() does not dispatch the same block twice', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data: once'));
    parser.flush();
    parser.flush();
    parser.push(bytes('\n\n'));

    expect(frames).toEqual([{ event: 'message', data: 'once', lastEventId: '' }]);
  });

  it('flush() handles a trailing CR without emitting a stray empty line', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data: a\r'));
    parser.flush();

    expect(frames).toEqual([{ event: 'message', data: 'a', lastEventId: '' }]);
  });

  it('end() discards an unterminated trailing line instead of dispatching it', () => {
    const { frames, parser } = collect();
    parser.push(bytes('data: partial'));
    parser.end();
    parser.push(bytes('\n\n'));

    expect(frames).toHaveLength(0);
  });

  it('handles an empty chunk and a very long data line', () => {
    const { frames, parser } = collect();
    const long = 'x'.repeat(64 * 1024);
    parser.push(new Uint8Array(0));
    parser.push(bytes(`data: ${long}\n\n`));

    expect(frames).toHaveLength(1);
    expect(frames[0].data).toHaveLength(long.length);
  });
});

describe('createUtf8StreamDecoder', () => {
  it('decodes ASCII and multi-byte sequences identically with and without TextDecoder', () => {
    const sample = bytes('plain ASCII, 中文, emoji 😀, ñ');
    const native = createUtf8StreamDecoder({ useTextDecoder: true });
    const builtIn = createUtf8StreamDecoder({ useTextDecoder: false });

    expect(native.decode(sample, false)).toBe('plain ASCII, 中文, emoji 😀, ñ');
    expect(builtIn.decode(sample, false)).toBe('plain ASCII, 中文, emoji 😀, ñ');
  });

  it('holds back an incomplete trailing sequence until the next chunk (built-in decoder)', () => {
    const decoder = createUtf8StreamDecoder({ useTextDecoder: false });
    const encoded = bytes('é');

    expect(decoder.decode(encoded.slice(0, 1), true)).toBe('');
    expect(decoder.decode(encoded.slice(1), true)).toBe('é');
  });

  it('replaces invalid bytes with U+FFFD instead of throwing (built-in decoder)', () => {
    const decoder = createUtf8StreamDecoder({ useTextDecoder: false });

    expect(decoder.decode(new Uint8Array([0x61, 0xff, 0x62]), false)).toBe('a�b');
    expect(decoder.decode(new Uint8Array([0xe4, 0xb8]), false)).toBe('�');
  });

  it('flushes a dangling partial sequence as U+FFFD when the stream ends', () => {
    const decoder = createUtf8StreamDecoder({ useTextDecoder: false });
    decoder.decode(new Uint8Array([0xe4]), true);

    expect(decoder.decode(new Uint8Array(0), false)).toBe('�');
  });
});
