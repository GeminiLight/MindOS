import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listAgentRuns,
  resetAgentRunsForTest,
} from '@/lib/agent/run-ledger';

const mockFindAcpAgent = vi.fn();
const mockGetAcpAgents = vi.fn();
const mockCreateSessionFromEntry = vi.fn();
const mockPrompt = vi.fn();
const mockCloseSession = vi.fn();

vi.mock('@/lib/acp/registry', () => ({
  findAcpAgent: mockFindAcpAgent,
  getAcpAgents: mockGetAcpAgents,
}));

vi.mock('@/lib/acp/session', () => ({
  createSessionFromEntry: mockCreateSessionFromEntry,
  prompt: mockPrompt,
  closeSession: mockCloseSession,
}));

function getCallAcpAgentTool() {
  return import('@/lib/acp/acp-tools').then(({ acpTools }) => {
    const tool = acpTools.find((candidate) => candidate.name === 'call_acp_agent');
    if (!tool) throw new Error('call_acp_agent tool missing');
    return tool;
  });
}

describe('call_acp_agent run ledger integration', () => {
  beforeEach(() => {
    resetAgentRunsForTest();
    mockFindAcpAgent.mockReset();
    mockGetAcpAgents.mockReset();
    mockCreateSessionFromEntry.mockReset();
    mockPrompt.mockReset();
    mockCloseSession.mockReset();
  });

  it('records a completed ACP delegation while preserving the tool result', async () => {
    mockFindAcpAgent.mockResolvedValue({
      id: 'gemini',
      name: 'Gemini CLI',
      description: 'Gemini local agent',
      transport: 'stdio',
    });
    mockCreateSessionFromEntry.mockResolvedValue({ id: 'session-1' });
    mockPrompt.mockResolvedValue({ text: 'Here is the answer.' });
    mockCloseSession.mockResolvedValue(undefined);

    const tool = await getCallAcpAgentTool();
    const result = await tool.execute('tool-1', {
      agent_id: 'gemini',
      message: 'Summarize this folder.',
    });

    expect(result.content[0]?.text).toContain('**Gemini CLI** responded');
    expect(mockCreateSessionFromEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gemini' }),
      expect.objectContaining({ permissionMode: 'agent' }),
    );
    expect(mockCloseSession).toHaveBeenCalledWith('session-1');
    expect(listAgentRuns({ kind: 'acp' })).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'gemini',
        displayName: 'Gemini CLI',
        status: 'completed',
        permissionMode: 'agent',
        inputSummary: 'Summarize this folder.',
        outputSummary: 'Here is the answer.',
        metadata: expect.objectContaining({
          toolCallId: 'tool-1',
          sessionId: 'session-1',
        }),
      }),
    ]);
  });

  it('uses readonly ACP sessions when tool context carries readonly or organize policy', async () => {
    mockFindAcpAgent.mockResolvedValue({
      id: 'gemini',
      name: 'Gemini CLI',
      description: 'Gemini local agent',
      transport: 'stdio',
    });
    mockCreateSessionFromEntry.mockResolvedValue({ id: 'session-readonly' });
    mockPrompt.mockResolvedValue({ text: 'Read-only answer.' });
    mockCloseSession.mockResolvedValue(undefined);

    const tool = await getCallAcpAgentTool();
    const result = await tool.execute(
      'tool-readonly',
      {
        agent_id: 'gemini',
        message: 'Inspect this folder.',
      },
      undefined,
      undefined,
      { askMode: 'organize' },
    );

    expect(result.content[0]?.text).toContain('**Gemini CLI** responded');
    expect(mockCreateSessionFromEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gemini' }),
      expect.objectContaining({ permissionMode: 'readonly' }),
    );
    expect(listAgentRuns({ kind: 'acp' })).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'gemini',
        status: 'completed',
        permissionMode: 'readonly',
        inputSummary: 'Inspect this folder.',
        outputSummary: 'Read-only answer.',
      }),
    ]);
  });

  it('records a failed ACP run when the registry entry is missing', async () => {
    mockFindAcpAgent.mockResolvedValue(null);

    const tool = await getCallAcpAgentTool();
    const result = await tool.execute('tool-2', {
      agent_id: 'missing',
      message: 'Hello?',
    });

    expect(result.content[0]?.text).toContain('ACP agent not found: missing');
    expect(listAgentRuns({ kind: 'acp' })).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'missing',
        displayName: 'missing',
        status: 'failed',
        permissionMode: 'agent',
        inputSummary: 'Hello?',
        error: 'ACP agent not found: missing.',
      }),
    ]);
  });

  it('records prompt failures and still closes the ACP session', async () => {
    mockFindAcpAgent.mockResolvedValue({
      id: 'claude-acp',
      name: 'Claude ACP',
      description: 'Claude via ACP',
      transport: 'stdio',
    });
    mockCreateSessionFromEntry.mockResolvedValue({ id: 'session-fail' });
    mockPrompt.mockRejectedValue(new Error('agent crashed'));
    mockCloseSession.mockResolvedValue(undefined);

    const tool = await getCallAcpAgentTool();
    const result = await tool.execute('tool-3', {
      agent_id: 'claude-acp',
      message: 'Continue.',
    });

    expect(result.content[0]?.text).toContain('ACP call failed: agent crashed');
    expect(mockCloseSession).toHaveBeenCalledWith('session-fail');
    expect(listAgentRuns({ kind: 'acp' })).toEqual([
      expect.objectContaining({
        agentKind: 'acp',
        runtimeId: 'claude-acp',
        displayName: 'Claude ACP',
        status: 'failed',
        error: 'agent crashed',
        metadata: expect.objectContaining({ sessionId: 'session-fail' }),
      }),
    ]);
  });
});
