import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDetectLocalAcpAgents = vi.fn();
const mockResolveCommandPath = vi.fn();
const mockResolveCommandPathCandidates = vi.fn();
const mockCheckNativeRuntimeHealth = vi.fn();
const RAW_CODEX_OPTIONAL_DEPENDENCY_STACK = [
  'file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102',
  'throw new Error(`^ Error: Missing optional dependency @openai/codex-darwin-x64. Reinstall Codex: npm install -g @openai/codex@latest',
  'at findCodexExecutable (file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102:9)',
  'at ModuleJob.run (node:internal/modules/esm/module_job:274:25)',
  'at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)',
  'Node.js v22.16.0',
].join('\n');

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mockDetectLocalAcpAgents,
  resolveCommandPath: mockResolveCommandPath,
  resolveCommandPathCandidates: mockResolveCommandPathCandidates,
  checkNativeRuntimeHealth: mockCheckNativeRuntimeHealth,
}));

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ acpAgents: {} }),
}));

describe('/api/agent-runtimes', () => {
  beforeEach(() => {
    mockDetectLocalAcpAgents.mockReset();
    mockResolveCommandPath.mockReset();
    mockResolveCommandPathCandidates.mockReset();
    mockResolveCommandPathCandidates.mockResolvedValue([]);
    mockCheckNativeRuntimeHealth.mockReset();
  });

  it('returns MindOS, native Codex/Claude descriptors, and available ACP runtimes', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'codex') return '/usr/local/bin/codex';
      if (command === 'claude') return '/usr/local/bin/claude';
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
        binaryPath: '/usr/local/bin/claude',
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
      'Install Claude Code locally or add claude to the PATH used to start MindOS.',
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

  it('returns Claude Code CLI fallback bridge metadata when the SDK bridge is unavailable', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'claude') return '/usr/local/bin/claude';
      return null;
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({
      status: 'available',
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason: 'SDK missing',
      },
      diagnosticHints: ['Claude Code CLI is available; Claude Agent SDK bridge is unavailable, so MindOS will use CLI fallback. SDK missing'],
    });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes?runtime=claude'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtime).toMatchObject({
      id: 'claude',
      kind: 'claude',
      adapter: 'claude-cli',
      status: 'available',
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason: 'SDK missing',
      },
    });
  });

  it('compacts native runtime startup stacks before returning them to the UI', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'codex') return '/opt/homebrew/bin/codex';
      return null;
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({
      status: 'error',
      reason: RAW_CODEX_OPTIONAL_DEPENDENCY_STACK,
      diagnosticHints: [RAW_CODEX_OPTIONAL_DEPENDENCY_STACK],
    });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes?runtime=codex'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtime).toMatchObject({
      id: 'codex',
      status: 'error',
      availability: expect.objectContaining({
        reason: 'Codex is installed but incomplete. Reinstall Codex with "npm install -g @openai/codex@latest", then restart MindOS.',
      }),
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('file:///opt/homebrew');
    expect(serialized).not.toContain('throw new Error');
    expect(serialized).not.toContain('ModuleJob.run');
    expect(serialized).not.toContain('node:internal');
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
