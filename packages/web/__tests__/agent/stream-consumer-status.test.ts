/**
 * Tests for consumeUIMessageStream handling of 'status' SSE events.
 *
 * Status events are sent by the backend during retry attempts to inform
 * the frontend about the retry state. Visible native runtime status should
 * render as a structured message part, not assistant conversation text.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { consumeUIMessageStream } from '@/lib/agent/stream-consumer';
import type { RuntimeStatusPart, ToolCallPart } from '@/lib/types';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWindowEventTarget(): EventTarget & Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> {
  const target = new EventTarget() as EventTarget & Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;
  vi.stubGlobal('window', target);
  return target;
}

describe('consumeUIMessageStream — status event handling', () => {
  it('emits agent run context metadata without adding visible message parts', async () => {
    const onAgentRunContext = vi.fn();
    const result = await consumeUIMessageStream(
      makeStream(
        { type: 'agent_run_context', rootRunId: 'root-1', chatSessionId: 'chat-1', startedAt: 123 },
        { type: 'done' },
      ),
      vi.fn(),
      undefined,
      { onAgentRunContext },
    );

    expect(onAgentRunContext).toHaveBeenCalledWith({
      rootRunId: 'root-1',
      chatSessionId: 'chat-1',
      startedAt: 123,
    });
    expect(result.content).toBe('');
    expect(result.parts).toEqual([]);
  });

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

  it('processes a final SSE line without a trailing newline', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data:${JSON.stringify({ type: 'text_delta', delta: 'final' })}`));
        controller.close();
      },
    });

    const result = await consumeUIMessageStream(stream, vi.fn());
    expect(result.content).toBe('final');
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

  it('shows visible native runtime status events as structured runtime status parts', async () => {
    const stream = makeStream(
      {
        type: 'status',
        visible: true,
        runtime: 'claude',
        message: 'Claude Code HTTP 429; retrying (1/10). Retrying in 1s.',
      },
      { type: 'done' },
    );
    const result = await consumeUIMessageStream(stream, vi.fn());
    expect(result.content).toBe('');
    expect(result.parts).toEqual([
      {
        type: 'runtime-status',
        runtime: 'claude',
        message: 'Claude Code HTTP 429; retrying (1/10). Retrying in 1s.',
      },
    ]);
  });

  it('coalesces adjacent visible runtime status updates for the same runtime', async () => {
    const stream = makeStream(
      {
        type: 'status',
        visible: true,
        runtime: 'claude',
        message: 'Claude Code HTTP 429; retrying (1/10). Retrying in 1s.',
      },
      {
        type: 'status',
        visible: true,
        runtime: 'claude',
        message: 'Claude Code HTTP 429; retrying (2/10). Retrying in 1s.',
      },
      { type: 'done' },
    );
    const result = await consumeUIMessageStream(stream, vi.fn());
    const statusParts = result.parts.filter((p): p is RuntimeStatusPart => p.type === 'runtime-status');
    expect(result.content).toBe('');
    expect(statusParts).toEqual([
      {
        type: 'runtime-status',
        runtime: 'claude',
        message: 'Claude Code HTTP 429; retrying (2/10). Retrying in 1s.',
      },
    ]);
  });

  it('keeps visible runtime status out of assistant content when text arrives later', async () => {
    const stream = makeStream(
      {
        type: 'status',
        visible: true,
        runtime: 'codex',
        message: 'Codex is preparing the local runtime.',
      },
      { type: 'text_delta', delta: 'Ready.' },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());

    expect(result.content).toBe('Ready.');
    expect(result.parts).toEqual([
      {
        type: 'runtime-status',
        runtime: 'codex',
        message: 'Codex is preparing the local runtime.',
      },
      {
        type: 'text',
        text: 'Ready.',
      },
    ]);
  });

  it('does not interrupt native runtime tool state when status arrives during a tool call', async () => {
    const stream = makeStream(
      {
        type: 'tool_start',
        toolCallId: 'cmd-1',
        toolName: 'Bash',
        runtime: 'claude',
        args: { command: 'mindos search runtime' },
      },
      {
        type: 'status',
        visible: true,
        runtime: 'claude',
        message: 'Claude Code is waiting for the local runtime.',
      },
      { type: 'tool_end', toolCallId: 'cmd-1', output: 'done', isError: false },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => p.type === 'tool-call');
    const statusPart = result.parts.find((p): p is RuntimeStatusPart => p.type === 'runtime-status');

    expect(result.content).toBe('');
    expect(toolPart).toMatchObject({
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      runtime: 'claude',
      state: 'done',
      output: 'done',
    });
    expect(statusPart).toMatchObject({
      runtime: 'claude',
      message: 'Claude Code is waiting for the local runtime.',
    });
  });

  it('preserves native runtime identity when a tool_end event arrives without tool_start', async () => {
    const stream = makeStream(
      {
        type: 'tool_end',
        toolCallId: 'codex-tool-1',
        toolName: 'Bash',
        runtime: 'codex',
        output: 'done',
        isError: false,
      },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => p.type === 'tool-call');

    expect(toolPart).toMatchObject({
      toolCallId: 'codex-tool-1',
      toolName: 'Bash',
      runtime: 'codex',
      state: 'done',
      output: 'done',
    });
  });

  it('redacts secrets from raw tool SSE payloads before storing message parts', async () => {
    const stream = makeStream(
      {
        type: 'tool_start',
        toolCallId: 'cmd-secret',
        toolName: 'Bash',
        runtime: 'claude',
        args: {
          command: 'curl -H "Authorization: Bearer sk-stream-secret-1234567890" https://example.test?token=abc123secret',
          env: { API_KEY: 'sk-stream-secret-abcdefghijkl' },
        },
      },
      {
        type: 'tool_delta',
        toolCallId: 'cmd-secret',
        toolName: 'Bash',
        runtime: 'claude',
        delta: 'token=abc123secret\n',
      },
      {
        type: 'tool_end',
        toolCallId: 'cmd-secret',
        toolName: 'Bash',
        runtime: 'claude',
        output: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
        isError: false,
      },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => p.type === 'tool-call');
    const serialized = JSON.stringify(toolPart);

    expect(serialized).toContain('[redacted]');
    expect(serialized).not.toContain('sk-stream-secret');
    expect(serialized).not.toContain('abc123secret');
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(toolPart).toMatchObject({
      runtime: 'claude',
      state: 'done',
      output: 'Authorization: Bearer [redacted]',
    });
  });

  it('surfaces runtime binding metadata without adding message content', async () => {
    const onRuntimeBinding = vi.fn();
    const stream = makeStream(
      { type: 'runtime_binding', runtime: 'codex', externalSessionId: 'thr_123', cwd: '/tmp/mind' },
      { type: 'text_delta', delta: 'Bound session.' },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn(), undefined, { onRuntimeBinding });

    expect(onRuntimeBinding).toHaveBeenCalledWith({
      runtime: 'codex',
      externalSessionId: 'thr_123',
      cwd: '/tmp/mind',
    });
    expect(result.content).toBe('Bound session.');
  });

  it('surfaces failed runtime binding metadata for stale native sessions', async () => {
    const onRuntimeBinding = vi.fn();
    const stream = makeStream(
      {
        type: 'runtime_binding',
        runtime: 'claude',
        externalSessionId: 'claude_old',
        cwd: '/tmp/mind',
        status: 'failed',
        reason: 'Claude resume failed',
      },
      { type: 'error', message: 'Claude Code native runtime error: Claude resume failed' },
    );

    await consumeUIMessageStream(stream, vi.fn(), undefined, { onRuntimeBinding });

    expect(onRuntimeBinding).toHaveBeenCalledWith({
      runtime: 'claude',
      externalSessionId: 'claude_old',
      cwd: '/tmp/mind',
      status: 'failed',
      reason: 'Claude resume failed',
    });
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

  it('preserves native runtime metadata on tool calls', async () => {
    const stream = makeStream(
      {
        type: 'tool_start',
        toolCallId: 'tc1',
        toolName: 'Bash',
        runtime: 'claude',
        args: {
          command: 'mindos file delete "Profile.md"',
          description: 'Delete a note',
        },
      },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(toolPart).toMatchObject({
      toolCallId: 'tc1',
      toolName: 'Bash',
      runtime: 'claude',
      input: {
        command: 'mindos file delete "Profile.md"',
        description: 'Delete a note',
      },
    });
  });

  it('appends native runtime tool output deltas while keeping the tool running', async () => {
    const stream = makeStream(
      {
        type: 'tool_start',
        toolCallId: 'cmd-1',
        toolName: 'Bash',
        runtime: 'codex',
        args: { command: 'printf hello' },
      },
      { type: 'tool_delta', toolCallId: 'cmd-1', toolName: 'Bash', runtime: 'codex', delta: 'hello' },
      { type: 'tool_delta', toolCallId: 'cmd-1', toolName: 'Bash', runtime: 'codex', delta: '\n' },
      { type: 'tool_end', toolCallId: 'cmd-1', output: 'hello\n', isError: false },
      { type: 'done' },
    );

    const updates: Array<{ parts: unknown[] }> = [];
    // emitCoalesceMs: 0 — this test asserts an intermediate emission
    // (delta applied, tool still running) that coalescing would skip.
    const result = await consumeUIMessageStream(stream, (message) => {
      updates.push({ parts: message.parts });
    }, undefined, { emitCoalesceMs: 0 });
    const afterDelta = updates.find((message) => {
      const part = message.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
      return part?.output === 'hello\n';
    })?.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(afterDelta).toMatchObject({
      state: 'running',
      output: 'hello\n',
    });

    const toolPart = result.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(toolPart).toMatchObject({
      state: 'done',
      output: 'hello\n',
    });
  });

  it('keeps streamed Codex command output when completion only carries a generic status', async () => {
    const stream = makeStream(
      {
        type: 'tool_start',
        toolCallId: 'cmd-1',
        toolName: 'Bash',
        runtime: 'codex',
        args: { command: 'printf hello' },
      },
      { type: 'tool_delta', toolCallId: 'cmd-1', toolName: 'Bash', runtime: 'codex', delta: 'hello\n' },
      { type: 'tool_end', toolCallId: 'cmd-1', output: 'Codex item completed', isError: false },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(toolPart).toMatchObject({
      state: 'done',
      output: 'hello\n',
    });
  });

  it('tracks runtime permission requests and resolutions without completing the underlying tool', async () => {
    const stream = makeStream(
      {
        type: 'runtime_permission_request',
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'codex',
        toolCallId: 'cmd-1',
        toolName: 'Bash',
        input: { command: 'mindos file delete "Profile.md"' },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      },
      {
        type: 'runtime_permission_resolved',
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'codex',
        toolCallId: 'cmd-1',
        decision: 'accept',
      },
      { type: 'tool_end', toolCallId: 'cmd-1', output: 'Deleted Profile.md', isError: false },
      { type: 'done' },
    );

    const updates: Array<{ parts: unknown[] }> = [];
    // emitCoalesceMs: 0 — this test asserts an intermediate emission
    // (permission approved, tool still running) that coalescing would skip.
    const result = await consumeUIMessageStream(stream, (message) => {
      updates.push({ parts: message.parts });
    }, undefined, { emitCoalesceMs: 0 });
    const afterResolved = updates.find((message) => {
      const part = message.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
      return part?.runtimePermission?.status === 'approved';
    })?.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(afterResolved).toMatchObject({
      state: 'running',
      runtimePermission: { status: 'approved', decision: 'accept' },
    });

    const toolPart = result.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');
    expect(toolPart).toMatchObject({
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      runtime: 'codex',
      state: 'done',
      output: 'Deleted Profile.md',
      runtimePermission: {
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'codex',
        status: 'approved',
        decision: 'accept',
      },
    });
  });

  it('marks denied runtime permission requests as closed without waiting for tool_end', async () => {
    const stream = makeStream(
      {
        type: 'runtime_permission_request',
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'claude',
        toolCallId: 'cmd-1',
        toolName: 'Bash',
        input: { command: 'mindos file delete "Profile.md"' },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      },
      {
        type: 'runtime_permission_resolved',
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'claude',
        toolCallId: 'cmd-1',
        decision: 'decline',
      },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => (p as ToolCallPart).type === 'tool-call');

    expect(toolPart).toMatchObject({
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      runtime: 'claude',
      state: 'error',
      output: 'Permission decision forwarded: decline',
      runtimePermission: {
        status: 'denied',
        decision: 'decline',
      },
    });
  });

  it('preserves native runtime identity when a permission resolution arrives without the request event', async () => {
    const stream = makeStream(
      {
        type: 'runtime_permission_resolved',
        runId: 'run-1',
        requestId: 'perm-1',
        runtime: 'claude',
        toolCallId: 'cmd-1',
        decision: 'denied',
      },
      { type: 'done' },
    );

    const result = await consumeUIMessageStream(stream, vi.fn());
    const toolPart = result.parts.find((p): p is ToolCallPart => p.type === 'tool-call');

    expect(toolPart).toMatchObject({
      toolCallId: 'cmd-1',
      toolName: 'approval_request',
      runtime: 'claude',
      state: 'error',
      output: 'Permission decision forwarded: denied',
    });
  });

  it.each(['append_to_file', 'edit_lines', 'move_file', 'append_csv'])(
    'notifies files changed when %s completes successfully',
    async (toolName) => {
      const windowTarget = stubWindowEventTarget();
      const onFilesChanged = vi.fn();
      windowTarget.addEventListener('mindos:files-changed', onFilesChanged);

      try {
        const stream = makeStream(
          { type: 'tool_start', toolCallId: 'tc1', toolName, args: { path: 'a.md' } },
          { type: 'tool_end', toolCallId: 'tc1', output: 'ok', isError: false },
          { type: 'done' },
        );

        await consumeUIMessageStream(stream, vi.fn());

        expect(onFilesChanged).toHaveBeenCalledTimes(1);
      } finally {
        windowTarget.removeEventListener('mindos:files-changed', onFilesChanged);
      }
    },
  );

  it('does not notify files changed when a mutating tool fails', async () => {
    const windowTarget = stubWindowEventTarget();
    const onFilesChanged = vi.fn();
    windowTarget.addEventListener('mindos:files-changed', onFilesChanged);

    try {
      const stream = makeStream(
        { type: 'tool_start', toolCallId: 'tc1', toolName: 'append_to_file', args: { path: 'a.md' } },
        { type: 'tool_end', toolCallId: 'tc1', output: 'permission denied', isError: true },
        { type: 'done' },
      );

      await consumeUIMessageStream(stream, vi.fn());

      expect(onFilesChanged).not.toHaveBeenCalled();
    } finally {
      windowTarget.removeEventListener('mindos:files-changed', onFilesChanged);
    }
  });
});
