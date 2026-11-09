import { describe, expect, it } from 'vitest';
import { sdkNotificationToUpdate } from './session-callbacks.js';
import {
  ACP_TOOL_CALL_DIFF_MAX_COUNT,
  ACP_TOOL_CALL_DIFF_MAX_TEXT,
} from './types.js';

function toolCallNotification(content: unknown) {
  return {
    sessionId: 'session-1',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      content,
    },
  } as never;
}

function diffBlocks(update: ReturnType<typeof sdkNotificationToUpdate>) {
  return (update.toolCall?.content ?? []).filter((block) => block.type === 'diff');
}

describe('ACP tool-call diff parsing', () => {
  it('keeps path, old text and new text so the client can render a file change', () => {
    const update = sdkNotificationToUpdate('session-1', toolCallNotification([
      { type: 'diff', path: '/notes/todo.md', oldText: 'one\ntwo', newText: 'one\nthree' },
    ]));

    expect(diffBlocks(update)).toEqual([
      { type: 'diff', path: '/notes/todo.md', oldText: 'one\ntwo', newText: 'one\nthree' },
    ]);
  });

  it('treats a null old text as a newly created file rather than dropping the block', () => {
    const update = sdkNotificationToUpdate('session-1', toolCallNotification([
      { type: 'diff', path: '/notes/new.md', oldText: null, newText: 'fresh' },
    ]));

    expect(diffBlocks(update)).toEqual([
      { type: 'diff', path: '/notes/new.md', oldText: '', newText: 'fresh' },
    ]);
  });

  it('keeps an emptied file as a full deletion', () => {
    const update = sdkNotificationToUpdate('session-1', toolCallNotification([
      { type: 'diff', path: '/notes/gone.md', oldText: 'body', newText: '' },
    ]));

    expect(diffBlocks(update)).toEqual([
      { type: 'diff', path: '/notes/gone.md', oldText: 'body', newText: '' },
    ]);
  });

  it('truncates oversized file contents so one edit cannot blow up the session store', () => {
    const huge = 'x'.repeat(ACP_TOOL_CALL_DIFF_MAX_TEXT + 500);
    const update = sdkNotificationToUpdate('session-1', toolCallNotification([
      { type: 'diff', path: '/notes/big.md', oldText: huge, newText: huge },
    ]));

    const [block] = diffBlocks(update);
    expect(block).toMatchObject({ type: 'diff', path: '/notes/big.md', truncated: true });
    expect(block?.type === 'diff' && block.oldText.length).toBe(ACP_TOOL_CALL_DIFF_MAX_TEXT);
    expect(block?.type === 'diff' && block.newText.length).toBe(ACP_TOOL_CALL_DIFF_MAX_TEXT);
  });

  it('caps how many diffs a single tool call can carry', () => {
    const many = Array.from({ length: ACP_TOOL_CALL_DIFF_MAX_COUNT + 10 }, (_unused, index) => ({
      type: 'diff',
      path: `/notes/${index}.md`,
      oldText: 'a',
      newText: 'b',
    }));

    expect(diffBlocks(sdkNotificationToUpdate('session-1', toolCallNotification(many))))
      .toHaveLength(ACP_TOOL_CALL_DIFF_MAX_COUNT);
  });

  it('drops malformed diff blocks instead of surfacing partial file changes', () => {
    const update = sdkNotificationToUpdate('session-1', toolCallNotification([
      { type: 'diff', oldText: 'a', newText: 'b' },
      { type: 'diff', path: '', newText: 'b' },
      { type: 'diff', path: '/notes/a.md', newText: 42 },
      { type: 'diff', path: '/notes/b.md', oldText: {}, newText: 'ok' },
      null,
    ]));

    expect(diffBlocks(update)).toEqual([]);
  });

  it('keeps diffs alongside the resource blocks that were already supported', () => {
    const update = sdkNotificationToUpdate('session-1', toolCallNotification([
      { type: 'resource_link', uri: 'file:///notes/a.md', name: 'a.md' },
      { type: 'diff', path: '/notes/a.md', oldText: 'a', newText: 'b' },
    ]));

    expect(update.toolCall?.content?.map((block) => block.type)).toEqual(['resource_link', 'diff']);
  });

  it('parses diffs from tool_call_update as well, since agents attach them on completion', () => {
    const update = sdkNotificationToUpdate('session-1', {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'completed',
        content: [{ type: 'diff', path: '/notes/a.md', oldText: 'a', newText: 'b' }],
      },
    } as never);

    expect(diffBlocks(update)).toHaveLength(1);
  });

  it('ignores a non-array content payload without throwing', () => {
    expect(sdkNotificationToUpdate('session-1', toolCallNotification('not-an-array')).toolCall?.content)
      .toBeUndefined();
  });
});
