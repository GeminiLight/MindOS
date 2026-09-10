import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentRunStatusLabel,
  filterAgentRunTraces,
  replayAgentRunCapsule,
} from '@/lib/agent-run-observatory';
import type { AgentRunObservatoryTrace } from '@geminilight/mindos/server';

interface RecoveryFetchOptions {
  plan?: { ok?: boolean; status?: number; body?: unknown };
  turn?: { ok?: boolean; status?: number; text: string };
}

function mockRecoveryFetch(options: RecoveryFetchOptions = {}) {
  const plan = { ok: true, status: 200, body: { plan: { id: 'plan-1', targetChatSessionId: 'chat-1' } }, ...options.plan };
  const turn = { ok: true, status: 200, text: '', ...options.turn };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/agent-run-capsules/')) {
      return { ok: plan.ok, status: plan.status, json: async () => plan.body };
    }
    if (url.startsWith('/api/agent/sessions/')) {
      return { ok: turn.ok, status: turn.status, text: async () => turn.text };
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('replayAgentRunCapsule', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects with the streamed error message when the turn emits data:{...} without a space', async () => {
    mockRecoveryFetch({ turn: { text: 'data:{"type":"error","message":"boom"}\n\n' } });
    await expect(replayAgentRunCapsule('cap-1', 'retry')).rejects.toThrow('boom');
  });

  it('rejects with the streamed error message when the turn emits data: {...} with a space', async () => {
    mockRecoveryFetch({ turn: { text: 'data: {"type":"error","message":"boom"}\n\n' } });
    await expect(replayAgentRunCapsule('cap-1', 'retry')).rejects.toThrow('boom');
  });

  it('resolves with the plan and session ids when the turn stream completes', async () => {
    const fetchMock = mockRecoveryFetch({ turn: { text: 'data:{"type":"done"}\n\n' } });
    await expect(replayAgentRunCapsule('cap-1', 'resume')).resolves.toEqual({ planId: 'plan-1', chatSessionId: 'chat-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/agent-run-capsules/cap-1/recovery');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/agent/sessions/chat-1/turns');
  });

  it('falls back to a recovery session id when the plan has no target session', async () => {
    mockRecoveryFetch({ plan: { body: { plan: { id: 'plan-9' } } }, turn: { text: 'data:{"type":"done"}\n\n' } });
    await expect(replayAgentRunCapsule('cap-1', 'fork')).resolves.toEqual({ planId: 'plan-9', chatSessionId: 'recovery-plan-9' });
  });

  it('rejects with the JSON error when the turn response is not ok', async () => {
    mockRecoveryFetch({ turn: { ok: false, status: 503, text: JSON.stringify({ error: 'runtime unavailable' }) } });
    await expect(replayAgentRunCapsule('cap-1', 'retry')).rejects.toThrow('runtime unavailable');
  });

  it('rejects with a status message when the failed turn response is not JSON', async () => {
    mockRecoveryFetch({ turn: { ok: false, status: 500, text: 'Internal error' } });
    await expect(replayAgentRunCapsule('cap-1', 'retry')).rejects.toThrow('Recovery run failed to start (500)');
  });

  it('rejects with the plan error when recovery planning is not ok', async () => {
    const fetchMock = mockRecoveryFetch({ plan: { ok: false, status: 409, body: { error: 'capsule already replayed' } } });
    await expect(replayAgentRunCapsule('cap-1', 'retry')).rejects.toThrow('capsule already replayed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed and non-error frames in the turn stream', async () => {
    mockRecoveryFetch({ turn: { text: 'data:{bad json}\n\ndata:{"type":"text_delta","delta":"hi"}\n\n' } });
    await expect(replayAgentRunCapsule('cap-1', 'retry')).resolves.toEqual({ planId: 'plan-1', chatSessionId: 'chat-1' });
  });
});

describe('filterAgentRunTraces', () => {
  const trace = (status: AgentRunObservatoryTrace['status']) => ({ status } as AgentRunObservatoryTrace);
  const traces = [
    trace('queued'), trace('running'), trace('streaming'), trace('waiting_approval'),
    trace('failed'), trace('timed_out'), trace('interrupted'), trace('canceled'), trace('completed'),
  ];

  it('returns every trace for the all filter', () => {
    expect(filterAgentRunTraces(traces, 'all')).toBe(traces);
  });

  it('groups statuses by filter', () => {
    expect(filterAgentRunTraces(traces, 'active').map((t) => t.status)).toEqual(['queued', 'running', 'streaming']);
    expect(filterAgentRunTraces(traces, 'waiting').map((t) => t.status)).toEqual(['waiting_approval']);
    expect(filterAgentRunTraces(traces, 'issues').map((t) => t.status)).toEqual(['failed', 'timed_out', 'interrupted', 'canceled']);
    expect(filterAgentRunTraces(traces, 'completed').map((t) => t.status)).toEqual(['completed']);
  });
});

describe('agentRunStatusLabel', () => {
  it('formats English labels', () => {
    expect(agentRunStatusLabel('waiting_approval')).toBe('Waiting for approval');
    expect(agentRunStatusLabel('timed_out')).toBe('Timed out');
    expect(agentRunStatusLabel('running')).toBe('Running');
  });

  it('formats Chinese labels', () => {
    expect(agentRunStatusLabel('waiting_approval', 'zh')).toBe('待审批');
    expect(agentRunStatusLabel('completed', 'zh')).toBe('已完成');
  });
});
