import { describe, expect, it } from 'vitest';
import { mapMindosAcpUpdateToSseEvents } from './acp-lane.js';
import type { AcpToolCallFull } from '../../protocols/acp/types.js';
import type { MindosAcpSessionUpdate } from './acp-lane.js';

/**
 * The lane boundary carries its own narrow update type, so a field parsed in
 * `protocols/acp` only reaches the UI once it is declared here too. These tests
 * pin that boundary for file diffs (spec-acp-first-agent-integration 数据流).
 */

function diffEvents(update: MindosAcpSessionUpdate) {
  return mapMindosAcpUpdateToSseEvents(update).events.filter((event) => event.type === 'tool_diff');
}

describe('ACP lane diff mapping', () => {
  it('emits a tool_diff event when a tool call reports a file change', () => {
    expect(diffEvents({
      type: 'tool_call',
      toolCall: {
        toolCallId: 'call-1',
        title: 'Edit',
        status: 'in_progress',
        content: [{ type: 'diff', path: '/notes/a.md', oldText: 'one', newText: 'two' }],
      },
    })).toEqual([{
      type: 'tool_diff',
      toolCallId: 'call-1',
      runtime: 'acp',
      diffs: [{ path: '/notes/a.md', oldText: 'one', newText: 'two' }],
    }]);
  });

  it('emits diffs attached to a completing tool call, which is when most agents send them', () => {
    const events = mapMindosAcpUpdateToSseEvents({
      type: 'tool_call_update',
      toolCall: {
        toolCallId: 'call-1',
        status: 'completed',
        rawOutput: 'done',
        content: [{ type: 'diff', path: '/notes/a.md', oldText: '', newText: 'created' }],
      },
    });

    expect(events.events.map((event) => event.type)).toEqual(['tool_diff', 'tool_end']);
  });

  it('marks a clipped diff so the UI can say the file was too large to show in full', () => {
    expect(diffEvents({
      type: 'tool_call',
      toolCall: {
        toolCallId: 'call-1',
        status: 'in_progress',
        content: [{ type: 'diff', path: '/notes/big.md', oldText: 'a', newText: 'b', truncated: true }],
      },
    })[0]).toMatchObject({ diffs: [{ path: '/notes/big.md', truncated: true }] });
  });

  it('redacts secrets inside file contents, like every other tool payload', () => {
    const [event] = diffEvents({
      type: 'tool_call',
      toolCall: {
        toolCallId: 'call-1',
        status: 'in_progress',
        content: [{
          type: 'diff',
          path: '/notes/env.md',
          oldText: 'nothing here',
          newText: 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
        }],
      },
    });

    const diff = event?.type === 'tool_diff' ? event.diffs[0] : undefined;
    expect(diff?.newText).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('stays silent when a tool call carries no diff content', () => {
    expect(diffEvents({
      type: 'tool_call',
      toolCall: { toolCallId: 'call-1', status: 'in_progress', content: [{ type: 'resource_link', uri: 'file:///a.md', name: 'a.md' }] },
    })).toEqual([]);
    expect(diffEvents({ type: 'tool_call', toolCall: { toolCallId: 'call-1', status: 'in_progress' } })).toEqual([]);
  });

  it('still reports a pending tool call that only has a diff, so edits are never silent', () => {
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'tool_call_update',
      toolCall: {
        toolCallId: 'call-1',
        status: 'in_progress',
        content: [{ type: 'diff', path: '/notes/a.md', oldText: 'a', newText: 'b' }],
      },
    }).events.map((event) => event.type)).toEqual(['tool_diff']);
  });
});

describe('ACP lane boundary contract', () => {
  it('declares every tool-call field the protocol layer parses, so none is dropped in transit', () => {
    // Compile-time guard: a new AcpToolCallFull field must be mirrored on the
    // lane update type or this assignment stops type-checking.
    const parsed: AcpToolCallFull = {
      toolCallId: 'call-1',
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      rawInput: '{}',
      rawOutput: 'ok',
      content: [{ type: 'diff', path: '/a.md', oldText: '', newText: 'x' }],
      locations: [{ path: '/a.md', line: 1 }],
    };
    const laneUpdate: MindosAcpSessionUpdate = { type: 'tool_call', toolCall: parsed };

    expect(laneUpdate.toolCall?.content).toHaveLength(1);
  });
});
