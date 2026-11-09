import { describe, expect, it } from 'vitest';
import { toAgentMessages } from '@/lib/agent/to-agent-messages';
import type { Message } from '@/lib/types';

/**
 * A plan describes how a turn ran, not what the agent said. Replaying it as
 * history would feed the agent its own todo list back and waste context
 * (spec-acp-first-agent-integration Phase 1c).
 */

function assistantWith(parts: NonNullable<Message['parts']>): Message {
  return { role: 'assistant', content: 'Done.', parts };
}

describe('plan parts in replayed history', () => {
  it('is left out of the messages sent back to the agent', () => {
    const [message] = toAgentMessages([assistantWith([
      { type: 'agent-plan', runtime: 'acp', entries: [{ content: 'Step A', status: 'completed' }] },
      { type: 'text', text: 'Done.' },
    ])]) as Array<Record<string, unknown>>;

    expect(JSON.stringify(message)).not.toContain('Step A');
  });

  it('keeps the rest of the turn intact when a plan is dropped', () => {
    const [message] = toAgentMessages([assistantWith([
      { type: 'agent-plan', entries: [{ content: 'Step A', status: 'completed' }] },
      { type: 'text', text: 'Done.' },
    ])]) as Array<Record<string, unknown>>;

    expect(JSON.stringify(message)).toContain('Done.');
  });

  it('does not turn a plan-only turn into an empty assistant message', () => {
    const messages = toAgentMessages([{
      role: 'assistant',
      content: '',
      parts: [{ type: 'agent-plan', entries: [{ content: 'Step A', status: 'pending' }] }],
    }]) as Array<Record<string, unknown>>;

    expect(JSON.stringify(messages)).not.toContain('Step A');
  });
});
