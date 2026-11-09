import { describe, expect, it } from 'vitest';
import { consumeUIMessageStream } from './stream-consumer.js';
import type { AgentPlanPart, Message } from './stream-message-types.js';

/**
 * ACP resends the whole plan on every change, so the transcript must hold one
 * live plan part rather than a growing pile of snapshots
 * (spec-acp-first-agent-integration Phase 1c).
 */

function makeStream(...events: object[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data:${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
}

async function run(...events: object[]): Promise<{ message: Message; plans: AgentPlanPart[] }> {
  const message = await consumeUIMessageStream(makeStream(...events), () => {}, undefined, { emitCoalesceMs: 0 });
  return {
    message,
    plans: (message.parts ?? []).filter((part): part is AgentPlanPart => part.type === 'agent-plan'),
  };
}

describe('agent_plan stream events', () => {
  it('records the plan as its own part, separate from the reply text', async () => {
    const { message, plans } = await run(
      { type: 'text_delta', delta: 'Working on it.' },
      { type: 'agent_plan', runtime: 'acp', entries: [{ content: 'Read the spec', status: 'in_progress' }] },
      { type: 'done' },
    );

    expect(plans).toEqual([{
      type: 'agent-plan',
      runtime: 'acp',
      entries: [{ content: 'Read the spec', status: 'in_progress' }],
    }]);
    expect(message.content).toBe('Working on it.');
  });

  it('replaces the plan in place as steps complete, keeping a single list', async () => {
    const { plans } = await run(
      { type: 'agent_plan', entries: [{ content: 'Step A', status: 'in_progress' }, { content: 'Step B', status: 'pending' }] },
      { type: 'agent_plan', entries: [{ content: 'Step A', status: 'completed' }, { content: 'Step B', status: 'in_progress' }] },
      { type: 'done' },
    );

    expect(plans).toHaveLength(1);
    expect(plans[0].entries).toEqual([
      { content: 'Step A', status: 'completed' },
      { content: 'Step B', status: 'in_progress' },
    ]);
  });

  it('keeps the plan above the text that followed it, so the order reads correctly', async () => {
    const { message } = await run(
      { type: 'agent_plan', entries: [{ content: 'Step A', status: 'pending' }] },
      { type: 'text_delta', delta: 'Starting now.' },
      { type: 'done' },
    );

    expect((message.parts ?? []).map((part) => part.type)).toEqual(['agent-plan', 'text']);
  });

  it('ignores malformed payloads rather than rendering an empty checklist', async () => {
    const { plans } = await run(
      { type: 'agent_plan', entries: 'nope' },
      { type: 'agent_plan', entries: [] },
      { type: 'agent_plan', entries: [{ status: 'pending' }, null, { content: '  ' }] },
      { type: 'done' },
    );

    expect(plans).toEqual([]);
  });

  it('redacts secrets a step description might carry', async () => {
    const { plans } = await run(
      { type: 'agent_plan', entries: [{ content: 'Use ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', status: 'pending' }] },
      { type: 'done' },
    );

    expect(plans[0].entries[0].content).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
