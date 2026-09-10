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

/**
 * Pooled-session lifecycle: when the host offers `acquireSession` /
 * `releaseSession`, a resumable turn reuses a live session instead of opening
 * (spawning + handshaking) one per turn, parks it on a clean finish so the
 * next turn reuses it, and only closes it when it cannot be parked or the turn
 * timed out (the agent may be wedged).
 */
describe('runMindosAcpAgentTurn pooled session lifecycle', () => {
  const POOLED = { id: 'pooled-1', agentSessionId: 'ext-1', agentCapabilities: { loadSession: true } };
  const POOL_KEY = { agentId: 'agent-1', cwd: '/mind', externalSessionId: 'ext-1' };

  it('reuses an acquired pooled session without opening a new one and emits the binding', async () => {
    const events: MindOSSSEvent[] = [];
    const created: string[] = [];
    const loaded: string[] = [];
    const closed: string[] = [];
    const released: Array<{ id: string; key: unknown }> = [];
    const acquiredKeys: unknown[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      externalSessionId: 'ext-1',
      hasContent: () => false,
      send: (event) => events.push(event),
      createSession: async () => { created.push('x'); return { id: 'new-1' }; },
      loadSession: async () => { loaded.push('x'); return { id: 'loaded-1' }; },
      acquireSession: async (key) => { acquiredKeys.push(key); return POOLED; },
      releaseSession: async (session, key) => { released.push({ id: session.id, key }); return true; },
      promptStream: async (_sessionId, _prompt, onUpdate) => { onUpdate({ type: 'text', text: 'hi' }); },
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
    });

    expect(result.error).toBeUndefined();
    expect(created).toEqual([]);
    expect(loaded).toEqual([]);
    expect(acquiredKeys).toEqual([POOL_KEY]);
    expect(events.some((event) => event.type === 'runtime_binding'
      && event.runtime === 'acp'
      && event.externalSessionId === 'ext-1')).toBe(true);
    expect(released).toEqual([{ id: 'pooled-1', key: POOL_KEY }]);
    // Parked, so never closed.
    expect(closed).toEqual([]);
  });

  it('closes the session when releaseSession reports it could not be parked', async () => {
    const closed: Array<{ id: string; closeAgentSession?: boolean }> = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      externalSessionId: 'ext-1',
      hasContent: () => false,
      send: () => {},
      createSession: async () => ({ id: 'new-1' }),
      acquireSession: async () => POOLED,
      releaseSession: async () => false,
      promptStream: async (_sessionId, _prompt, onUpdate) => { onUpdate({ type: 'text', text: 'hi' }); },
      closeSession: async (sessionId, options) => { closed.push({ id: sessionId, ...options }); },
      sleep: async () => {},
    });

    expect(result.error).toBeUndefined();
    // A resumable session keeps its agent-side session when closed.
    expect(closed).toEqual([{ id: 'pooled-1', closeAgentSession: false }]);
  });

  it('closes (does not park) the session when the turn times out', async () => {
    const released: string[] = [];
    const closed: string[] = [];

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      maxRetries: 1,
      timeoutMs: 20,
      externalSessionId: 'ext-1',
      hasContent: () => false,
      send: () => {},
      createSession: async () => POOLED,
      acquireSession: async () => undefined,
      releaseSession: async () => { released.push('x'); return true; },
      promptStream: () => new Promise<void>(() => {}),
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
    });

    expect((result.error as (Error & { code?: string }) | undefined)?.code).toBe('TIMEOUT');
    expect(released).toEqual([]);
    expect(closed).toContain('pooled-1');
  });

  it('parks the session on a retryable error so the next attempt reuses it instead of reopening', async () => {
    const events: MindOSSSEvent[] = [];
    const created: string[] = [];
    const closed: string[] = [];
    let parked: typeof POOLED | undefined;

    const result = await runMindosAcpAgentTurn({
      agentId: 'agent-1',
      cwd: '/mind',
      prompt: 'hello',
      externalSessionId: 'ext-1',
      hasContent: () => events.some((event) => event.type === 'text_delta'),
      send: (event) => events.push(event),
      createSession: async () => { created.push('x'); return { ...POOLED }; },
      acquireSession: async () => parked,
      releaseSession: async (session) => { parked = session as typeof POOLED; return true; },
      promptStream: async (sessionId, _prompt, onUpdate) => {
        if (sessionId === 'pooled-1' && created.length === 1 && !parked) {
          // First attempt on the freshly created session: a transient failure.
          throw new Error('socket hang up');
        }
        onUpdate({ type: 'text', text: 'recovered' });
      },
      closeSession: async (sessionId) => { closed.push(sessionId); },
      sleep: async () => {},
    });

    expect(result.error).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(closed).toEqual([]);
    expect(events.some((event) => event.type === 'text_delta' && event.delta === 'recovered')).toBe(true);
  });
});
