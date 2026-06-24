import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mocks = vi.hoisted(() => ({
  settings: { mindRoot: '' },
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
    disabledSkills: undefined,
    acpAgents: {},
  }),
}));

vi.mock('@/lib/acp/detect-local', () => ({
  detectLocalAcpAgents: mocks.detectLocalAcpAgents,
  resolveCommandPath: mocks.resolveCommandPath,
  resolveCommandPathCandidates: mocks.resolveCommandPathCandidates,
  checkNativeRuntimeHealth: mocks.checkNativeRuntimeHealth,
}));

let tempHome: string;
let mindRoot: string;
let projectRoot: string;
let origHome: string | undefined;
let origProjectRoot: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-runtime-matches-test-'));
  mindRoot = path.join(tempHome, 'mind');
  projectRoot = path.join(tempHome, 'project');
  fs.mkdirSync(mindRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  origHome = process.env.HOME;
  origProjectRoot = process.env.MINDOS_PROJECT_ROOT;
  process.env.HOME = tempHome;
  process.env.MINDOS_PROJECT_ROOT = projectRoot;

  mocks.settings.mindRoot = mindRoot;
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

function seedSkill(root: string, name: string): void {
  const skillDir = path.join(root, '.skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'description: Shipping workflow',
    'runtimeKinds: codex',
    'requiredTools: git',
    'requiredCapabilities: pr-output',
    'requiresApprovals: false',
    'requiresUserInput: false',
    '---',
    '',
    'Ship code.',
  ].join('\n'), 'utf-8');
}

async function importRoute() {
  vi.resetModules();
  return await import('../../app/api/skills/runtime-matches/route');
}

describe('GET /api/skills/runtime-matches', () => {
  it('returns skill runtime matches using the same runtime descriptors as /api/agent-runtimes', async () => {
    seedSkill(mindRoot, 'ship-it');

    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/skills/runtime-matches'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.scenario).toBe('interactive-turn');
    expect(body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ship-it' }),
    ]));
    expect(body.matches['ship-it'].codex).toMatchObject({
      level: 'ready',
      runtimeKind: 'codex',
    });
    expect(body.matches['ship-it'].mindos).toMatchObject({
      level: 'blocked',
      blockers: expect.arrayContaining(['runtime-kind', 'tool:git', 'capability:pr-output']),
    });
  });

  it('passes the requested scenario into the matcher', async () => {
    seedSkill(mindRoot, 'ship-it');

    const { GET } = await importRoute();
    const res = await GET(new Request('http://localhost/api/skills/runtime-matches?scenario=remote-control'));
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.scenario).toBe('remote-control');
    expect(body.matches['ship-it'].codex.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'remote-safety', status: 'unknown' }),
    ]));
  });
});
