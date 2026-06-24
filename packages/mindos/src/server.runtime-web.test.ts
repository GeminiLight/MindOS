import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import {
  tmpdir
} from 'node:os';
import {
  join
} from 'node:path';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  createDefaultMindosHttpServices,
  createMindosHttpServer,
  checkCodexProviderEnvironment,
  checkClaudeRuntimeHealth,
  mergeCodexProviderAndLoginHealth,
  handleAgentSessionTurnStream,
  handleAgentTurnStream,
  handleAgentRuntimesGet,
  handleStaticArtifact,
  handleSetupCheckPort,
  handleSetupGenerateToken,
  handleMonitoringGet,
  handleWorkflowsGet,
  handleWorkflowsPost,
  handleTreeVersion
} from './server.js';

function throwingAsyncIterable<T>(error: Error): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          throw error;
        },
      };
    },
  };
}

const RUNTIME_LIFECYCLE_STAGES = [
  'detect',
  'health',
  'configure',
  'launch',
  'session',
  'context',
  'execute',
  'interrupt',
  'archive',
  'remote',
  'coordinate',
];

describe('MindOS server contract: runtime, agent turn stream, static web', () => {
  it('handles monitoring snapshots without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-monitoring-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'Space', 'note.md'), 'hello');
    writeFileSync(join(root, '.DS_Store'), 'ignored');

    expect(handleMonitoringGet({
      mindRoot: root,
      metricsSnapshot: () => ({
        processStartTime: Date.now() - 100,
        agentRequests: 2,
        toolExecutions: 3,
        totalTokens: { input: 5, output: 8 },
        avgResponseTimeMs: 42,
        errors: 1,
      }),
      memoryUsage: () => ({ heapUsed: 1, heapTotal: 2, rss: 3 }),
      nodeVersion: 'v-test',
      mcpPort: 9999,
    })).toMatchObject({
      status: 200,
      body: {
        system: { memory: { heapUsed: 1, heapTotal: 2, rss: 3 }, nodeVersion: 'v-test' },
        application: { agentRequests: 2, toolExecutions: 3, errors: 1 },
        knowledgeBase: { root, fileCount: 1, totalSizeBytes: 5 },
        mcp: { running: true, port: 9999 },
      },
    });
  });

  it('handles setup port checks and token generation without Web dependencies', async () => {
    await expect(handleSetupCheckPort(
      { port: 4567 },
      { myWebPort: 4567, myMcpPort: 8567 },
    )).resolves.toMatchObject({
      status: 200,
      body: { available: true, isSelf: true },
    });
    await expect(handleSetupCheckPort(
      { port: 4568 },
      {
        isPortInUse: async () => true,
        isSelfPort: async () => false,
        findFreePort: async () => 4570,
      },
    )).resolves.toMatchObject({
      status: 200,
      body: { available: false, isSelf: false, suggestion: 4570 },
    });
    await expect(handleSetupCheckPort({ port: 80 })).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid port' },
    });

    expect(handleSetupGenerateToken({ seed: 'abc' })).toMatchObject({
      status: 200,
      body: { token: 'ba78-16bf-8f01-cfea-4141-40de' },
    });
    expect(handleSetupGenerateToken({}, { randomBytes: () => Buffer.from('123456789012') })).toMatchObject({
      status: 200,
      body: { token: '3132-3334-3536-3738-3930-3132' },
    });
  });

  it('handles workflow listing and creation without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-workflows-'));
    mkdirSync(join(root, '.mindos', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.mindos', 'workflows', 'existing.flow.yaml'), [
      'title: Existing Flow',
      'description: Test flow',
      'steps:',
      '  - id: one',
      '  - id: two',
      '',
    ].join('\n'));

    expect(handleWorkflowsGet({ mindRoot: root })).toMatchObject({
      status: 200,
      body: {
        workflows: [
          expect.objectContaining({
            path: '.mindos/workflows/existing.flow.yaml',
            title: 'Existing Flow',
            description: 'Test flow',
            stepCount: 2,
          }),
        ],
      },
    });

    const created = handleWorkflowsPost({ name: 'New Flow' }, { mindRoot: root });
    expect(created).toMatchObject({
      status: 200,
      body: { path: '.mindos/workflows/New Flow.flow.yaml' },
    });
    expect(readFileSync(join(root, '.mindos', 'workflows', 'New Flow.flow.yaml'), 'utf-8')).toContain("title: 'New Flow'");
    expect(handleWorkflowsPost({}, { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'name is required' },
    });
    expect(handleWorkflowsPost({ name: 'New Flow' }, { mindRoot: root })).toMatchObject({
      status: 409,
      body: { error: 'Workflow already exists' },
    });
  });

  it('escapes workflow titles and sanitizes workflow filenames', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-workflows-title-'));
    mkdirSync(join(root, '.mindos', 'workflows'), { recursive: true });

    const created = handleWorkflowsPost({
      name: "Bad\nsteps:\n  - id: injected 'quote'",
    }, { mindRoot: root });

    expect(created).toMatchObject({
      status: 200,
      body: { path: ".mindos/workflows/Bad steps- - id- injected 'quote'.flow.yaml" },
    });
    const content = readFileSync(join(root, '.mindos', 'workflows', "Bad steps- - id- injected 'quote'.flow.yaml"), 'utf-8');
    expect(content).toContain("title: 'Bad steps: - id: injected ''quote'''");
    expect(content.match(/^\s*-\s+/gm)).toHaveLength(1);

    expect(handleWorkflowsPost({ name: '////' }, { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'name must contain at least one valid filename character' },
    });
  });

  it('rejects workflow creation through symlinked metadata directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-workflows-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-workflows-symlink-outside-'));
    symlinkSync(outside, join(root, '.mindos'), 'dir');

    expect(handleWorkflowsGet({ mindRoot: root })).toMatchObject({
      status: 200,
      body: { workflows: [] },
    });
    expect(handleWorkflowsPost({ name: 'External Flow' }, { mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(existsSync(join(outside, 'workflows', 'External Flow.flow.yaml'))).toBe(false);
  });

  it('handles tree version through an injectable product service', () => {
    const res = handleTreeVersion({ getTreeVersion: () => 123 });
    expect(res).toMatchObject({ status: 200, body: { v: 123 } });
    expect(res.headers?.['Cache-Control']).toBe('private, max-age=0');
  });

  it('aggregates Chat Panel runtime availability through a product handler', async () => {
    const res = await handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      checkNativeRuntimeHealth: async () => ({ status: 'available' }),
      detectLocalAcpAgents: async () => ({
        installed: [
          { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex' },
          { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' },
        ],
        notInstalled: [
          { id: 'claude-code', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' },
        ],
      }),
    });

    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: expect.arrayContaining([
          expect.objectContaining({ id: 'mindos', kind: 'mindos', status: 'available' }),
          expect.objectContaining({
            id: 'codex',
            kind: 'codex',
            status: 'available',
            sourceAgentId: 'codex-acp',
            mcpAgentKey: 'codex',
          }),
          expect.objectContaining({
            id: 'claude',
            kind: 'claude',
            status: 'available',
            sourceAgentId: 'claude',
            mcpAgentKey: 'claude-code',
          }),
          expect.objectContaining({ id: 'gemini', kind: 'acp', status: 'available' }),
        ]),
      },
    });
    expect(res.body).toMatchObject({
      installed: [
        expect.objectContaining({ id: 'codex-acp' }),
        expect.objectContaining({ id: 'gemini' }),
      ],
      notInstalled: [
        expect.objectContaining({ id: 'claude-code' }),
      ],
    });
  });

  it('passes configured custom ACP agents into scoped runtime detection', async () => {
    const acpAgents = {
      'custom-acp': {
        name: 'Custom ACP',
        command: 'custom-acp',
        args: ['--acp'],
      },
    };
    const detectLocalAcpAgents = vi.fn(async (options?: { overrides?: Record<string, unknown> }) => ({
      installed: options?.overrides?.['custom-acp']
        ? [{ id: 'custom-acp', name: 'Custom ACP', binaryPath: '/usr/local/bin/custom-acp' }]
        : [],
      notInstalled: [],
    }));

    const res = await handleAgentRuntimesGet(new URLSearchParams('scope=acp'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents }),
      detectLocalAcpAgents,
    });

    expect(detectLocalAcpAgents).toHaveBeenCalledWith({ overrides: acpAgents });
    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: [
          expect.objectContaining({
            id: 'custom-acp',
            kind: 'acp',
            binaryPath: '/usr/local/bin/custom-acp',
          }),
        ],
      },
    });
  });

	it('describes runtime registry categories and harness capabilities without changing legacy capability fields', async () => {
    const res = await handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      checkNativeRuntimeHealth: async ({ runtime }) => runtime === 'claude'
        ? {
            status: 'available',
            runtimeBridge: {
              kind: 'claude-cli',
              label: 'CLI fallback active',
              fallback: true,
            },
          }
        : { status: 'available' },
      resolveRuntimeCommand: async (command) => {
        if (command === 'codex') return '/usr/local/bin/codex';
        if (command === 'claude') return '/usr/local/bin/claude';
        return null;
      },
      detectLocalAcpAgents: async () => ({
        installed: [
          { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' },
        ],
        notInstalled: [],
      }),
    });

    expect(res.status).toBe(200);
    const runtimes = 'runtimes' in res.body ? res.body.runtimes : [];
    const byId = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
    expect(runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'mindos',
        kind: 'mindos',
        category: 'mindos',
        runtimeId: 'mindos',
        capabilities: expect.objectContaining({ supportsModelList: true }),
        harnessCapabilities: expect.objectContaining({
          session: 'local-id',
          permissions: 'mindos-only',
          tools: expect.arrayContaining(['file', 'skills']),
        }),
        lifecycle: expect.objectContaining({
          schemaVersion: 1,
          stages: expect.objectContaining({
            session: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            context: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            remote: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
          }),
          remote: expect.objectContaining({ mode: 'server-runnable', unattended: 'limited' }),
          coordination: expect.objectContaining({
            role: 'primary',
            supportsSharedContext: true,
            supportsMailbox: false,
          }),
        }),
      }),
      expect.objectContaining({
        id: 'codex',
        kind: 'codex',
        category: 'native',
        runtimeId: 'codex',
        adapter: 'codex-app-server',
        capabilities: expect.objectContaining({
          supportsFork: true,
          supportsArchive: true,
          supportsApprovals: true,
        }),
        harnessCapabilities: expect.objectContaining({
          session: 'native-thread',
          permissions: 'runtime-bridged',
          eventStream: expect.arrayContaining(['thread-turn-item', 'permissions']),
        }),
        lifecycle: expect.objectContaining({
          schemaVersion: 1,
          stages: expect.objectContaining({
            detect: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            session: expect.objectContaining({ support: 'delegated', owner: 'external' }),
            context: expect.objectContaining({ support: 'delegated', owner: 'external' }),
            archive: expect.objectContaining({ support: 'delegated', owner: 'external' }),
          }),
          remote: expect.objectContaining({ supported: true, mode: 'server-runnable' }),
          coordination: expect.objectContaining({ role: 'external-worker', supportsSharedContext: true }),
        }),
      }),
      expect.objectContaining({
        id: 'claude',
        kind: 'claude',
        category: 'native',
        runtimeId: 'claude',
        adapter: 'claude-cli',
        runtimeBridge: expect.objectContaining({ kind: 'claude-cli' }),
        harnessCapabilities: expect.objectContaining({
          session: 'local-id',
          permissions: 'runtime-bridged',
        }),
        lifecycle: expect.objectContaining({
          stages: expect.objectContaining({
            detect: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            session: expect.objectContaining({ support: 'delegated', owner: 'external' }),
            archive: expect.objectContaining({ support: 'unsupported', owner: 'external' }),
          }),
          remote: expect.objectContaining({ supported: true, unattended: 'limited' }),
        }),
      }),
      expect.objectContaining({
        id: 'gemini',
        kind: 'acp',
        category: 'acp',
        runtimeId: 'gemini',
        adapter: 'acp',
        capabilities: expect.objectContaining({
          supportsToolEvents: true,
          supportsModelList: false,
        }),
        harnessCapabilities: expect.objectContaining({
          session: 'none',
          permissions: 'none',
        }),
        lifecycle: expect.objectContaining({
          stages: expect.objectContaining({
            detect: expect.objectContaining({ support: 'owned', owner: 'mindos' }),
            health: expect.objectContaining({ support: 'unknown', owner: 'external' }),
            execute: expect.objectContaining({ support: 'delegated', owner: 'external' }),
          }),
          coordination: expect.objectContaining({
            role: 'external-worker',
            supportsMailbox: false,
            supportsTaskBoard: false,
          }),
        }),
      }),
    ]));
    for (const id of ['mindos', 'codex', 'claude', 'gemini']) {
      const runtime = byId.get(id);
      expect(Object.keys(runtime?.lifecycle.stages ?? {}).sort()).toEqual([...RUNTIME_LIFECYCLE_STAGES].sort());
    }
  });

  it('keeps native runtime detection out of ACP installed payload lists', async () => {
    const res = await handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents: async () => ({
        installed: [
          { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' },
        ],
        notInstalled: [],
      }),
      resolveRuntimeCommand: async (command) => {
        if (command === 'codex') return '/usr/local/bin/codex';
        if (command === 'claude') return '/usr/local/bin/claude';
        return null;
      },
      checkNativeRuntimeHealth: async () => ({ status: 'available' }),
    });

    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: expect.arrayContaining([
          expect.objectContaining({ id: 'codex', kind: 'codex', status: 'available' }),
          expect.objectContaining({ id: 'claude', kind: 'claude', status: 'available' }),
          expect.objectContaining({ id: 'gemini', kind: 'acp', status: 'available' }),
        ]),
        installed: [
          expect.objectContaining({ id: 'gemini' }),
        ],
        notInstalled: [],
      },
    });
  });

  it('checks native runtime health before marking installed Codex or Claude available', async () => {
    const health = vi.fn(async () => ({ status: 'signed-out' as const, reason: 'Run codex login first.' }));
    const res = await handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      checkNativeRuntimeHealth: health,
      resolveRuntimeCommand: async (command) => command === 'codex' ? '/usr/local/bin/codex' : null,
      detectLocalAcpAgents: async () => ({
        installed: [
          { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex' },
        ],
        notInstalled: [
          { id: 'claude-code', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' },
        ],
      }),
    });

    expect(health).toHaveBeenCalledWith({
      runtime: 'codex',
      agent: expect.objectContaining({ id: 'codex-acp', binaryPath: '/usr/local/bin/codex' }),
      timeoutMs: 20000,
    });
    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: expect.arrayContaining([
          expect.objectContaining({
            id: 'codex',
            status: 'signed-out',
            availability: expect.objectContaining({ reason: 'Run codex login first.' }),
          }),
        ]),
      },
    });
  });

  it('sanitizes Codex optional dependency startup failures before returning runtime availability', async () => {
    const rawCodexStack = [
      'file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102',
      'throw new Error(`^ Error: Missing optional dependency @openai/codex-darwin-x64. Reinstall Codex: npm install -g @openai/codex@latest',
      'at findCodexExecutable (file:///opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js:102:9)',
      'at ModuleJob.run (node:internal/modules/esm/module_job:274:25)',
      'at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)',
      'Node.js v22.16.0',
    ].join('\n');

    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      resolveRuntimeCommand: async (command) => command === 'codex' ? '/opt/homebrew/bin/codex' : null,
      checkNativeRuntimeHealth: async () => ({
        status: 'error',
        reason: rawCodexStack,
        diagnosticHints: [rawCodexStack],
      }),
    });

    expect(res.status).toBe(200);
    const runtime = 'runtime' in res.body ? res.body.runtime : null;
    expect(runtime).toMatchObject({
      id: 'codex',
      status: 'error',
      binaryPath: '/opt/homebrew/bin/codex',
      availability: expect.objectContaining({
        reason: 'Codex is installed but incomplete. Reinstall Codex with "npm install -g @openai/codex@latest", then restart MindOS.',
        diagnosticHints: expect.arrayContaining([
          'Run "npm install -g @openai/codex@latest" in the same environment that starts MindOS.',
          'MindOS detected Codex at /opt/homebrew/bin/codex.',
        ]),
      }),
    });
    const serialized = JSON.stringify(runtime);
    expect(serialized).not.toContain('file:///opt/homebrew');
    expect(serialized).not.toContain('throw new Error');
    expect(serialized).not.toContain('ModuleJob.run');
    expect(serialized).not.toContain('node:internal');
    expect(serialized).not.toContain('Node.js v22.16.0');
  });

  it('uses the first healthy Codex command candidate when PATH contains a broken wrapper first', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-codex-candidates-'));
    const broken = join(root, 'broken-codex');
    const healthy = join(root, 'healthy-codex');
    writeFileSync(broken, '#!/bin/sh\nexit 1\n');
    writeFileSync(healthy, '#!/bin/sh\nexit 0\n');
    const health = vi.fn(async ({ agent }: { agent: { binaryPath: string } }) => (
      agent.binaryPath === broken
        ? { status: 'error' as const, reason: 'Missing optional dependency @openai/codex-darwin-x64.' }
        : { status: 'available' as const }
    ));

    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      resolveRuntimeCommand: async () => broken,
      resolveRuntimeCommandCandidates: async () => [broken, healthy],
      checkNativeRuntimeHealth: health,
    });

    expect(health).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    const runtime = 'runtime' in res.body ? res.body.runtime : null;
    expect(runtime).toMatchObject({
      id: 'codex',
      status: 'available',
      binaryPath: healthy,
      availability: expect.objectContaining({
        diagnosticHints: expect.arrayContaining([
          expect.stringContaining(`MindOS skipped an unhealthy Codex candidate at ${broken}`),
        ]),
      }),
    });
  });

  it('does not skip a signed-out Codex command candidate to use another binary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-codex-signed-out-candidate-'));
    const signedOut = join(root, 'signed-out-codex');
    const healthy = join(root, 'healthy-codex');
    writeFileSync(signedOut, '#!/bin/sh\nexit 0\n');
    writeFileSync(healthy, '#!/bin/sh\nexit 0\n');
    const health = vi.fn(async ({ agent }: { agent: { binaryPath: string } }) => (
      agent.binaryPath === signedOut
        ? { status: 'signed-out' as const, reason: 'Run codex login first.' }
        : { status: 'available' as const }
    ));

    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      resolveRuntimeCommand: async () => signedOut,
      resolveRuntimeCommandCandidates: async () => [signedOut, healthy],
      checkNativeRuntimeHealth: health,
    });

    expect(health).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    const runtime = 'runtime' in res.body ? res.body.runtime : null;
    expect(runtime).toMatchObject({
      id: 'codex',
      status: 'signed-out',
      binaryPath: signedOut,
      availability: expect.objectContaining({
        reason: 'Run codex login first.',
      }),
    });
  });

  it('does not fallback to another Codex binary when the user explicitly configures a Codex command', async () => {
    const explicitCommand = '/custom/codex-wrapper';
    const health = vi.fn(async () => ({
      status: 'error' as const,
      reason: 'explicit wrapper failed',
    }));

    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({
        acpAgents: {
          codex: {
            command: explicitCommand,
            env: { PATH: '/custom/bin:/usr/bin' },
          },
        },
      }),
      resolveRuntimeCommand: async () => '/usr/local/bin/codex',
      resolveRuntimeCommandCandidates: async () => ['/usr/local/bin/codex', '/Applications/Codex.app/Contents/Resources/codex'],
      checkNativeRuntimeHealth: health,
    });

    expect(health).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledWith(expect.objectContaining({
      agent: expect.objectContaining({ binaryPath: explicitCommand }),
      env: expect.objectContaining({ PATH: '/custom/bin:/usr/bin' }),
    }));
    expect(res.status).toBe(200);
    const runtime = 'runtime' in res.body ? res.body.runtime : null;
    expect(runtime).toMatchObject({
      id: 'codex',
      status: 'error',
      binaryPath: explicitCommand,
      availability: expect.objectContaining({
        reason: 'explicit wrapper failed',
      }),
    });
  });

  it('uses the Codex command from the configured runtime PATH before process PATH candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-codex-env-path-'));
    const configuredBin = join(root, 'configured-bin');
    mkdirSync(configuredBin, { recursive: true });
    const configuredCodex = join(configuredBin, 'codex');
    const processPathCodex = join(root, 'process-path-codex');
    writeFileSync(configuredCodex, '#!/bin/sh\nexit 0\n');
    writeFileSync(processPathCodex, '#!/bin/sh\nexit 0\n');
    const health = vi.fn(async ({ agent }: { agent: { binaryPath: string } }) => (
      agent.binaryPath === configuredCodex
        ? { status: 'available' as const }
        : { status: 'error' as const, reason: `unexpected candidate ${agent.binaryPath}` }
    ));

    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=codex'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({
        acpAgents: {
          codex: {
            env: { PATH: configuredBin },
          },
        },
      }),
      resolveRuntimeCommand: async () => processPathCodex,
      resolveRuntimeCommandCandidates: async () => [processPathCodex],
      checkNativeRuntimeHealth: health,
    });

    expect(health).toHaveBeenCalledTimes(1);
    expect(health).toHaveBeenCalledWith(expect.objectContaining({
      agent: expect.objectContaining({ binaryPath: configuredCodex }),
      env: expect.objectContaining({ PATH: configuredBin }),
    }));
    expect(res.status).toBe(200);
    const runtime = 'runtime' in res.body ? res.body.runtime : null;
    expect(runtime).toMatchObject({
      id: 'codex',
      status: 'available',
      binaryPath: configuredCodex,
    });
  });

  it('marks Codex signed out when its configured provider requires a missing environment key', () => {
    const result = checkCodexProviderEnvironment({
      env: {},
      configText: [
        'model_provider = "subhub-prod-responses"',
        '',
        '[model_providers.subhub-prod-responses]',
        'name = "OpenAI Prod Subhub Pool"',
        'env_key = "STAFF_KEY"',
        'wire_api = "responses"',
      ].join('\n'),
      readShellEnvValue: () => undefined,
    });

    expect(result).toEqual({
      status: 'signed-out',
      reason: 'Codex model provider "subhub-prod-responses" requires STAFF_KEY, but MindOS cannot see that environment variable in the app process, OS user environment, or login shell. Export STAFF_KEY in your shell profile or OS user environment before starting MindOS, or switch Codex to a provider that does not require it.',
    });
  });

  it('keeps Codex available when the configured provider key is resolved from the runtime environment fallback', () => {
    const readShellEnvValue = vi.fn((key: string) => key === 'STAFF_KEY' ? 'shell-secret' : undefined);
    const result = checkCodexProviderEnvironment({
      env: {},
      configText: [
        'model_provider = "subhub-prod-responses"',
        '',
        '[model_providers.subhub-prod-responses]',
        'env_key = "STAFF_KEY"',
      ].join('\n'),
      readShellEnvValue,
    });

    expect(readShellEnvValue).toHaveBeenCalledWith('STAFF_KEY', {});
    expect(result).toEqual({
      status: 'available',
      diagnosticHints: [
        'Codex provider environment key STAFF_KEY was found through MindOS runtime environment fallback and will be injected only into Codex app-server.',
      ],
    });
  });

  it('keeps Codex available when the configured provider environment key is visible', () => {
    const result = checkCodexProviderEnvironment({
      env: { STAFF_KEY: 'present' },
      configText: [
        'model_provider = "subhub-prod-responses"',
        '',
        '[model_providers.subhub-prod-responses]',
        'env_key = "STAFF_KEY"',
      ].join('\n'),
    });

    expect(result).toEqual({ status: 'available' });
  });

  it('keeps Codex available when app-server works but account login status fails', () => {
    const result = mergeCodexProviderAndLoginHealth(
      { status: 'available' },
      { status: 'signed-out', reason: 'Run codex login first.' },
    );

    expect(result).toEqual({
      status: 'available',
      diagnosticHints: [
        'Codex app-server is available. If this Codex profile uses account login, run "codex login status" from the same environment that starts MindOS.',
        'codex login status returned: Run codex login first.',
      ],
    });
  });

  it('marks Claude unavailable when only the old SDK sentinel is provided', async () => {
    const result = await checkClaudeRuntimeHealth({
      binaryPath: 'sdk:@anthropic-ai/claude-agent-sdk',
      importSdk: async () => {
        throw new Error('should not import SDK without a local CLI path');
      },
      checkCliVersion: async () => {
        throw new Error('should not check CLI without a local CLI path');
      },
    });

    expect(result).toMatchObject({
      status: 'error',
      reason: expect.stringContaining('requires a local claude executable'),
      diagnosticHints: [
        'Install Claude Code locally and restart MindOS so the server process can resolve the claude command.',
      ],
    });
  });

  it('keeps Claude available through a real CLI path when the SDK bridge is available', async () => {
    const result = await checkClaudeRuntimeHealth({
      binaryPath: '/Users/tester/.local/bin/claude',
      importSdk: async () => ({ query: () => ({}) }),
      checkCliVersion: async () => ({ status: 'available' }),
    });

    expect(result).toMatchObject({
      status: 'available',
      runtimeBridge: {
        kind: 'claude-sdk',
        label: 'SDK bridge active',
      },
      diagnosticHints: [
        'Claude Agent SDK bridge is available and will use the local Claude Code CLI at /Users/tester/.local/bin/claude.',
      ],
    });
  });

  it('keeps Claude available through CLI fallback when the SDK bridge is unavailable', async () => {
    const result = await checkClaudeRuntimeHealth({
      binaryPath: '/Users/tester/.local/bin/claude',
      importSdk: async () => {
        throw new Error('SDK missing');
      },
      checkCliVersion: async () => {
        return { status: 'available' };
      },
    });

    expect(result).toMatchObject({
      status: 'available',
      runtimeBridge: {
        kind: 'claude-cli',
        label: 'CLI fallback active',
        fallback: true,
        reason: 'SDK missing',
      },
      diagnosticHints: expect.arrayContaining([
        expect.stringContaining('Claude Code CLI is available at /Users/tester/.local/bin/claude'),
        expect.stringContaining('SDK missing'),
      ]),
    });
  });

  it('keeps local native runtime detection independent when ACP detection times out', async () => {
    vi.useFakeTimers();
    const pendingDetection = new Promise<{ installed: unknown[]; notInstalled: unknown[] }>(() => {});
    const result = handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents: async () => pendingDetection,
      resolveRuntimeCommand: async () => null,
      checkNativeRuntimeHealth: async ({ runtime }) => (
        runtime === 'claude'
          ? { status: 'available' }
          : { status: 'error', reason: 'not checked' }
      ),
    });

    await vi.advanceTimersByTimeAsync(5000);
    const res = await result;
    vi.useRealTimers();

    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: expect.arrayContaining([
          expect.objectContaining({ id: 'mindos', kind: 'mindos', status: 'available' }),
          expect.objectContaining({
            id: 'codex',
            kind: 'codex',
            status: 'missing',
            availability: expect.objectContaining({
              reason: 'Codex executable was not detected.',
              sources: ['native-health'],
            }),
          }),
          expect.objectContaining({
            id: 'claude',
            kind: 'claude',
            adapter: 'claude-sdk',
            status: 'missing',
            availability: expect.objectContaining({
              reason: expect.stringContaining('Claude Code executable was not detected'),
              sources: ['native-health'],
            }),
          }),
        ]),
      },
    });
  });

  it('keeps native Claude available while ACP detection times out', async () => {
    vi.useFakeTimers();
    const pendingDetection = new Promise<{ installed: unknown[]; notInstalled: unknown[] }>(() => {});
    const result = handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents: async () => pendingDetection,
      resolveRuntimeCommand: async (command) => command === 'claude' ? '/usr/local/bin/claude' : null,
      checkNativeRuntimeHealth: async ({ runtime }) => (
        runtime === 'claude'
          ? { status: 'available' }
          : { status: 'error', reason: 'not checked' }
      ),
    });

    await vi.advanceTimersByTimeAsync(5000);
    const res = await result;
    vi.useRealTimers();

    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: expect.arrayContaining([
          expect.objectContaining({
            id: 'claude',
            kind: 'claude',
            status: 'available',
            binaryPath: '/usr/local/bin/claude',
            availability: expect.objectContaining({ sources: ['native-health'] }),
          }),
        ]),
      },
    });
  });

  it('detects one native runtime without waiting for ACP or sibling native runtime checks', async () => {
    const detectLocalAcpAgents = vi.fn(async () => ({
      installed: [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' }],
      notInstalled: [],
    }));
    const checkNativeRuntimeHealth = vi.fn(async () => ({ status: 'available' as const }));
    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents,
      resolveRuntimeCommand: async (command) => command === 'claude' ? '/usr/local/bin/claude' : null,
      checkNativeRuntimeHealth,
    });

    expect(detectLocalAcpAgents).not.toHaveBeenCalled();
    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);
    expect(checkNativeRuntimeHealth).toHaveBeenCalledWith({
      runtime: 'claude',
      agent: expect.objectContaining({ id: 'claude', binaryPath: '/usr/local/bin/claude' }),
      timeoutMs: 20000,
    });
    expect(res).toMatchObject({
      status: 200,
      body: {
        runtime: expect.objectContaining({
          id: 'claude',
          kind: 'claude',
          status: 'available',
          availability: expect.objectContaining({ sources: ['native-health'] }),
        }),
      },
    });
  });

  it('marks Claude missing when CLI path lookup times out instead of using a bundled SDK runtime', async () => {
    vi.useFakeTimers();
    const detectLocalAcpAgents = vi.fn(async () => ({
      installed: [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini' }],
      notInstalled: [],
    }));
    const resolveRuntimeCommand = vi.fn(async () => new Promise<string | null>(() => {}));
    const checkNativeRuntimeHealth = vi.fn(async () => ({ status: 'available' as const }));

    const result = handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents,
      resolveRuntimeCommand,
      checkNativeRuntimeHealth,
    });

    await vi.advanceTimersByTimeAsync(5000);
    const res = await result;
    vi.useRealTimers();

    expect(detectLocalAcpAgents).not.toHaveBeenCalled();
    expect(resolveRuntimeCommand).toHaveBeenCalledWith('claude');
    expect(checkNativeRuntimeHealth).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      status: 200,
      body: {
        runtime: expect.objectContaining({
          id: 'claude',
          kind: 'claude',
          status: 'missing',
          availability: expect.objectContaining({
            reason: expect.stringContaining('executable detection timed out'),
            sources: ['native-health'],
          }),
        }),
      },
    });
  });

  it('uses a detected Claude CLI path without probing SDK-only health', async () => {
    const checkNativeRuntimeHealth = vi.fn(async () => ({ status: 'available' as const }));

    const res = await handleAgentRuntimesGet(new URLSearchParams('runtime=claude'), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents: async () => ({ installed: [], notInstalled: [] }),
      resolveRuntimeCommand: async (command) => (
        command === 'claude'
          ? await new Promise<string>((resolve) => setTimeout(() => resolve('/Users/tester/.local/bin/claude'), 50))
          : null
      ),
      checkNativeRuntimeHealth,
    });

    expect(checkNativeRuntimeHealth).toHaveBeenCalledTimes(1);
    expect(checkNativeRuntimeHealth).toHaveBeenCalledWith(expect.objectContaining({
      runtime: 'claude',
      agent: expect.objectContaining({ binaryPath: '/Users/tester/.local/bin/claude' }),
    }));
    expect(res).toMatchObject({
      status: 200,
      body: {
        runtime: expect.objectContaining({
          id: 'claude',
          status: 'available',
          binaryPath: '/Users/tester/.local/bin/claude',
        }),
      },
    });
  });

  it('preserves unavailable runtime status and reason from runtime detection', async () => {
    const res = await handleAgentRuntimesGet(new URLSearchParams(), {
      now: () => Date.parse('2026-06-09T00:00:00.000Z'),
      readSettings: () => ({ acpAgents: {} }),
      detectLocalAcpAgents: async () => ({
        installed: [
          { id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'signed-out', reason: 'Run codex login first.' },
          { id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'error', reason: 'Config file is invalid.' },
        ],
        notInstalled: [
          { id: 'claude-code', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' },
        ],
      }),
      resolveRuntimeCommand: async (command) => command === 'codex' ? '/usr/local/bin/codex' : null,
      checkNativeRuntimeHealth: async ({ runtime }) => (
        runtime === 'codex'
          ? { status: 'signed-out', reason: 'Run codex login first.' }
          : { status: 'error', reason: 'not checked' }
      ),
    });

    expect(res).toMatchObject({
      status: 200,
      body: {
        runtimes: expect.arrayContaining([
          expect.objectContaining({
            id: 'codex',
            kind: 'codex',
            status: 'signed-out',
            availability: expect.objectContaining({
              reason: 'Run codex login first.',
              sources: ['native-health'],
            }),
          }),
          expect.objectContaining({
            id: 'gemini',
            kind: 'acp',
            status: 'error',
            availability: expect.objectContaining({
              reason: 'Config file is invalid.',
              sources: ['acp-detect', 'native-health'],
            }),
          }),
        ]),
      },
    });
  });

  it('validates agent turn stream requests and returns a product-owned SSE stream', async () => {
    const invalid = handleAgentTurnStream({}, {
      agentTurnStream: () => throwingAsyncIterable(new Error('should not stream invalid agent turn requests')),
    });
    expect(invalid).toMatchObject({
      ok: false,
      status: 400,
      body: { error: 'messages must be an array' },
    });

    const removedMode = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'hello' }],
      mode: 'organize',
    }, {
      agentTurnStream: () => throwingAsyncIterable(new Error('should not stream removed mode fields')),
    });
    expect(removedMode).toMatchObject({
      ok: false,
      status: 400,
      body: { error: 'Unknown field: mode' },
    });

    const valid = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'hello' }],
      attachedFiles: ['note.md', 123],
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_123',
        status: 'active',
        updatedAt: 123,
      },
      workDir: { source: 'manual', path: '/repo/app', label: 'app', updatedAt: 456 },
      contextSelection: {
        version: 1,
        spaces: [{ path: 'Research', label: 'Research' }],
        assistants: [{ id: 'ui-reviewer', name: 'UI Reviewer', kind: 'assistant' }],
        updatedAt: 789,
      },
      permissionMode: 'read',
      runtimeOptions: { reasoningEffort: 'high', modelOverride: 'gpt-test' },
      chatSessionId: 'chat-context-1',
      selectedAcpAgent: { id: 'claude', name: 'Claude Code' },
    }, {
      agentTurnStream: async function* (input) {
        yield { type: 'status', message: `runtime=${input.selectedRuntime?.kind}:${input.selectedRuntime?.id}` };
        yield { type: 'status', message: `binding=${input.runtimeBinding?.kind}:${input.runtimeBinding?.externalSessionId}` };
        yield { type: 'status', message: `context=${input.chatSessionId};cwd=${input.workDir?.path};spaces=${input.contextSelection?.spaces[0]?.path};permission=${input.permissionMode}` };
        yield { type: 'text_delta', delta: String(input.messages[0]?.content ?? '') };
        yield { type: 'done' };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'runtime=codex:codex' },
      { type: 'status', message: 'binding=codex-thread:thr_123' },
      { type: 'status', message: 'context=chat-context-1;cwd=/repo/app;spaces=Research;permission=read' },
      { type: 'text_delta', delta: 'hello' },
      { type: 'done' },
    ]);
  });

  it('normalizes agent session turn requests into agent turn stream input', async () => {
    const valid = handleAgentSessionTurnStream('session-from-path', {
      chatSessionId: 'body-should-not-win',
      message: { text: 'hello from turn', skillName: 'research' },
      selectedRuntime: { id: 'codex', name: 'Codex', kind: 'codex' },
      context: {
        workDir: { source: 'manual', path: '/repo/app', label: 'app' },
        contextSelection: {
          spaces: [{ path: 'Research', label: 'Research' }],
          assistants: [],
        },
        attachedFiles: ['note.md', 123],
      },
      permissionMode: 'read',
      runtimeOptions: {
        reasoningEffort: 'high',
        modelOverride: 'gpt-test',
      },
    }, {
      agentTurnStream: async function* (input) {
        yield { type: 'status', message: `context=${input.chatSessionId};message=${input.messages[0]?.content};skill=${input.messages[0]?.skillName}` };
        yield { type: 'status', message: `runtime=${input.selectedRuntime?.kind}:${input.selectedRuntime?.id};cwd=${input.workDir?.path};space=${input.contextSelection?.spaces[0]?.path}` };
        yield { type: 'status', message: `permission=${input.permissionMode};effort=${input.runtimeOptions?.reasoningEffort};model=${input.runtimeOptions?.modelOverride}` };
        yield { type: 'done' };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent session turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'context=session-from-path;message=hello from turn;skill=research' },
      { type: 'status', message: 'runtime=codex:codex;cwd=/repo/app;space=Research' },
      { type: 'status', message: 'permission=read;effort=high;model=gpt-test' },
      { type: 'done' },
    ]);
  });

  it('preserves context Space paths for the trusted Web resolver instead of rewriting them', async () => {
    const valid = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'hello' }],
      contextSelection: {
        version: 1,
        spaces: [
          { path: '/Research', label: 'absolute-posix' },
          { path: 'C:\\Users\\moonshot\\Research', label: 'absolute-windows' },
          { path: 'Research/', label: 'trailing-slash' },
        ],
        assistants: [],
      },
    }, {
      agentTurnStream: async function* (input) {
        yield {
          type: 'status',
          message: input.contextSelection?.spaces.map((space) => space.path).join('|') ?? '',
        };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: '/Research|C:/Users/moonshot/Research|Research/' },
    ]);
  });

  it('normalizes legacy selected ACP agent into an ACP runtime selection', async () => {
    const valid = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'hello' }],
      selectedAcpAgent: { id: 'claude', name: 'Claude Code' },
    }, {
      agentTurnStream: async function* (input) {
        yield { type: 'status', message: `${input.selectedRuntime?.kind}:${input.selectedRuntime?.id}` };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'acp:claude' },
    ]);
  });

  it('uses runtimeBinding as the only native runtime external session source', async () => {
    const valid = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'continue' }],
      selectedRuntime: {
        id: 'codex',
        name: 'Codex',
        kind: 'codex',
      },
      runtimeBinding: {
        kind: 'codex-thread',
        runtime: 'codex',
        runtimeId: 'codex',
        externalSessionId: 'thr_123',
        updatedAt: 1,
      },
    }, {
      agentTurnStream: async function* (input) {
        yield {
          type: 'status',
          message: `${input.selectedRuntime?.kind}:${input.runtimeBinding?.externalSessionId ?? 'missing'}`,
        };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'codex:thr_123' },
    ]);
  });

  it('falls back to legacy selected ACP agent when selectedRuntime is malformed', async () => {
    const valid = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'hello' }],
      selectedRuntime: { id: 'broken-runtime' },
      selectedAcpAgent: { id: 'claude', name: 'Claude Code' },
    }, {
      agentTurnStream: async function* (input) {
        yield { type: 'status', message: `${input.selectedRuntime?.kind}:${input.selectedRuntime?.id}` };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'acp:claude' },
    ]);
  });

  it('honors an explicit null runtime selection over legacy ACP selection', async () => {
    const valid = handleAgentTurnStream({
      messages: [{ role: 'user', content: 'hello' }],
      selectedRuntime: null,
      selectedAcpAgent: { id: 'claude', name: 'Claude Code' },
    }, {
      agentTurnStream: async function* (input) {
        yield {
          type: 'status',
          message: input.selectedRuntime === null ? 'runtime:none' : 'runtime:unexpected',
        };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected agent turn stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'runtime:none' },
    ]);
  });

  it('serves ask SSE through the product HTTP server with injected runtime', async () => {
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      services: {
        ...createDefaultMindosHttpServices({
          readSettings: () => ({ mindRoot: mkdtempSync(join(tmpdir(), 'mindos-http-ask-')) }),
        }),
        agentTurnStream: async function* (input) {
          const request = input as { messages?: Array<{ content?: string }> };
          yield { type: 'status', message: 'started' };
          yield { type: 'text_delta', delta: request.messages?.[0]?.content ?? '' };
          yield { type: 'done' };
        },
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/agent/sessions/test-session/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(await response.text()).toContain('data:{"type":"text_delta","delta":"hello"}');

      const turnResponse = await fetch(`${base}/api/agent/sessions/chat-route-1/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: { text: 'turn hello' } }),
      });
      expect(turnResponse.status).toBe(200);
      expect(turnResponse.headers.get('content-type')).toContain('text/event-stream');
      expect(await turnResponse.text()).toContain('data:{"type":"text_delta","delta":"turn hello"}');
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves static Web artifacts without a Next server', async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'mindos-static-web-'));
    mkdirSync(join(staticRoot, '_next', 'static'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main>MindOS</main>');
    writeFileSync(join(staticRoot, '_next', 'static', 'app.js'), 'console.log("mindos")');

    const index = handleStaticArtifact({ staticRoot, path: '/' });
    expect(index?.status).toBe(200);
    expect(index?.headers?.['Content-Type']).toBe('text/html; charset=utf-8');
    expect(index?.body?.toString()).toContain('MindOS');

    const asset = handleStaticArtifact({ staticRoot, path: '/_next/static/app.js' });
    expect(asset?.status).toBe(200);
    expect(asset?.headers?.['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(asset?.headers?.['Cache-Control']).toContain('immutable');

    expect(handleStaticArtifact({ staticRoot, path: '/../secret.js' })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('rejects static Web artifacts through symlinks outside the static root', () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'mindos-static-web-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-static-web-outside-'));
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main>MindOS</main>');
    writeFileSync(join(outside, 'secret.js'), 'window.secret=1');
    symlinkSync(outside, join(staticRoot, 'assets', 'linked'), 'dir');

    expect(handleStaticArtifact({ staticRoot, path: '/assets/linked/secret.js' })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('serves static Web artifact fallback through the product HTTP server', async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'mindos-http-static-'));
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main>MindOS shell</main>');
    writeFileSync(join(staticRoot, 'assets', 'app.12345678.js'), 'window.__mindos=1');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      staticRoot,
      services: createDefaultMindosHttpServices({
        staticRoot,
        readSettings: () => ({ mindRoot: mkdtempSync(join(tmpdir(), 'mindos-http-static-root-')) }),
      }),
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const shell = await fetch(`${base}/wiki`);
      expect(shell.status).toBe(200);
      expect(await shell.text()).toContain('MindOS shell');

      const asset = await fetch(`${base}/assets/app.12345678.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('cache-control')).toContain('immutable');
      expect(await asset.text()).toContain('__mindos');
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not serve static Web artifacts without a session adapter when the Web UI is password-protected', async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'mindos-http-static-auth-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-static-auth-root-'));
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main>MindOS shell</main>');
    writeFileSync(join(staticRoot, 'assets', 'app.12345678.js'), 'window.__mindos=1');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      staticRoot,
      services: createDefaultMindosHttpServices({
        staticRoot,
        readSettings: () => ({ mindRoot: root, webPassword: 'web-secret' }),
      }),
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const shell = await fetch(`${base}/wiki`);
      expect(shell.status).toBe(401);
      expect(await shell.json()).toEqual({
        error: 'Password-protected Web UI requires the Next.js host auth adapter.',
      });

      expect((await fetch(`${base}/assets/app.12345678.js`)).status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
