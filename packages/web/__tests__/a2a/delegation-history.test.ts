import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  discoverAgent,
  delegateTask,
  getDelegationHistory,
  clearDelegationHistory,
  clearRegistry,
} from '../../lib/a2a/client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CARD = {
  name: 'TestAgent',
  description: 'A test agent',
  version: '1.0.0',
  provider: { organization: 'Test', url: 'http://test:3000' },
  supportedInterfaces: [{ url: 'http://test:3000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'test-skill', name: 'Test Skill', description: 'A test skill' }],
};

function mockRpcResponse(result: unknown) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: '1', result }) };
}

function mockRpcError(code: number, message: string) {
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: '1', error: { code, message } }) };
}

describe('Delegation History', () => {
  beforeEach(() => {
    clearRegistry();
    clearDelegationHistory();
    mockFetch.mockReset();
  });

  it('records a completed delegation to history', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');

    const mockTask = {
      id: 'task-1',
      status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
      artifacts: [{ artifactId: 'a1', parts: [{ text: 'done' }] }],
    };
    mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));

    await delegateTask(agent!.id, 'do something');

    const history = getDelegationHistory();
    expect(history).toHaveLength(1);
    expect(history[0].agentId).toBe(agent!.id);
    expect(history[0].agentName).toBe('TestAgent');
    expect(history[0].message).toBe('do something');
    expect(history[0].status).toBe('completed');
    expect(history[0].result).toBe('done');
    expect(history[0].error).toBeNull();
    expect(history[0].completedAt).not.toBeNull();
  });

  it('getDelegationHistory returns all recorded delegations', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');

    const mockTask = { id: 't1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '' } };
    mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));
    await delegateTask(agent!.id, 'first');

    mockFetch.mockResolvedValueOnce(mockRpcResponse({ ...mockTask, id: 't2' }));
    await delegateTask(agent!.id, 'second');

    expect(getDelegationHistory()).toHaveLength(2);
  });

  it('clearDelegationHistory empties the array', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');

    const mockTask = { id: 't1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '' } };
    mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));
    await delegateTask(agent!.id, 'test');

    expect(getDelegationHistory()).toHaveLength(1);
    clearDelegationHistory();
    expect(getDelegationHistory()).toHaveLength(0);
  });

  it('records failed delegation with error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');

    mockFetch.mockResolvedValueOnce(mockRpcError(-32603, 'Internal error'));

    await expect(delegateTask(agent!.id, 'fail')).rejects.toThrow('A2A error [-32603]');

    const history = getDelegationHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].error).toContain('-32603');
    expect(history[0].completedAt).not.toBeNull();
  });

  it('records failed delegation on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');

    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    await expect(delegateTask(agent!.id, 'http-fail')).rejects.toThrow('A2A RPC failed');

    const history = getDelegationHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('failed');
    expect(history[0].error).toContain('A2A RPC failed');
  });

  it('returns a copy from getDelegationHistory, not a reference', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');

    const mockTask = { id: 't1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '' } };
    mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));
    await delegateTask(agent!.id, 'test');

    const h1 = getDelegationHistory();
    const h2 = getDelegationHistory();
    expect(h1).not.toBe(h2);
    expect(h1).toEqual(h2);
  });
});
