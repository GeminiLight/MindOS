import { describe, expect, it } from 'vitest';
import { consumeUIMessageStream } from './stream-consumer.js';
import type { Message, ToolCallPart } from './stream-message-types.js';

/**
 * `tool_diff` carries the structured file changes external ACP agents report.
 * Native MindOS tools keep embedding their diff in the output text, so both
 * paths must coexist (spec-acp-first-agent-integration 影响范围).
 */

function makeStream(...events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data:${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
}

function toolCalls(message: Message): ToolCallPart[] {
  return (message.parts ?? []).filter((part): part is ToolCallPart => part.type === 'tool-call');
}

async function run(...events: object[]): Promise<ToolCallPart[]> {
  return toolCalls(await consumeUIMessageStream(makeStream(...events), () => {}, undefined, { emitCoalesceMs: 0 }));
}

describe('tool_diff stream events', () => {
  it('attaches file changes to the tool call the agent reported them for', async () => {
    const [call] = await run(
      { type: 'tool_start', toolCallId: 't1', toolName: 'Edit', args: {}, runtime: 'acp' },
      { type: 'tool_diff', toolCallId: 't1', runtime: 'acp', diffs: [{ path: '/a.md', oldText: 'one', newText: 'two' }] },
      { type: 'tool_end', toolCallId: 't1', output: 'ok', runtime: 'acp' },
    );

    expect(call).toMatchObject({
      toolCallId: 't1',
      state: 'done',
      diffs: [{ path: '/a.md', oldText: 'one', newText: 'two' }],
    });
  });

  it('keeps the newest version of a file when an agent re-reports the same path', async () => {
    const [call] = await run(
      { type: 'tool_start', toolCallId: 't1', toolName: 'Edit', args: {} },
      { type: 'tool_diff', toolCallId: 't1', diffs: [{ path: '/a.md', oldText: 'one', newText: 'two' }] },
      { type: 'tool_diff', toolCallId: 't1', diffs: [{ path: '/a.md', oldText: 'one', newText: 'three' }] },
    );

    expect(call.diffs).toEqual([{ path: '/a.md', oldText: 'one', newText: 'three' }]);
  });

  it('preserves the order files were first touched when several are edited', async () => {
    const [call] = await run(
      { type: 'tool_start', toolCallId: 't1', toolName: 'Edit', args: {} },
      { type: 'tool_diff', toolCallId: 't1', diffs: [{ path: '/a.md', oldText: '', newText: 'a' }, { path: '/b.md', oldText: '', newText: 'b' }] },
      { type: 'tool_diff', toolCallId: 't1', diffs: [{ path: '/a.md', oldText: '', newText: 'a2' }] },
    );

    expect(call.diffs?.map((diff) => diff.path)).toEqual(['/a.md', '/b.md']);
  });

  it('creates the tool call even if tool_start was lost, so an edit is never invisible', async () => {
    const [call] = await run(
      { type: 'tool_diff', toolCallId: 't1', runtime: 'acp', diffs: [{ path: '/a.md', oldText: '', newText: 'x' }] },
    );

    expect(call).toMatchObject({ toolCallId: 't1', runtime: 'acp', diffs: [{ path: '/a.md' }] });
  });

  it('redacts secrets that reach the client inside a file body', async () => {
    const [call] = await run(
      { type: 'tool_start', toolCallId: 't1', toolName: 'Edit', args: {} },
      {
        type: 'tool_diff',
        toolCallId: 't1',
        diffs: [{ path: '/.env', oldText: '', newText: 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }],
      },
    );

    expect(call.diffs?.[0].newText).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('ignores malformed payloads rather than storing a broken diff', async () => {
    const [call] = await run(
      { type: 'tool_start', toolCallId: 't1', toolName: 'Edit', args: {} },
      { type: 'tool_diff', toolCallId: 't1', diffs: 'nope' },
      { type: 'tool_diff', toolCallId: 't1', diffs: [{ path: '', newText: 'x' }, { oldText: 'a' }, null] },
      { type: 'tool_diff', diffs: [{ path: '/a.md', oldText: '', newText: 'x' }] },
    );

    expect(call.diffs).toBeUndefined();
  });

  it('leaves tool calls without diffs exactly as before', async () => {
    const [call] = await run(
      { type: 'tool_start', toolCallId: 't1', toolName: 'write_file', args: { path: 'a.md' } },
      { type: 'tool_end', toolCallId: 't1', output: 'Updated a.md\n---\n+ new line' },
    );

    expect(call.diffs).toBeUndefined();
    expect(call.output).toContain('+ new line');
  });
});
