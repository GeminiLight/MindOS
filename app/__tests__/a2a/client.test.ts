import { describe, it, expect, beforeEach, vi } from 'vitest';
import { discoverAgent, getDiscoveredAgents, clearRegistry, delegateTask, checkRemoteTaskStatus } from '../../lib/a2a/client';

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

describe('A2A Client', () => {
  beforeEach(() => {
    clearRegistry();
    mockFetch.mockReset();
  });

  describe('discoverAgent', () => {
    it('discovers an agent from a valid agent card URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');
      expect(agent).not.toBeNull();
      expect(agent!.card.name).toBe('TestAgent');
      expect(agent!.endpoint).toBe('http://test:3000/api/a2a');
      expect(agent!.reachable).toBe(true);
    });

    it('returns null for unreachable URL', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const agent = await discoverAgent('http://dead:9999');
      expect(agent).toBeNull();
    });

    it('returns null for non-A2A server', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const agent = await discoverAgent('http://notana2a:3000');
      expect(agent).toBeNull();
    });

    it('returns null for card without JSONRPC interface', async () => {
      const cardNoRpc = {
        ...MOCK_CARD,
        supportedInterfaces: [{ url: 'http://x/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0' }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => cardNoRpc });
      const agent = await discoverAgent('http://grpc-only:3000');
      expect(agent).toBeNull();
    });

    it('caches discovered agents', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      await discoverAgent('http://test:3000');
      const cached = await discoverAgent('http://test:3000');
      expect(cached).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDiscoveredAgents', () => {
    it('returns empty when no agents discovered', () => {
      expect(getDiscoveredAgents()).toHaveLength(0);
    });

    it('returns all discovered agents', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      await discoverAgent('http://test:3000');
      expect(getDiscoveredAgents()).toHaveLength(1);
    });
  });

  describe('delegateTask', () => {
    it('throws for unknown agent', async () => {
      await expect(delegateTask('nonexistent', 'hello')).rejects.toThrow('Agent not found');
    });

    it('delegates and returns completed task', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      const mockTask = {
        id: 'task-123',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
        artifacts: [{ artifactId: 'a1', parts: [{ text: 'result text' }] }],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: '1', result: mockTask }),
      });

      const task = await delegateTask(agent!.id, 'do something');
      expect(task.id).toBe('task-123');
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    });

    it('throws on RPC error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: '1', error: { code: -32603, message: 'Internal error' } }),
      });

      await expect(delegateTask(agent!.id, 'fail')).rejects.toThrow('A2A error');
    });
  });

  describe('checkRemoteTaskStatus', () => {
    it('throws for unknown agent', async () => {
      await expect(checkRemoteTaskStatus('nonexistent', 'task-1')).rejects.toThrow('Agent not found');
    });

    it('returns task status from remote agent', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      const mockTask = {
        id: 'task-456',
        status: { state: 'TASK_STATE_WORKING', timestamp: new Date().toISOString() },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: '1', result: mockTask }),
      });

      const task = await checkRemoteTaskStatus(agent!.id, 'task-456');
      expect(task.status.state).toBe('TASK_STATE_WORKING');
    });
  });
});
