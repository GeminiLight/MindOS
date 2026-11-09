// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeUIMessageStream } from '@geminilight/mindos/agent/stream/stream-consumer';
import type { Message, ToolCallPart } from '@/lib/types';
import ToolCallBlock from '@/components/ask/ToolCallBlock';

/**
 * End-to-end guard for the gap this spec closed: an external ACP agent edits a
 * file, and the change is visible in chat. Before `tool_diff`, Claude / Codex /
 * Gemini edits rendered as an opaque "Edit" row
 * (spec-acp-first-agent-integration 现状分析).
 */

vi.mock('@/hooks/usePendingAgentActions', () => ({ requestPendingAgentActionsRefresh: () => {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function streamOf(...events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data:${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
}

function toolCallOf(message: Message): ToolCallPart {
  const part = (message.parts ?? []).find((candidate): candidate is ToolCallPart => candidate.type === 'tool-call');
  if (!part) throw new Error('expected a tool call part');
  return part;
}

describe('external agent file edits in chat', () => {
  it('renders the edited file and its changed lines after an ACP run', async () => {
    const message = await consumeUIMessageStream(streamOf(
      { type: 'tool_start', toolCallId: 'call-1', toolName: 'Edit', args: { path: '/notes/todo.md' }, runtime: 'acp' },
      {
        type: 'tool_diff',
        toolCallId: 'call-1',
        runtime: 'acp',
        diffs: [{ path: '/notes/todo.md', oldText: 'buy milk\ncall mom', newText: 'buy milk\ncall dad' }],
      },
      { type: 'tool_end', toolCallId: 'call-1', output: 'Applied edit', runtime: 'acp' },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    const part = toolCallOf(message);
    expect(part.diffs).toHaveLength(1);

    act(() => root.render(<ToolCallBlock part={part} />));
    act(() => { host.querySelector('button')!.click(); });

    expect(host.textContent).toContain('todo.md');
    expect(host.textContent).toContain('call dad');
    expect(host.textContent).toContain('+1');
  });

  it('leaves a native MindOS tool rendering its own output-embedded diff', async () => {
    const message = await consumeUIMessageStream(streamOf(
      { type: 'tool_start', toolCallId: 'call-1', toolName: 'write_file', args: { path: 'note.md' }, runtime: 'mindos' },
      { type: 'tool_end', toolCallId: 'call-1', output: 'Updated note.md (+1/-0)\n---\n+ added line', runtime: 'mindos' },
      { type: 'done' },
    ), () => {}, undefined, { emitCoalesceMs: 0 });

    const part = toolCallOf(message);
    expect(part.diffs).toBeUndefined();

    act(() => root.render(<ToolCallBlock part={part} />));
    act(() => { host.querySelector('button')!.click(); });

    expect(host.textContent).toContain('added line');
  });
});
