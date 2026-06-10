import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDetectLocalAcpAgents = vi.fn();
const mockResolveCommandPath = vi.fn();
const mockCheckNativeRuntimeHealth = vi.fn();

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mockDetectLocalAcpAgents,
  resolveCommandPath: mockResolveCommandPath,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ acpAgents: {} }),
}));

describe('/api/agent-runtimes', () => {
  beforeEach(() => {
    mockDetectLocalAcpAgents.mockReset();
    mockResolveCommandPath.mockReset();
    mockCheckNativeRuntimeHealth.mockReset();
  });

  it('returns MindOS, native Codex/Claude descriptors, and available ACP runtimes', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'codex') return '/usr/local/bin/codex';
      if (command === 'claude') return null;
      return null;
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' },
        { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'available' },
      ],
      notInstalled: [
        { id: 'claude-code', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' },
      ],
    });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mindos',
        kind: 'mindos',
        adapter: 'mindos',
        modelOwner: 'mindos',
        authOwner: 'mindos',
        permissionOwner: 'mindos',
        sessionOwner: 'mindos',
        status: 'available',
        capabilities: expect.objectContaining({
          ownsModelSelection: true,
          supportsListSessions: true,
          supportsUserInput: true,
          supportsToolEvents: true,
          supportsRuntimeStatus: true,
        }),
      }),
      expect.objectContaining({
        id: 'codex',
        kind: 'codex',
        adapter: 'codex-app-server',
        modelOwner: 'external',
        authOwner: 'external',
        permissionOwner: 'external',
        sessionOwner: 'external',
        status: 'available',
        sourceAgentId: 'codex-acp',
        binaryPath: '/usr/local/bin/codex',
        availability: expect.objectContaining({ sources: ['native-health'] }),
        capabilities: expect.objectContaining({
          supportsResume: true,
          supportsFreshSession: true,
          supportsListSessions: true,
          supportsAttachExisting: true,
          supportsFork: true,
          supportsArchive: true,
          supportsApprovals: true,
          supportsUserInput: true,
          supportsToolEvents: true,
          supportsCheckpoints: false,
        }),
      }),
      expect.objectContaining({
        id: 'claude',
        kind: 'claude',
        adapter: 'claude-sdk',
        modelOwner: 'external',
        authOwner: 'external',
        permissionOwner: 'external',
        sessionOwner: 'external',
        status: 'available',
        binaryPath: 'sdk:@anthropic-ai/claude-agent-sdk',
        availability: expect.objectContaining({
          sources: ['native-health'],
        }),
      }),
      expect.objectContaining({
        id: 'gemini',
        kind: 'acp',
        adapter: 'acp',
        modelOwner: 'external',
        authOwner: 'external',
        permissionOwner: 'external',
        sessionOwner: 'external',
        status: 'available',
        capabilities: expect.objectContaining({
          supportsResume: false,
          supportsToolEvents: true,
          supportsApprovals: false,
        }),
      }),
    ]));
    const claudeRuntime = body.runtimes.find((runtime: any) => runtime.id === 'claude');
    expect(claudeRuntime?.availability?.diagnosticHints ?? []).not.toContain(
      'Global claude command was not detected; CLI fallback will be unavailable until it is installed or on MindOS server PATH.',
    );
    expect(body.installed).toHaveLength(2);
    expect(body.notInstalled).toHaveLength(1);
  });

  it('preserves signed-out and error statuses for runtime menu display', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'codex') return '/usr/local/bin/codex';
      if (command === 'claude') return null;
      return null;
    });
    mockCheckNativeRuntimeHealth.mockImplementation(async ({ runtime }) => (
      runtime === 'codex'
        ? { status: 'signed-out', reason: 'Run codex login first.' }
        : { status: 'error', reason: 'not checked' }
    ));
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'signed-out', reason: 'Run codex login first.' },
        { id: 'opencode', name: 'OpenCode', binaryPath: '/usr/local/bin/opencode', status: 'error', reason: 'Config file is invalid.' },
      ],
      notInstalled: [
        { id: 'claude-code', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' },
      ],
    });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'codex',
        kind: 'codex',
        adapter: 'codex-app-server',
        status: 'signed-out',
        availability: expect.objectContaining({
          reason: 'Run codex login first.',
          sources: ['native-health'],
          diagnosticHints: expect.arrayContaining([
            'MindOS detected Codex at /usr/local/bin/codex.',
            'Run "codex login status" from the same environment that starts MindOS.',
          ]),
        }),
      }),
      expect.objectContaining({
        id: 'opencode',
        kind: 'acp',
        adapter: 'acp',
        status: 'error',
        availability: expect.objectContaining({ reason: 'Config file is invalid.' }),
      }),
    ]));
  });

  it('does not mix native runtime detection into ACP installed lists', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'codex') return '/usr/local/bin/codex';
      if (command === 'claude') return '/usr/local/bin/claude';
      return null;
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'available' },
      ],
      notInstalled: [],
    });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex', kind: 'codex', status: 'available' }),
      expect.objectContaining({ id: 'claude', kind: 'claude', status: 'available' }),
      expect.objectContaining({ id: 'gemini', kind: 'acp', status: 'available' }),
    ]));
    expect(body.installed).toEqual([
      expect.objectContaining({ id: 'gemini', name: 'Gemini CLI' }),
    ]);
    expect(body.notInstalled).toEqual([]);
  });

  it('checks a single native runtime without ACP detection', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'claude') return '/usr/local/bin/claude';
      return null;
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' }],
      notInstalled: [],
    });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes?runtime=claude'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mockDetectLocalAcpAgents).not.toHaveBeenCalled();
    expect(mockCheckNativeRuntimeHealth).toHaveBeenCalledTimes(1);
    expect(mockCheckNativeRuntimeHealth).toHaveBeenCalledWith({
      runtime: 'claude',
      agent: expect.objectContaining({ id: 'claude', binaryPath: '/usr/local/bin/claude' }),
      timeoutMs: 20000,
    });
    expect(body).toEqual({
      runtime: expect.objectContaining({
        id: 'claude',
        kind: 'claude',
        adapter: 'claude-sdk',
        modelOwner: 'external',
        permissionOwner: 'external',
        status: 'available',
        binaryPath: '/usr/local/bin/claude',
        capabilities: expect.objectContaining({
          supportsApprovals: true,
          supportsUserInput: true,
          supportsToolEvents: true,
          supportsCheckpoints: false,
        }),
      }),
    });
  });

  it('checks ACP scope without native Codex or Claude health detection', async () => {
    mockResolveCommandPath.mockResolvedValue('/should-not-be-used');
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' },
        { id: 'claude-code', name: 'Claude Code', binaryPath: '/usr/local/bin/claude', status: 'available' },
        { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'available' },
      ],
      notInstalled: [
        { id: 'claude', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' },
        { id: 'opencode', name: 'OpenCode', installCmd: 'npm install -g opencode-ai' },
      ],
    });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes?scope=acp'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockResolveCommandPath).not.toHaveBeenCalled();
    expect(mockCheckNativeRuntimeHealth).not.toHaveBeenCalled();
    expect(mockDetectLocalAcpAgents).toHaveBeenCalledTimes(1);
    expect(body.runtimes).toEqual([
      expect.objectContaining({
        id: 'gemini',
        kind: 'acp',
        adapter: 'acp',
        status: 'available',
      }),
    ]);
    expect(body.installed).toEqual([
      expect.objectContaining({ id: 'gemini', name: 'Gemini CLI' }),
    ]);
    expect(body.notInstalled).toEqual([
      expect.objectContaining({ id: 'opencode', name: 'OpenCode' }),
    ]);
  });
});
