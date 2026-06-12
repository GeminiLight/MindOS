/**
 * consumeUIMessageStream — emit coalescing and structural sharing.
 *
 * Streaming runs can deliver hundreds of SSE chunks per second; emitting a
 * deep-cloned message per chunk made rendering O(L²). The consumer must:
 *  - coalesce onUpdate emissions (leading emit + ~50ms trailing window),
 *  - always flush the final state immediately on completion/error/abort,
 *  - reuse part object identities for parts that did not change between
 *    emissions (structural sharing) so memoized children skip re-render,
 *  - batch files-changed notifications into one event per run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import type { Message, ToolCallPart } from '@/lib/types';

function encodeEvent(evt: object): Uint8Array {
  return new TextEncoder().encode(`data:${JSON.stringify(evt)}\n\n`);
}

/** Closed stream delivering each event as its own chunk (own read batch). */
function makeStream(...events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const evt of events) controller.enqueue(encodeEvent(evt));
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('consumeUIMessageStream — emit coalescing', () => {
  it('bounds emit count for a rapid chunk burst and still delivers the full final text', async () => {
    const events = Array.from({ length: 200 }, (_, i) => ({ type: 'text_delta', delta: `c${i} ` }));
    const onUpdate = vi.fn();

    const result = await consumeUIMessageStream(makeStream(...events, { type: 'done' }), onUpdate);

    // With time frozen, only the leading emit and the completion flush fire.
    expect(onUpdate.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);

    const expected = events.map(e => e.delta).join('');
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as Message;
    expect(last.content).toBe(expected);
    expect(result.content).toBe(expected);
  });

  it('emits a trailing coalesced update while the stream stays open', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const onUpdate = vi.fn();
    const finished = consumeUIMessageStream(stream, onUpdate);

    controller.enqueue(encodeEvent({ type: 'text_delta', delta: 'first ' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1); // leading emit
    expect((onUpdate.mock.calls[0][0] as Message).content).toBe('first ');

    controller.enqueue(encodeEvent({ type: 'text_delta', delta: 'second ' }));
    controller.enqueue(encodeEvent({ type: 'text_delta', delta: 'third' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1); // still within the window

    await vi.advanceTimersByTimeAsync(60); // trailing timer fires
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect((onUpdate.mock.calls[1][0] as Message).content).toBe('first second third');

    controller.close();
    await finished;
  });

  it('flushes pending coalesced state immediately when the stream completes', async () => {
    const onUpdate = vi.fn();
    await consumeUIMessageStream(
      makeStream(
        { type: 'text_delta', delta: 'a' },
        { type: 'text_delta', delta: 'b' },
        { type: 'done' },
      ),
      onUpdate,
    );
    // No timer was advanced — completion itself must have flushed 'ab'.
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as Message;
    expect(last.content).toBe('ab');
  });

  it('flushes pending coalesced state on the error path before rejecting', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const onUpdate = vi.fn();
    const finished = consumeUIMessageStream(stream, onUpdate);

    controller.enqueue(encodeEvent({ type: 'text_delta', delta: 'partial ' }));
    controller.enqueue(encodeEvent({ type: 'text_delta', delta: 'answer' }));
    await vi.advanceTimersByTimeAsync(0);
    controller.error(new Error('network reset'));

    await expect(finished).rejects.toThrow('network reset');
    const last = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as Message;
    expect(last.content).toBe('partial answer');

    // No stray timer may emit after the run ended.
    const callsAfterReject = onUpdate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate.mock.calls.length).toBe(callsAfterReject);
  });

  it('emits per batch when emitCoalesceMs is 0 (opt-out for fine-grained consumers)', async () => {
    const onUpdate = vi.fn();
    await consumeUIMessageStream(
      makeStream(
        { type: 'text_delta', delta: 'a' },
        { type: 'text_delta', delta: 'b' },
        { type: 'text_delta', delta: 'c' },
        { type: 'done' },
      ),
      onUpdate,
      undefined,
      { emitCoalesceMs: 0 },
    );
    const contents = onUpdate.mock.calls.map(call => (call[0] as Message).content);
    expect(contents).toContain('a');
    expect(contents).toContain('ab');
    expect(contents).toContain('abc');
  });
});

describe('consumeUIMessageStream — structural sharing across emissions', () => {
  it('keeps object identity for parts that did not change between updates', async () => {
    const updates: Message[] = [];
    await consumeUIMessageStream(
      makeStream(
        { type: 'tool_start', toolCallId: 'tc1', toolName: 'read_file', args: { path: 'a.md' } },
        { type: 'tool_end', toolCallId: 'tc1', output: 'file content', isError: false },
        { type: 'text_delta', delta: 'Answer ' },
        { type: 'text_delta', delta: 'text' },
        { type: 'done' },
      ),
      (msg) => updates.push(msg),
      undefined,
      { emitCoalesceMs: 0 },
    );

    // Find consecutive updates after the tool finished, while text streams.
    const textUpdates = updates.filter(u => u.parts.some(p => p.type === 'text'));
    expect(textUpdates.length).toBeGreaterThanOrEqual(2);
    const [u1, u2] = textUpdates.slice(-2);

    const tool1 = u1.parts.find((p): p is ToolCallPart => p.type === 'tool-call');
    const tool2 = u2.parts.find((p): p is ToolCallPart => p.type === 'tool-call');
    expect(tool1).toBeDefined();
    // Unchanged tool part keeps its identity → memoized children skip re-render.
    expect(tool2).toBe(tool1);

    // The actively-growing text part must be a fresh object with new content.
    const text1 = u1.parts.find(p => p.type === 'text');
    const text2 = u2.parts.find(p => p.type === 'text');
    expect(text2).not.toBe(text1);

    // Snapshots are immutable: earlier update still holds the older text.
    expect(text1 && 'text' in text1 ? text1.text : '').toBe('Answer ');
    expect(text2 && 'text' in text2 ? text2.text : '').toBe('Answer text');
  });

  it('re-clones a tool part when it changes again after being shared', async () => {
    const updates: Message[] = [];
    await consumeUIMessageStream(
      makeStream(
        { type: 'tool_start', toolCallId: 'tc1', toolName: 'Bash', args: { command: 'ls' } },
        { type: 'tool_delta', toolCallId: 'tc1', delta: 'out1' },
        { type: 'tool_delta', toolCallId: 'tc1', delta: 'out2' },
        { type: 'done' },
      ),
      (msg) => updates.push(msg),
      undefined,
      { emitCoalesceMs: 0 },
    );

    const toolParts = updates.map(u => u.parts.find((p): p is ToolCallPart => p.type === 'tool-call'));
    const outputs = toolParts.map(p => p?.output);
    expect(outputs).toContain('out1');
    expect(outputs).toContain('out1out2');
    // Each mutation produced a fresh snapshot object.
    const withOut1 = toolParts.find(p => p?.output === 'out1');
    const withOut2 = toolParts.find(p => p?.output === 'out1out2');
    expect(withOut2).not.toBe(withOut1);
  });
});

describe('consumeUIMessageStream — batched files-changed notification', () => {
  function stubWindowEventTarget(): EventTarget {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    return target;
  }

  it('coalesces multiple file writes in one run into a single event carrying all paths', async () => {
    const windowTarget = stubWindowEventTarget();
    const received: Array<{ paths?: string[] } | null | undefined> = [];
    const handler = (e: Event) => received.push((e as CustomEvent<{ paths?: string[] }>).detail);
    windowTarget.addEventListener('mindos:files-changed', handler);

    try {
      await consumeUIMessageStream(
        makeStream(
          { type: 'tool_start', toolCallId: 't1', toolName: 'write_file', args: { path: 'a.md', content: 'x' } },
          { type: 'tool_end', toolCallId: 't1', output: 'ok', isError: false },
          { type: 'tool_start', toolCallId: 't2', toolName: 'create_file', args: { path: 'b.md', content: 'y' } },
          { type: 'tool_end', toolCallId: 't2', output: 'ok', isError: false },
          { type: 'tool_start', toolCallId: 't3', toolName: 'move_file', args: { from_path: 'c.md', to_path: 'd/c.md' } },
          { type: 'tool_end', toolCallId: 't3', output: 'ok', isError: false },
          { type: 'done' },
        ),
        vi.fn(),
      );

      expect(received).toHaveLength(1);
      expect(received[0]?.paths?.slice().sort()).toEqual(['a.md', 'b.md', 'c.md', 'd/c.md']);
    } finally {
      windowTarget.removeEventListener('mindos:files-changed', handler);
    }
  });

  it('includes batch_create_files paths and rename targets', async () => {
    const windowTarget = stubWindowEventTarget();
    const received: Array<{ paths?: string[] } | null | undefined> = [];
    const handler = (e: Event) => received.push((e as CustomEvent<{ paths?: string[] }>).detail);
    windowTarget.addEventListener('mindos:files-changed', handler);

    try {
      await consumeUIMessageStream(
        makeStream(
          {
            type: 'tool_start',
            toolCallId: 't1',
            toolName: 'batch_create_files',
            args: { files: [{ path: 'x/one.md', content: '' }, { path: 'x/two.md', content: '' }] },
          },
          { type: 'tool_end', toolCallId: 't1', output: 'ok', isError: false },
          {
            type: 'tool_start',
            toolCallId: 't2',
            toolName: 'rename_file',
            args: { path: 'docs/old.md', new_name: 'new.md' },
          },
          { type: 'tool_end', toolCallId: 't2', output: 'ok', isError: false },
          { type: 'done' },
        ),
        vi.fn(),
      );

      expect(received).toHaveLength(1);
      expect(received[0]?.paths?.slice().sort()).toEqual([
        'docs/new.md', 'docs/old.md', 'x/one.md', 'x/two.md',
      ]);
    } finally {
      windowTarget.removeEventListener('mindos:files-changed', handler);
    }
  });

  it('emits without paths when a mutating tool has no recognizable path input', async () => {
    const windowTarget = stubWindowEventTarget();
    const received: Array<{ paths?: string[] } | null | undefined> = [];
    const handler = (e: Event) => received.push((e as CustomEvent<{ paths?: string[] }>).detail);
    windowTarget.addEventListener('mindos:files-changed', handler);

    try {
      await consumeUIMessageStream(
        makeStream(
          { type: 'tool_start', toolCallId: 't1', toolName: 'create_space', args: { name: 'Projects' } },
          { type: 'tool_end', toolCallId: 't1', output: 'ok', isError: false },
          { type: 'done' },
        ),
        vi.fn(),
      );

      expect(received).toHaveLength(1);
      expect(received[0]?.paths).toBeUndefined();
    } finally {
      windowTarget.removeEventListener('mindos:files-changed', handler);
    }
  });
});
