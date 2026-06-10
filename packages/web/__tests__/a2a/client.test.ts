import { describe, it, expect, beforeEach, vi } from 'vitest';
import { discoverAgent, discoverAgents, getDiscoveredAgents, clearRegistry, delegateTask, checkRemoteTaskStatus, getDelegationHistory, clearDelegationHistory } from '../../lib/a2a/client';

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

describe('A2A Client', () => {
  beforeEach(() => {
    clearRegistry();
    clearDelegationHistory();
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

    it('strips trailing slashes from URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000///');
      expect(agent).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://test:3000/.well-known/agent-card.json',
        expect.any(Object)
      );
    });

    it('returns null for non-http discovery URL without fetching', async () => {
      const agent = await discoverAgent('file:///tmp/a2a');
      expect(agent).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for malformed discovery URL without fetching', async () => {
      const agent = await discoverAgent('not a url');
      expect(agent).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for discovery URL with query or hash without fetching', async () => {
      const agent = await discoverAgent('https://agent.example/path?token=secret#card');
      expect(agent).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null for discovery URL with embedded credentials', async () => {
      const agent = await discoverAgent('https://user:pass@test:3000');
      expect(agent).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('blocks localhost and private-network discovery URLs by default', async () => {
      await expect(discoverAgent('http://127.0.0.1:3456')).resolves.toBeNull();
      await expect(discoverAgent('http://localhost:3456')).resolves.toBeNull();
      await expect(discoverAgent('http://192.168.1.10:3456')).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows private-network discovery only when explicitly enabled', async () => {
      const localCard = {
        ...MOCK_CARD,
        supportedInterfaces: [{ url: 'http://127.0.0.1:3456/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => localCard });

      const agent = await discoverAgent('http://127.0.0.1:3456', { allowPrivateNetwork: true });

      expect(agent).not.toBeNull();
      expect(agent!.endpoint).toBe('http://127.0.0.1:3456/api/a2a');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:3456/.well-known/agent-card.json',
        expect.any(Object),
      );
    });

    it('enforces an explicit discovery allowlist when configured', async () => {
      await expect(discoverAgent('https://evil.example', {
        allowedOrigins: ['https://allowed.example'],
      })).resolves.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();

      const allowedCard = {
        ...MOCK_CARD,
        supportedInterfaces: [{ url: 'https://allowed.example/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => allowedCard });

      const agent = await discoverAgent('https://allowed.example', {
        allowedOrigins: ['https://allowed.example'],
      });

      expect(agent).not.toBeNull();
      expect(agent!.endpoint).toBe('https://allowed.example/api/a2a');
    });

    it('returns null for unreachable URL', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const agent = await discoverAgent('http://dead:9999');
      expect(agent).toBeNull();
    });

    it('returns null for non-A2A server (404)', async () => {
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

    it('returns null for card with non-http JSONRPC endpoint', async () => {
      const cardFileRpc = {
        ...MOCK_CARD,
        supportedInterfaces: [{ url: 'file:///tmp/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => cardFileRpc });
      const agent = await discoverAgent('http://file-endpoint:3000');
      expect(agent).toBeNull();
      expect(getDiscoveredAgents()).toHaveLength(0);
    });

    it('returns null for card with credentialed JSONRPC endpoint', async () => {
      const cardCredentialedRpc = {
        ...MOCK_CARD,
        supportedInterfaces: [{ url: 'https://user:pass@test:3000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => cardCredentialedRpc });
      const agent = await discoverAgent('http://credentialed-endpoint:3000');
      expect(agent).toBeNull();
      expect(getDiscoveredAgents()).toHaveLength(0);
    });

    it('returns null when a public card points its JSONRPC endpoint at a private network URL', async () => {
      const cardPrivateRpc = {
        ...MOCK_CARD,
        supportedInterfaces: [{ url: 'http://127.0.0.1:9999/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => cardPrivateRpc });

      const agent = await discoverAgent('https://public-agent.example');

      expect(agent).toBeNull();
      expect(getDiscoveredAgents()).toHaveLength(0);
    });

    it('uses the first valid JSONRPC endpoint and trims whitespace', async () => {
      const cardMixedRpc = {
        ...MOCK_CARD,
        supportedInterfaces: [
          { url: 'file:///tmp/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
          { url: ' https://valid.example/api/a2a ', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
        ],
      };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => cardMixedRpc });
      const agent = await discoverAgent('http://mixed-endpoint:3000');
      expect(agent).not.toBeNull();
      expect(agent!.endpoint).toBe('https://valid.example/api/a2a');
    });

    it('returns null for malformed card (missing name)', async () => {
      const badCard = { description: 'no name field', supportedInterfaces: [] };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => badCard });
      const agent = await discoverAgent('http://bad-card:3000');
      expect(agent).toBeNull();
    });

    it('returns null for non-object JSON response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => 'just a string' });
      const agent = await discoverAgent('http://string-response:3000');
      expect(agent).toBeNull();
    });

    it('caches discovered agents', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      await discoverAgent('http://test:3000');
      const cached = await discoverAgent('http://test:3000');
      expect(cached).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('generates different IDs for http vs https on same host', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const card2 = { ...MOCK_CARD, name: 'TestAgent2', supportedInterfaces: [{ url: 'https://test:3000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => card2 });

      await discoverAgent('http://test:3000');
      await discoverAgent('https://test:3000');

      expect(getDiscoveredAgents()).toHaveLength(2);
    });

    it('marks cached agent as unreachable on network error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://flaky:3000');
      expect(agent!.reachable).toBe(true);

      // Force cache expiry by manipulating discoveredAt
      agent!.discoveredAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      const stale = await discoverAgent('http://flaky:3000');
      expect(stale!.reachable).toBe(false);
    });
  });

  describe('discoverAgents', () => {
    it('discovers multiple agents concurrently', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const card2 = { ...MOCK_CARD, name: 'Agent2', supportedInterfaces: [{ url: 'http://other:4000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] };
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => card2 });

      const agents = await discoverAgents(['http://test:3000', 'http://other:4000']);
      expect(agents).toHaveLength(2);
    });

    it('returns empty array when all fail', async () => {
      mockFetch.mockRejectedValue(new Error('all down'));
      const agents = await discoverAgents(['http://a:1', 'http://b:2']);
      expect(agents).toHaveLength(0);
    });

    it('returns partial results (best-effort)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      mockFetch.mockRejectedValueOnce(new Error('down'));

      const agents = await discoverAgents(['http://test:3000', 'http://dead:9999']);
      expect(agents).toHaveLength(1);
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

    it('throws for unreachable agent', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');
      agent!.reachable = false;

      await expect(delegateTask(agent!.id, 'hello')).rejects.toThrow('not reachable');
    });

    it('delegates and returns completed task', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      const mockTask = {
        id: 'task-123',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: new Date().toISOString() },
        artifacts: [{ artifactId: 'a1', parts: [{ text: 'result text' }] }],
      };
      mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));

      const task = await delegateTask(agent!.id, 'do something');
      expect(task.id).toBe('task-123');
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
    });

    it('throws on RPC error response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      mockFetch.mockResolvedValueOnce(mockRpcError(-32603, 'Internal error'));

      await expect(delegateTask(agent!.id, 'fail')).rejects.toThrow('A2A error [-32603]');
    });

    it('throws on malformed RPC task result', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      mockFetch.mockResolvedValueOnce(mockRpcResponse({ id: 'task-without-status' }));

      await expect(delegateTask(agent!.id, 'malformed')).rejects.toThrow('Invalid A2A task response');
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

      await expect(delegateTask(agent!.id, 'fail')).rejects.toThrow('A2A RPC failed: 500');
    });

    it('sends correct JSON-RPC body', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      const mockTask = { id: 't1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '' } };
      mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));

      await delegateTask(agent!.id, 'test message');

      const rpcCall = mockFetch.mock.calls[1];
      const body = JSON.parse(rpcCall[1].body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('SendMessage');
      expect(body.params.message.role).toBe('ROLE_USER');
      expect(body.params.message.parts[0].text).toBe('test message');
    });

    it('cancels the RPC and records canceled history when the caller signal aborts', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');
      const controller = new AbortController();
      mockFetch.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      }));

      const pending = delegateTask(agent!.id, 'cancel this', undefined, { signal: controller.signal });
      controller.abort(new DOMException('User stopped the run.', 'AbortError'));

      await expect(pending).rejects.toThrow('User stopped the run.');
      expect(getDelegationHistory()).toEqual([
        expect.objectContaining({
          agentId: agent!.id,
          message: 'cancel this',
          status: 'canceled',
          error: 'A2A delegation canceled.',
        }),
      ]);
    });
  });

  describe('checkRemoteTaskStatus', () => {
    it('throws for unknown agent', async () => {
      await expect(checkRemoteTaskStatus('nonexistent', 'task-1')).rejects.toThrow('Agent not found');
    });

    it('returns working task status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      const mockTask = { id: 'task-456', status: { state: 'TASK_STATE_WORKING', timestamp: '' } };
      mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));

      const task = await checkRemoteTaskStatus(agent!.id, 'task-456');
      expect(task.status.state).toBe('TASK_STATE_WORKING');
    });

    it('returns completed task with artifacts', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      const mockTask = {
        id: 'task-789',
        status: { state: 'TASK_STATE_COMPLETED', timestamp: '' },
        artifacts: [{ artifactId: 'a1', name: 'output', parts: [{ text: 'done!' }] }],
      };
      mockFetch.mockResolvedValueOnce(mockRpcResponse(mockTask));

      const task = await checkRemoteTaskStatus(agent!.id, 'task-789');
      expect(task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(task.artifacts![0].parts[0].text).toBe('done!');
    });

    it('throws on RPC error (task not found)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      mockFetch.mockResolvedValueOnce(mockRpcError(-32001, 'Task not found'));

      await expect(checkRemoteTaskStatus(agent!.id, 'gone')).rejects.toThrow('A2A error [-32001]');
    });

    it('throws on malformed task status result', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
      const agent = await discoverAgent('http://test:3000');

      mockFetch.mockResolvedValueOnce(mockRpcResponse({ id: 'task-without-status' }));

      await expect(checkRemoteTaskStatus(agent!.id, 'bad')).rejects.toThrow('Invalid A2A task response');
    });
  });
});
