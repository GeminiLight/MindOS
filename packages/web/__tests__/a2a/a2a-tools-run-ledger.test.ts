import { beforeEach, describe, expect, it, vi } from 'vitest';
import { a2aTools } from '../../lib/a2a/a2a-tools';
import { clearDelegationHistory, clearRegistry, discoverAgent } from '../../lib/a2a/client';
import {
  listAgentEvents,
  listAgentRuns,
  resetAgentRunsForTest,
} from '@geminilight/mindos/agent/ledger/run-ledger';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CARD = {
  name: 'RemoteWorker',
  description: 'A remote test agent',
  version: '1.0.0',
  provider: { organization: 'Test', url: 'http://test:3000' },
  supportedInterfaces: [{ url: 'http://test:3000/api/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'test-skill', name: 'Test Skill', description: 'A test skill' }],
};

function delegateTool() {
  const tool = a2aTools.find((candidate) => candidate.name === 'delegate_to_agent');
  if (!tool) throw new Error('delegate_to_agent tool missing');
  return tool;
}

describe('A2A tool run ledger integration', () => {
  beforeEach(() => {
    clearRegistry();
    clearDelegationHistory();
    resetAgentRunsForTest();
    mockFetch.mockReset();
  });

  it('records a canceled A2A run when the tool signal aborts', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_CARD });
    const agent = await discoverAgent('http://test:3000');
    const controller = new AbortController();
    mockFetch.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    }));

    const pending = delegateTool().execute('tool-a2a-cancel', {
      agent_id: agent!.id,
      message: 'Cancel remote work.',
    }, controller.signal);
    controller.abort(new DOMException('User stopped the run.', 'AbortError'));

    const result = await pending;

    expect(result.content[0]?.text).toContain('Delegation failed: User stopped the run.');
    expect(listAgentRuns({ kind: 'a2a' })).toEqual([
      expect.objectContaining({
        agentKind: 'a2a',
        runtimeId: agent!.id,
        status: 'canceled',
        error: 'A2A delegation canceled.',
        metadata: expect.objectContaining({
          toolCallId: 'tool-a2a-cancel',
          aborted: true,
        }),
      }),
    ]);
    expect(listAgentEvents({ type: 'run_canceled' })).toHaveLength(1);
  });
});
