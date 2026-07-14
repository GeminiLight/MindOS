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
        {
          id: 'codex-acp',
          name: 'Codex',
          binaryPath: '/usr/local/bin/codex',
          resolvedCommand: { cmd: 'codex', args: [], source: 'descriptor' },
          status: 'available',
        },
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
          agentModes: {
            plan: 'mindos-managed',
            goal: 'mindos-managed',
          },
          ownsModelSelection: true,
          supportsListSessions: true,
          supportsUserInput: true,
          supportsToolEvents: true,
          supportsRuntimeStatus: true,
        }),
        lifecycle: expect.objectContaining({
          stages: expect.objectContaining({
            session: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            context: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
          }),
          remote: expect.objectContaining({ mode: 'server-runnable', unattended: 'limited' }),
          coordination: expect.objectContaining({ role: 'primary', supportsSharedContext: true }),
        }),
        compatibility: expect.objectContaining({
          scenarios: expect.objectContaining({
            'interactive-turn': expect.objectContaining({ level: 'ready' }),
            'remote-control': expect.objectContaining({ level: 'limited' }),
            'unattended-automation': expect.objectContaining({
              level: 'limited',
              blockers: expect.arrayContaining(['scheduler', 'approval-routing']),
            }),
          }),
        }),
        adapterContract: expect.objectContaining({
          connection: expect.objectContaining({ kind: 'internal', owner: 'mindos' }),
          configuration: expect.objectContaining({
            modelSelection: 'mindos-session',
            credentials: 'mindos-settings',
          }),
          commands: expect.objectContaining({ discovery: 'mindos-skills' }),
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
          agentModes: {
            plan: 'runtime-native',
            goal: 'runtime-native',
          },
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
        lifecycle: expect.objectContaining({
          stages: expect.objectContaining({
            detect: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            session: expect.objectContaining({ support: 'delegated', owner: 'external' }),
            context: expect.objectContaining({ support: 'delegated', owner: 'external' }),
            archive: expect.objectContaining({ support: 'delegated', owner: 'external' }),
          }),
          coordination: expect.objectContaining({ role: 'external-worker', supportsMailbox: false }),
        }),
        compatibility: expect.objectContaining({
          scenarios: expect.objectContaining({
            'coding-workflow': expect.objectContaining({ level: 'ready' }),
            'remote-control': expect.objectContaining({ level: 'limited' }),
          }),
        }),
        adapterContract: expect.objectContaining({
          connection: expect.objectContaining({
            kind: 'app-server',
            owner: 'mindos',
            command: 'codex',
          }),
          configuration: expect.objectContaining({
            modelSelection: 'runtime-native',
            credentials: 'runtime-native',
          }),
          health: expect.objectContaining({ mode: 'mindos-native', timeoutMs: 20000 }),
          commands: expect.objectContaining({ discovery: 'runtime-event' }),
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
        lifecycle: expect.objectContaining({
          stages: expect.objectContaining({
            session: expect.objectContaining({ support: 'delegated', owner: 'external' }),
            archive: expect.objectContaining({ support: 'unsupported', owner: 'external' }),
          }),
          remote: expect.objectContaining({ supported: true, mode: 'server-runnable' }),
        }),
        compatibility: expect.objectContaining({
          scenarios: expect.objectContaining({
            'session-continuity': expect.objectContaining({
              level: 'limited',
              blockers: expect.arrayContaining(['list-attach-archive']),
            }),
          }),
        }),
        adapterContract: expect.objectContaining({
          connection: expect.objectContaining({ kind: 'sdk', owner: 'mindos' }),
          configuration: expect.objectContaining({ modelSelection: 'runtime-native' }),
          health: expect.objectContaining({ mode: 'mindos-native' }),
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
          agentModes: {
            plan: 'unsupported',
            goal: 'unsupported',
          },
          supportsResume: false,
          supportsToolEvents: true,
          supportsApprovals: false,
        }),
        lifecycle: expect.objectContaining({
          stages: expect.objectContaining({
            health: expect.objectContaining({ support: 'unknown', owner: 'external' }),
            execute: expect.objectContaining({ support: 'delegated', owner: 'external' }),
          }),
          remote: expect.objectContaining({ unattended: 'limited' }),
        }),
        compatibility: expect.objectContaining({
          scenarios: expect.objectContaining({
            'coding-workflow': expect.objectContaining({
              level: 'limited',
              blockers: expect.arrayContaining(['adapter-tool-declaration']),
            }),
            'permission-governance': expect.objectContaining({ level: 'unknown' }),
          }),
        }),
        adapterContract: expect.objectContaining({
          connection: expect.objectContaining({ kind: 'stdio', owner: 'mindos' }),
          configuration: expect.objectContaining({ modelSelection: 'adapter-declared' }),
          health: expect.objectContaining({ mode: 'unknown' }),
          commands: expect.objectContaining({ discovery: 'unknown' }),
        }),
      }),
    ]));
    const claudeRuntime = body.runtimes.find((runtime: any) => runtime.id === 'claude');
    expect(claudeRuntime?.availability?.diagnosticHints ?? []).not.toContain(
      'Install Claude Code locally or add claude to the PATH used to start MindOS.',
    );
    expect(body.installed).toHaveLength(2);
    expect(body.notInstalled).toHaveLength(1);
    expect(body.catalog).toMatchObject({
      schemaVersion: 1,
      summary: expect.objectContaining({
        total: body.runtimes.length,
        available: expect.any(Number),
        categories: expect.objectContaining({ mindos: 1, native: 2 }),
      }),
      entries: expect.arrayContaining([
        expect.objectContaining({
          id: 'codex',
          kind: 'codex',
          category: 'native',
          owners: expect.objectContaining({
            model: 'external',
            session: 'external',
          }),
          diagnostics: expect.objectContaining({
            schemaVersion: 1,
            status: 'available',
            checks: expect.arrayContaining([
              expect.objectContaining({ id: 'availability', status: 'passed' }),
              expect.objectContaining({ id: 'session-ownership', status: 'passed' }),
            ]),
          }),
        }),
      ]),
    });
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
    expect(body).toMatchObject({
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
      catalog: expect.objectContaining({
        schemaVersion: 1,
        summary: expect.objectContaining({
          total: 1,
          available: 1,
          categories: expect.objectContaining({ native: 1 }),
        }),
        entries: [
          expect.objectContaining({
            id: 'claude',
            runtimeId: 'claude',
            category: 'native',
            diagnostics: expect.objectContaining({
              schemaVersion: 1,
              status: 'available',
              selectedCommand: { cmd: 'claude', args: [], source: 'descriptor' },
              checks: expect.arrayContaining([
                expect.objectContaining({ id: 'command-resolution', status: 'passed' }),
                expect.objectContaining({ id: 'mcp-capability', status: 'passed' }),
              ]),
            }),
          }),
        ],
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
      adapterContract: expect.objectContaining({
        connection: expect.objectContaining({ kind: 'cli' }),
      }),
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason: 'SDK missing',
      },
    });
  });

  it('keeps the adapter contract aligned when Claude CLI fallback is inferred from diagnostics', async () => {
    mockResolveCommandPath.mockImplementation(async (command: string) => {
      if (command === 'claude') return '/usr/local/bin/claude';
      return null;
    });
    mockCheckNativeRuntimeHealth.mockResolvedValue({
      status: 'available',
      diagnosticHints: ['Claude Code CLI is available; Claude Agent SDK bridge is unavailable, so MindOS will use CLI fallback. SDK missing'],
    });
    mockDetectLocalAcpAgents.mockResolvedValue({ installed: [], notInstalled: [] });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes?runtime=claude'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtime).toMatchObject({
      id: 'claude',
      adapter: 'claude-cli',
      adapterContract: expect.objectContaining({
        connection: expect.objectContaining({
          kind: 'cli',
          summary: 'MindOS uses the Claude Code CLI fallback when the SDK bridge is unavailable.',
        }),
      }),
      runtimeBridge: expect.objectContaining({
        kind: 'claude-cli',
        fallback: true,
      }),
    });
  });

  it('surfaces non-sensitive custom ACP adapter contract metadata', async () => {
    mockResolveCommandPath.mockResolvedValue(null);
    mockCheckNativeRuntimeHealth.mockResolvedValue({ status: 'available' });
    mockDetectLocalAcpAgents.mockResolvedValue({
      installed: [
        {
          id: 'custom-acp',
          name: 'Custom ACP',
          binaryPath: '/usr/local/bin/custom-acp',
          resolvedCommand: { cmd: 'custom-acp', args: ['--acp'], source: 'user-override' },
          adapterMetadata: {
            connectionType: 'cli',
            authRequired: true,
            supportsStreaming: true,
            models: [{ id: 'custom-fast', label: 'Custom Fast' }],
            promptCapabilities: { image: true },
            mcpCapabilities: { stdio: true },
            sessionCapabilities: { loadSession: true, list: true, resume: true },
            output: {
              kinds: ['text', 'diff', 'artifact', 'secret-output'],
              fileChanges: true,
              artifacts: true,
              env: { TOKEN: 'secret' },
            },
            healthCheck: {
              command: 'custom-acp doctor',
              timeoutMs: 4000,
              summary: 'Runs custom ACP self-checks.',
              env: { TOKEN: 'secret' },
            },
            commands: [
              { name: 'review', description: 'Review the active workspace.', env: { TOKEN: 'secret' } },
            ],
            env: { TOKEN: 'secret' },
          },
          status: 'available',
        },
      ],
      notInstalled: [],
    });

    const { GET } = await import('../../app/api/agent-runtimes/route');
    const res = await GET(new Request('http://localhost/api/agent-runtimes?scope=acp'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runtimes).toEqual([
      expect.objectContaining({
        id: 'custom-acp',
        adapterContract: expect.objectContaining({
          connection: expect.objectContaining({
            kind: 'stdio',
            command: 'custom-acp',
            commandSource: 'user-override',
          }),
          configuration: expect.objectContaining({
            credentials: 'adapter-declared',
            settings: 'adapter-declared',
          }),
          health: expect.objectContaining({
            mode: 'adapter-declared',
            command: 'custom-acp doctor',
            timeoutMs: 4000,
            summary: 'Runs custom ACP self-checks.',
          }),
          commands: expect.objectContaining({
            discovery: 'adapter-declared',
            commands: [
              { name: 'review', description: 'Review the active workspace.', source: 'adapter-declared' },
            ],
          }),
          output: expect.objectContaining({
            discovery: 'adapter-declared',
            outputKinds: ['artifact', 'diff', 'text'],
            reviewableOutputKinds: ['artifact', 'diff'],
            supportsFileChanges: true,
            supportsArtifacts: true,
          }),
          protocol: expect.objectContaining({
            declaredConnectionType: 'cli',
            supportsStreaming: true,
            authRequired: true,
            modelCount: 1,
            models: [{ id: 'custom-fast', label: 'Custom Fast' }],
            promptCapabilities: { image: true },
            mcpCapabilities: { stdio: true },
            sessionCapabilities: { loadSession: true, list: true, resume: true },
          }),
        }),
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('TOKEN');
    expect(JSON.stringify(body)).not.toContain('secret');
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
