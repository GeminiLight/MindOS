import { describe, expect, it } from 'vitest';
import { mapMindosAcpUpdateToSseEvents, runMindosAcpAgentTurn } from './index.js';
import type { MindOSSSEvent } from './index.js';

/**
 * An ACP agent that fails after streaming text used to end the turn as a
 * success, because the mapper dropped the error once content had been sent
 * (spec-acp-session-hardening item 9). This pins the fixed behaviour so the
 * suppression cannot come back.
 */

describe('ACP errors are never silently dropped', () => {
  it('always maps an agent error to a visible error event', () => {
    expect(mapMindosAcpUpdateToSseEvents({ type: 'error', error: 'model overloaded' })).toEqual({
      events: [{ type: 'error', message: 'model overloaded' }],
      hasVisibleContent: false,
    });
  });

  it('names the agent when the error carries no message, instead of an empty bubble', () => {
    expect(mapMindosAcpUpdateToSseEvents({ type: 'error' }).events).toEqual([
      { type: 'error', message: 'ACP agent error' },
    ]);
  });

  it('fails the turn when the agent errors after streaming an answer', async () => {
    const events: MindOSSSEvent[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      createSession: async () => ({ id: 'session-1' }),
      promptStream: async (_sessionId, _prompt, onUpdate) => {
        onUpdate({ type: 'text', text: 'here is a partial answer' });
        onUpdate({ type: 'error', error: 'rate limited' });
      },
      closeSession: async () => {},
      sleep: async () => {},
    });

    expect(result.error?.message).toContain('rate limited');
    expect(events.filter((event) => event.type === 'done')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
  });

  it('still completes a turn that streamed an answer and no error', async () => {
    const events: MindOSSSEvent[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      createSession: async () => ({ id: 'session-1' }),
      promptStream: async (_sessionId, _prompt, onUpdate) => {
        onUpdate({ type: 'text', text: 'all good' });
      },
      closeSession: async () => {},
      sleep: async () => {},
    });

    expect(result.error).toBeUndefined();
    expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(0);
  });
});
