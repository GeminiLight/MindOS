import { describe, expect, it } from 'vitest';
import { codexThreadMessageCount, codexThreadTurnsToMessages } from '@/lib/codex-thread-import';
import type { AgentRuntimeIdentity } from '@/lib/types';

const codexRuntime: AgentRuntimeIdentity = { id: 'codex', name: 'Codex', kind: 'codex' };

describe('codexThreadTurnsToMessages', () => {
  it('imports app-server input/output turns as user and assistant messages', () => {
    const timestamp = '2026-06-29T00:00:00.000Z';

    expect(codexThreadTurnsToMessages({
      id: 'thread_existing',
      turns: [{
        timestamp,
        input: [{ type: 'text', text: 'previous user prompt' }],
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'previous assistant answer' }],
        }],
      }],
    }, codexRuntime)).toEqual([
      {
        role: 'user',
        content: 'previous user prompt',
        timestamp: Date.parse(timestamp),
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
      },
      {
        role: 'assistant',
        content: 'previous assistant answer',
        timestamp: Date.parse(timestamp),
        agentId: 'codex',
        agentName: 'Codex',
        agentKind: 'codex',
      },
    ]);
  });

  it('imports Codex response_item payload message wrappers', () => {
    expect(codexThreadTurnsToMessages({
      id: 'thread_wrapped',
      updatedAt: 123,
      turns: [{
        items: [
          {
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: 'wrapped question' }],
            },
          },
          {
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'wrapped answer' }],
            },
          },
        ],
      }],
    }, codexRuntime).map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    }))).toEqual([
      { role: 'user', content: 'wrapped question', timestamp: 123_000 },
      { role: 'assistant', content: 'wrapped answer', timestamp: 123_000 },
    ]);
  });

  it('imports nested response output and conversation item shapes', () => {
    const messages = codexThreadTurnsToMessages({
      id: 'thread_nested',
      turns: [
        {
          conversationItems: [
            {
              type: 'message',
              author: { role: 'user' },
              content: [{ type: 'input_text', text: { value: 'nested user question' } }],
            },
          ],
          response: {
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: { value: 'nested assistant answer' } }],
              },
            ],
          },
        },
      ],
    }, codexRuntime);

    expect(messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))).toEqual([
      { role: 'user', content: 'nested user question' },
      { role: 'assistant', content: 'nested assistant answer' },
    ]);
    expect(codexThreadMessageCount({ id: 'thread_nested', turns: [{
      conversationItems: [
        { type: 'message', author: { role: 'user' }, content: [{ type: 'input_text', text: { value: 'nested user question' } }] },
      ],
      response: {
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: { value: 'nested assistant answer' } }] },
        ],
      },
    }] })).toBe(2);
  });

  it('uses explicit message counts before falling back to turn counts', () => {
    expect(codexThreadMessageCount({ id: 'thread_count', messageCount: 7, turnCount: 10 })).toBe(7);
    expect(codexThreadMessageCount({ id: 'thread_turn_count', turnCount: 3 })).toBe(6);
    expect(codexThreadMessageCount({ id: 'thread_unknown' })).toBeNull();
  });
});
