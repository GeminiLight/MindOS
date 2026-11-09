import { describe, expect, it } from 'vitest';
import { mapMindosAcpUpdateToSseEvents } from './acp-lane.js';
import type { MindosAcpSessionUpdate } from './acp-lane.js';

/**
 * ACP `plan` is the agent's todo list. It used to be flattened into emoji text
 * inside the reply, so it could not be updated in place, collapsed, or told
 * apart from the answer (spec-acp-first-agent-integration Phase 1c).
 */

function planEvent(update: MindosAcpSessionUpdate) {
  const event = mapMindosAcpUpdateToSseEvents(update).events.find((candidate) => candidate.type === 'agent_plan');
  return event?.type === 'agent_plan' ? event : undefined;
}

describe('ACP lane plan mapping', () => {
  it('emits the plan as structured entries instead of prose', () => {
    expect(planEvent({
      type: 'plan',
      plan: {
        entries: [
          { content: 'Read the spec', status: 'completed' },
          { content: 'Write the parser', status: 'in_progress' },
          { content: 'Wire the UI', status: 'pending' },
        ],
      },
    })).toEqual({
      type: 'agent_plan',
      runtime: 'acp',
      entries: [
        { content: 'Read the spec', status: 'completed' },
        { content: 'Write the parser', status: 'in_progress' },
        { content: 'Wire the UI', status: 'pending' },
      ],
    });
  });

  it('no longer writes plan text into the reply body', () => {
    const events = mapMindosAcpUpdateToSseEvents({
      type: 'plan',
      plan: { entries: [{ content: 'Step one', status: 'pending' }] },
    }).events;

    expect(events.map((event) => event.type)).toEqual(['agent_plan']);
  });

  it('defaults an unknown or missing status to pending rather than dropping the step', () => {
    expect(planEvent({
      type: 'plan',
      plan: { entries: [{ content: 'Step' }, { content: 'Other', status: 'blocked' }] },
    })?.entries).toEqual([
      { content: 'Step', status: 'pending' },
      { content: 'Other', status: 'pending' },
    ]);
  });

  it('drops entries with no text, which would render as empty rows', () => {
    expect(planEvent({
      type: 'plan',
      plan: { entries: [{ content: '   ', status: 'pending' }, { content: 'Real', status: 'pending' }] },
    })?.entries).toEqual([{ content: 'Real', status: 'pending' }]);
  });

  it('stays silent for an agent that clears or never sends a plan', () => {
    expect(planEvent({ type: 'plan', plan: { entries: [] } })).toBeUndefined();
    expect(planEvent({ type: 'plan' })).toBeUndefined();
  });

  it('bounds a runaway plan so one update cannot flood the transcript', () => {
    const entries = Array.from({ length: 300 }, (_unused, index) => ({ content: `Step ${index}`, status: 'pending' }));

    expect(planEvent({ type: 'plan', plan: { entries } })?.entries).toHaveLength(100);
  });

  it('does not count as visible content, so a plan cannot mask a failed turn', () => {
    expect(mapMindosAcpUpdateToSseEvents({
      type: 'plan',
      plan: { entries: [{ content: 'Step', status: 'pending' }] },
    }).hasVisibleContent).toBe(false);
  });
});
