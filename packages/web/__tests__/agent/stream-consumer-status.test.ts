/**
 * Tests for consumeUIMessageStream handling of 'status' SSE events.
 *
 * Status events are sent by the backend during retry attempts to inform
 * the frontend about the retry state. Previously, these were silently
 * ignored. After the fix, they should surface as text in the message.
 */
import { describe, it, expect, vi } from 'vitest';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import type { ToolCallPart } from '@/lib/types';

/** Helper: encode SSE events into a ReadableStream */
function makeStream(...events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const evt of events) {
        controller.enqueue(encoder.encode(`data:${JSON.stringify(evt)}\n\n`));
      }
      controller.close();
    },
  });
}

describe('consumeUIMessageStream — status event handling', () => {
  it('ignores status events when no text has been emitted yet (silent reconnect)', async () => {
    // Status-only stream (no text_delta, no done) — after the fix,
    // status events should NOT appear as visible text in the message
    // because they are transient UI state, not conversation content.
    // The frontend AskContent handles reconnect UI via loadingPhase state.
    const stream = makeStream(
      { type: 'status', message: 'Request failed, retrying (1/3)...' },
      { type: 'done' },
    );
    const updates: string[] = [];
    const result = await consumeUIMessageStream(stream, (msg) => {
      updates.push(msg.content);
    });
    // Status messages should NOT appear in the conversation content
    expect(result.content).toBe('');
    expect(result.parts).toEqual([]);
  });

  it('processes text_delta events normally', async () => {
    const stream = makeStream(
      { type: 'text_delta', delta: 'Hello, ' },
      { type: 'text_delta', delta: 'world!' },
      { type: 'done' },
    );
    const result = await consumeUIMessageStream(stream, vi.fn());
    expect(result.content).toBe('Hello, world!');
  });

  it('handles stream with status event followed by successful text', async () => {
    const stream = makeStream(
      { type: 'status', message: 'Request failed, retrying (1/3)...' },
      { type: 'text_delta', delta: 'Response after retry' },
      { type: 'done' },
    );
    const result = await consumeUIMessageStream(stream, vi.fn());
    // Status should not appear, only the actual response text
    expect(result.content).toBe('Response after retry');
  });

  it('handles error event by adding error text to message', async () => {
    const stream = makeStream(
      { type: 'error', message: 'LLM API unavailable' },
    );
    const result = await consumeUIMessageStream(stream, vi.fn());
    expect(result.content).toContain('LLM API unavailable');
  });

  it('handles malformed SSE lines gracefully', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data:{bad json}\n\n'));
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ type: 'text_delta', delta: 'ok' })}\n\n`));
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ type: 'done' })}\n\n`));
        controller.close();
      },
    });
    const result = await consumeUIMessageStream(stream, vi.fn());
    expect(result.content).toBe('ok');
  });

  it('finalizes pending tool calls when stream ends unexpectedly', async () => {
    const stream = makeStream(
      { type: 'tool_start', toolCallId: 'tc1', toolName: 'read_file', args: { path: 'a.md' } },
      // stream ends without tool_end or done
    );
    const updates: Array<{ parts?: unknown[] }> = [];
    const result = await consumeUIMessageStream(stream, (msg) => { updates.push(msg as { parts?: unknown[] }); });
    // After unexpected stream end, the tool call part should be finalized to 'error' state.
    // Check both the last onUpdate emission and the final returned message.
    const allParts = [
      ...(updates[updates.length - 1]?.parts ?? []),
      ...(result.parts ?? []),
    ];
    const toolPart = allParts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(toolPart?.state).toBe('error');
  });
});
