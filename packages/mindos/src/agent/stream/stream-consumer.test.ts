/**
 * Behavior tests for the core SSE stream consumer
 * (spec-agent-core-consolidation Wave 4). The web package keeps its own
 * stream-consumer contract tests against the adapter (coalescing, status,
 * user-question, cancel); these tests pin the core behaviors plus the
 * host-injection seam (filesChanged) that the adapter wires to the browser
 * files-changed emitter.
 */
import { describe, expect, it, vi } from 'vitest';
import { consumeUIMessageStream } from './stream-consumer.js';
import type { Message, ToolCallPart } from './stream-message-types.js';

function encodeEvent(evt: object): Uint8Array {
  return new TextEncoder().encode(`data:${JSON.stringify(evt)}\n\n`);
}

/** Closed stream delivering each event as its own chunk. */
function makeStream(...events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const evt of events) controller.enqueue(encodeEvent(evt));
      controller.close();
    },
  });
}

function toolCalls(message: Message): ToolCallPart[] {
  return (message.parts ?? []).filter((part): part is ToolCallPart => part.type === 'tool-call');
}

describe('consumeUIMessageStream (core)', () => {
  it('assembles text and reasoning deltas into ordered parts', async () => {
    const result = await consumeUIMessageStream(makeStream(
      { type: 'thinking_delta', delta: 'pondering ' },
      { type: 'thinking_delta', delta: 'deeply' },
      { type: 'text_delta', delta: 'Hello ' },
      { type: 'text_delta', delta: 'world' },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    expect(result.role).toBe('assistant');
    expect(result.content).toBe('Hello world');
    expect(result.parts).toEqual([
      { type: 'reasoning', text: 'pondering deeply' },
      { type: 'text', text: 'Hello world' },
    ]);
  });

  it('tracks the tool lifecycle and preserves streamed output over generic completion markers', async () => {
    const result = await consumeUIMessageStream(makeStream(
      { type: 'tool_start', toolCallId: 't1', toolName: 'read_file', args: { path: 'notes.md' } },
      { type: 'tool_delta', toolCallId: 't1', delta: 'file contents' },
      { type: 'tool_end', toolCallId: 't1', output: 'Codex item completed' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    expect(toolCalls(result)).toEqual([
      expect.objectContaining({
        toolCallId: 't1',
        toolName: 'read_file',
        input: { path: 'notes.md' },
        state: 'done',
        output: 'file contents',
      }),
    ]);
  });

  it('queues mutated paths into the injected filesChanged sink and flushes once at stream end', async () => {
    const queue = vi.fn();
    const flush = vi.fn();

    await consumeUIMessageStream(makeStream(
      { type: 'tool_start', toolCallId: 'w1', toolName: 'write_file', args: { path: 'a.md' } },
      { type: 'tool_end', toolCallId: 'w1', output: 'ok' },
      { type: 'tool_start', toolCallId: 'r1', toolName: 'rename_file', args: { path: 'dir/old.md', new_name: 'new.md' } },
      { type: 'tool_end', toolCallId: 'r1', output: 'ok' },
      { type: 'tool_start', toolCallId: 'f1', toolName: 'write_file', args: { path: 'b.md' } },
      { type: 'tool_end', toolCallId: 'f1', output: 'disk full', isError: true },
      { type: 'tool_start', toolCallId: 'ro1', toolName: 'read_file', args: { path: 'c.md' } },
      { type: 'tool_end', toolCallId: 'ro1', output: 'contents' },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0, filesChanged: { queue, flush } });

    // Successful mutating tools only — failed writes and read-only tools don't notify.
    expect(queue.mock.calls).toEqual([
      [['a.md']],
      [['dir/old.md', 'dir/new.md']],
    ]);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('runs without a filesChanged sink (headless hosts)', async () => {
    const result = await consumeUIMessageStream(makeStream(
      { type: 'tool_start', toolCallId: 'w1', toolName: 'write_file', args: { path: 'a.md' } },
      { type: 'tool_end', toolCallId: 'w1', output: 'ok' },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    expect(toolCalls(result)[0]?.state).toBe('done');
  });

  it('surfaces agent_run_context and runtime_binding through the option callbacks', async () => {
    const onAgentRunContext = vi.fn();
    const onRuntimeBinding = vi.fn();

    await consumeUIMessageStream(makeStream(
      { type: 'agent_run_context', rootRunId: 'run-1', chatSessionId: 'chat-1', startedAt: 1700000000000 },
      { type: 'runtime_binding', runtime: 'mindos', externalSessionId: 'pi-session-9', cwd: '/tmp/kb', status: 'active' },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0, onAgentRunContext, onRuntimeBinding });

    expect(onAgentRunContext).toHaveBeenCalledWith({
      rootRunId: 'run-1',
      chatSessionId: 'chat-1',
      startedAt: 1700000000000,
    });
    expect(onRuntimeBinding).toHaveBeenCalledWith({
      runtime: 'mindos',
      externalSessionId: 'pi-session-9',
      cwd: '/tmp/kb',
      status: 'active',
    });
  });

  it('surfaces source-tracked context usage through the option callback', async () => {
    const onContextUsage = vi.fn();

    await consumeUIMessageStream(makeStream(
      {
        type: 'context_usage',
        runtime: 'mindos',
        phase: 'preflight',
        action: 'prompt_compacted_history_compacted',
        modelName: 'step-3.7-flash',
        percent: 42,
        usedTokens: 42_000,
        contextWindow: 100_000,
        nativeContextWindow: 256_000,
        contextTokens: 100_000,
        contextWindowSource: 'catalog',
        contextWindowIsFallback: false,
        budgetTokens: 84_000,
        reserveTokens: 16_000,
        keepRecentTokens: 20_000,
        systemPromptTokens: 10_000,
        turnPromptTokens: 12_000,
        historyTokens: 20_000,
        originalUsedTokens: 120_000,
        runtimeMessageCompaction: true,
        compactedMessages: 8,
        historyCompactTokens: 20_000,
        historyBeforeCompactTokens: 98_000,
      },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0, onContextUsage });

    expect(onContextUsage).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'mindos',
      phase: 'preflight',
      action: 'prompt_compacted_history_compacted',
      modelName: 'step-3.7-flash',
      contextWindow: 100_000,
      nativeContextWindow: 256_000,
      contextTokens: 100_000,
      contextWindowSource: 'catalog',
      contextWindowIsFallback: false,
      originalUsedTokens: 120_000,
      runtimeMessageCompaction: true,
      compactedMessages: 8,
      historyCompactTokens: 20_000,
      historyBeforeCompactTokens: 98_000,
    }));
  });

  it('captures AskUserQuestion lifecycles raised via dedicated events', async () => {
    const result = await consumeUIMessageStream(makeStream(
      {
        type: 'user_question_start',
        toolCallId: 'q1',
        runId: 'run-1',
        questions: [{
          question: 'Pick a color?',
          header: 'Color',
          options: [{ label: 'Amber', description: 'Warm' }],
        }],
      },
      {
        type: 'user_question_answered',
        toolCallId: 'q1',
        answers: [{ questionIndex: 0, question: 'Pick a color?', kind: 'option', answer: 'Amber' }],
      },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    const [tc] = toolCalls(result);
    expect(tc).toEqual(expect.objectContaining({ toolName: 'ask_user_question', state: 'done' }));
    expect(tc?.userQuestion).toEqual(expect.objectContaining({
      runId: 'run-1',
      status: 'submitted',
      questions: [expect.objectContaining({ question: 'Pick a color?', header: 'Color' })],
      answers: [expect.objectContaining({ answer: 'Amber', kind: 'option' })],
    }));
  });

  it('renders visible status events and stream errors as parts', async () => {
    const result = await consumeUIMessageStream(makeStream(
      { type: 'status', visible: true, message: 'Resuming Codex thread…', runtime: 'codex' },
      { type: 'status', visible: false, message: 'internal detail' },
      { type: 'error', message: 'upstream exploded' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    expect(result.parts).toEqual([
      { type: 'runtime-status', message: 'Resuming Codex thread…', runtime: 'codex' },
      { type: 'text', text: '\n\n**Stream Error:** upstream exploded' },
    ]);
  });

  it('finalizes dangling tool calls when the stream ends mid-execution', async () => {
    const result = await consumeUIMessageStream(makeStream(
      { type: 'tool_start', toolCallId: 'dangling', toolName: 'write_file', args: { path: 'x.md' } },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    expect(toolCalls(result)).toEqual([
      expect.objectContaining({
        toolCallId: 'dangling',
        state: 'error',
        output: 'Stream ended before tool completed',
      }),
    ]);
  });

  it('stops consuming when the abort signal fires while the stream is quiet', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      cancel() { cancelled = true; },
    });
    const abort = new AbortController();

    const finished = consumeUIMessageStream(stream, () => {}, abort.signal, { emitCoalesceMs: 0 });
    controller.enqueue(encodeEvent({ type: 'text_delta', delta: 'partial' }));
    await Promise.resolve();

    // No more chunks arrive — abort must interrupt the pending read.
    abort.abort();
    const result = await finished;

    expect(cancelled).toBe(true);
    expect(result.content).toBe('partial');
  });

  it('coalesces rapid deltas into bounded emissions while delivering full final text', async () => {
    vi.useFakeTimers();
    try {
      const events = Array.from({ length: 100 }, (_, i) => ({ type: 'text_delta', delta: `c${i} ` }));
      const onUpdate = vi.fn();

      const result = await consumeUIMessageStream(makeStream(...events, { type: 'done' }), onUpdate);

      // With time frozen, only the leading emit and the terminal flush fire.
      expect(onUpdate.mock.calls.length).toBeLessThanOrEqual(2);
      expect(result.content).toBe(events.map((e) => e.delta).join(''));
    } finally {
      vi.useRealTimers();
    }
  });
});
