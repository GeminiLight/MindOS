import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mocks = vi.hoisted(() => ({
  settings: { mindRoot: '', projectRoot: '' },
  detectLocalAcpAgents: vi.fn(),
  resolveCommandPath: vi.fn(),
  resolveCommandPathCandidates: vi.fn(),
  checkNativeRuntimeHealth: vi.fn(),
}));

vi.mock('@geminilight/mindos/server', async () => {
  const actual = await import('../../../mindos/src/server');
  return { ...actual };
});

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({
    ai: { activeProvider: '', providers: [] },
    mindRoot: mocks.settings.mindRoot,
    acpAgents: {},
  }),
}));

vi.mock('@/lib/project-root', () => ({
  getProjectRoot: () => mocks.settings.projectRoot,
}));

vi.mock('@/lib/fs', () => ({
  getMindRoot: () => mocks.settings.mindRoot,
}));

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mocks.detectLocalAcpAgents,
  resolveCommandPath: mocks.resolveCommandPath,
  resolveCommandPathCandidates: mocks.resolveCommandPathCandidates,
  checkNativeRuntimeHealth: mocks.checkNativeRuntimeHealth,
}));

vi.mock('@/lib/custom-agents', () => ({
  getAllAgents: () => ({
    mindos: mcpAgentDef('MindOS', '~/.mindos/mcp.json'),
    codex: mcpAgentDef('Codex', '~/.codex/config.toml', { format: 'toml', presenceCli: 'codex' }),
    'claude-code': mcpAgentDef('Claude Code', '~/.claude.json', { presenceCli: 'claude' }),
  }),
  loadCustomAgents: () => [],
  scanCustomAgentSkills: () => ({ skills: [], sourcePath: '' }),
}));

vi.mock('@/lib/mcp-agents', () => ({
  MCP_AGENTS: {
    mindos: mcpAgentDef('MindOS', '~/.mindos/mcp.json'),
    codex: mcpAgentDef('Codex', '~/.codex/config.toml', { format: 'toml', presenceCli: 'codex' }),
    'claude-code': mcpAgentDef('Claude Code', '~/.claude.json', { presenceCli: 'claude' }),
  },
  detectInstalled: (key: string) => ({ installed: true, scope: 'global', configPath: `/tmp/${key}.json` }),
  detectAgentPresence: () => true,
  detectAgentRuntimeSignals: (key: string) => ({
    hiddenRootPath: `/tmp/${key}`,
    hiddenRootPresent: true,
    conversationSignal: false,
    usageSignal: false,
  }),
  detectAgentConfiguredMcpServers: (key: string) => (
    key === 'codex'
      ? { servers: ['github'], sources: ['local:/tmp/codex.toml'] }
      : { servers: [], sources: [] }
  ),
  detectAgentInstalledSkills: () => ({ skills: [], sourcePath: '' }),
  resolveSkillWorkspaceProfile: (key: string) => ({
    mode: 'unsupported',
    workspacePath: `/tmp/${key}/skills`,
  }),
}));

function mcpAgentDef(
  name: string,
  global: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    name,
    project: null,
    global,
    key: 'mcpServers',
    preferredTransport: 'stdio',
    presenceDirs: [],
    ...overrides,
  };
}

let tempHome: string;
let mindRoot: string;
let projectRoot: string;
let origHome: string | undefined;
let origProjectRoot: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-runtime-readiness-'));
  mindRoot = path.join(tempHome, 'mind');
  projectRoot = path.join(tempHome, 'project');
  fs.mkdirSync(path.join(tempHome, '.mindos'), { recursive: true });
  fs.mkdirSync(mindRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(tempHome, '.mindos', 'mcp.json'), JSON.stringify({
    mcpServers: {
      github: {
        command: 'secret-wrapper',
        env: { GITHUB_TOKEN: 'must-not-leak' },
        mindosAgent: true,
      },
    },
  }), 'utf-8');

  origHome = process.env.HOME;
  origProjectRoot = process.env.MINDOS_PROJECT_ROOT;
  process.env.HOME = tempHome;
  process.env.MINDOS_PROJECT_ROOT = projectRoot;

  mocks.settings.mindRoot = mindRoot;
  mocks.settings.projectRoot = projectRoot;
  mocks.resolveCommandPath.mockReset().mockImplementation(async (command: string) => {
    if (command === 'codex') return '/usr/local/bin/codex';
    if (command === 'claude') return '/usr/local/bin/claude';
    return null;
  });
  mocks.resolveCommandPathCandidates.mockReset().mockResolvedValue([]);
  mocks.checkNativeRuntimeHealth.mockReset().mockResolvedValue({ status: 'available' });
  mocks.detectLocalAcpAgents.mockReset().mockResolvedValue({
    installed: [{ id: 'codex-acp', name: 'Codex', binaryPath: '/usr/local/bin/codex', status: 'available' }],
    notInstalled: [{ id: 'claude', name: 'Claude Code', installCmd: 'npm install -g @anthropic-ai/claude-code' }],
  });
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origProjectRoot === undefined) delete process.env.MINDOS_PROJECT_ROOT;
  else process.env.MINDOS_PROJECT_ROOT = origProjectRoot;
});

async function importRoute() {
  vi.resetModules();
  return await import('../../app/api/agent-runtimes/readiness/route');
}

describe('GET /api/agent-runtimes/readiness', () => {
  it('returns aggregated runtime readiness from runtime descriptors and projections', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/readiness'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    const mindos = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'mindos');
    const codex = body.projections.find((projection: { runtimeId: string }) => projection.runtimeId === 'codex');

    expect(mindos).toMatchObject({
      overallStatus: 'usable',
      recommendations: expect.arrayContaining([
        expect.objectContaining({ useCase: 'interactive-turn', confidence: 'strong' }),
        expect.objectContaining({ useCase: 'mcp-tooling', confidence: 'strong' }),
      ]),
      gaps: expect.arrayContaining([
        expect.objectContaining({ id: 'scheduler', category: 'mindos-product' }),
        expect.objectContaining({ id: 'artifact-index', category: 'mindos-product' }),
      ]),
    });
    expect(codex).toMatchObject({
      overallStatus: 'usable',
      recommendations: expect.arrayContaining([
        expect.objectContaining({ useCase: 'coding-workflow', confidence: 'strong' }),
      ]),
    });
    expect(codex.useCases.find((entry: { id: string }) => entry.id === 'permission-governance')).toMatchObject({
      source: 'permission-projection',
      sourceStatus: 'interactive-only',
      status: 'usable',
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    expect(JSON.stringify(body)).not.toContain('secret-wrapper');
  });

  it('honors runtime and permission mode filters', async () => {
    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/agent-runtimes/readiness?runtime=codex&permissionMode=read'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.requestedPermissionMode).toBe('read');
    expect(body.projections).toEqual([
      expect.objectContaining({
        runtimeId: 'codex',
        overallStatus: 'usable',
      }),
    ]);
  });
});
