import { describe, expect, it } from 'vitest';
import { runMindosAcpAgentTurn, type MindOSSSEvent } from './index.js';

/**
 * ACP lane contracts that mirror the native lane: an error reported by the
 * agent is a failed turn even after content, and session open runs inside
 * the same timeout/abort scope as the prompt.
 */
describe('runMindosAcpAgentTurn error terminal state', () => {
  it('returns { error } and sends the error once when the agent reports an error after content', async () => {
    const events: MindOSSSEvent[] = [];
    const closed: string[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      createSession: async () => ({ id: 'session-1' }),
      promptStream: async (_sessionId, _prompt, onUpdate) => {
        onUpdate({ type: 'text', text: 'partial answer' });
        onUpdate({ type: 'error', error: 'model overloaded' });
      },
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
    });

    expect(result.error?.message).toContain('model overloaded');
    expect(events.filter((event) => event.type === 'text_delta')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: 'ACP Agent Error: model overloaded' },
    ]);
    expect(events.some((event) => event.type === 'done')).toBe(false);
    expect(closed).toEqual(['session-1']);
  });

  it('returns { error } and sends the error once when the agent reports an error before any content', async () => {
    const events: MindOSSSEvent[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      maxRetries: 1,
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      createSession: async () => ({ id: 'session-1' }),
      promptStream: async (_sessionId, _prompt, onUpdate) => {
        onUpdate({ type: 'error', error: 'agent crashed' });
      },
      closeSession: async () => {},
      sleep: async () => {},
    });

    expect(result.error?.message).toContain('agent crashed');
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1);
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  it('keeps a clean turn as done when no error was reported', async () => {
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
    expect(events.map((event) => event.type)).toEqual(['text_delta', 'done']);
  });
});

describe('runMindosAcpAgentTurn session-open scope', () => {
  it('applies the lane timeout to session open', async () => {
    const events: MindOSSSEvent[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      maxRetries: 1,
      timeoutMs: 30,
      hasContent: () => false,
      send: (event) => events.push(event),
      createSession: () => new Promise(() => {}),
      promptStream: async () => {},
      closeSession: async () => {},
      sleep: async () => {},
    });

    expect((result.error as (Error & { code?: string }) | undefined)?.code).toBe('TIMEOUT');
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  it('aborts session open and closes a session that arrives late', async () => {
    const controller = new AbortController();
    const closed: string[] = [];
    let resolveCreate!: (session: { id: string }) => void;

    const turn = runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      maxRetries: 1,
      signal: controller.signal,
      hasContent: () => false,
      send: () => {},
      createSession: () => new Promise((resolve) => { resolveCreate = resolve; }),
      promptStream: async () => {},
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException('The operation was aborted.', 'AbortError'));

    const result = await turn;
    expect(result.error?.name).toBe('AbortError');

    resolveCreate({ id: 'late-session' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toEqual(['late-session']);
  });

  it('forwards the signal and the lane timeout to session open and promptStream', async () => {
    const controller = new AbortController();
    const seen: Array<{ signal?: AbortSignal; timeoutMs?: number }> = [];
    let createSignal: AbortSignal | undefined;

    await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      timeoutMs: 5_000,
      signal: controller.signal,
      hasContent: () => false,
      send: () => {},
      createSession: async (_agentId, options) => {
        createSignal = options.signal;
        return { id: 'session-1' };
      },
      promptStream: async (_sessionId, _prompt, onUpdate, options) => {
        seen.push(options ?? {});
        onUpdate({ type: 'text', text: 'ok' });
      },
      closeSession: async () => {},
      sleep: async () => {},
    });

    expect(createSignal).toBe(controller.signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBe(controller.signal);
    expect(seen[0]?.timeoutMs).toBeGreaterThan(0);
    expect(seen[0]?.timeoutMs).toBeLessThanOrEqual(5_000);
  });
});
