import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * GET /api/skills/matrix — unified (skill × agent) read model plus the
 * one-time migration of legacy installedSkillAgents[] copy installs.
 */

const mocks = vi.hoisted(() => ({
  migrateInstalledSkillAgents: vi.fn(),
  readInstalledSkillAgents: vi.fn<() => Array<{ agent: string; skill: string; path: string }>>(() => []),
  clearInstalledSkillAgents: vi.fn(),
  listSkillLinkAgents: vi.fn<() => Array<{ key: string; name: string; mode: 'universal' | 'additional'; skillDir: string }>>(() => []),
  settings: { mindRoot: '', disabledSkills: undefined as string[] | undefined },
}));

vi.mock('@geminilight/mindos/server', async () => {
  const actual = await import('../../../mindos/src/server');
  return { ...actual, migrateInstalledSkillAgents: mocks.migrateInstalledSkillAgents };
});

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({
    ai: { activeProvider: '', providers: [] },
    mindRoot: mocks.settings.mindRoot,
    disabledSkills: mocks.settings.disabledSkills,
  }),
  writeSettings: vi.fn(),
  readInstalledSkillAgents: mocks.readInstalledSkillAgents,
  clearInstalledSkillAgents: mocks.clearInstalledSkillAgents,
  effectiveSopRoot: () => mocks.settings.mindRoot,
}));

vi.mock('@/lib/mcp-agents', () => ({
  listSkillLinkAgents: mocks.listSkillLinkAgents,
}));

let tempHome: string;
let mindRoot: string;
let projectRoot: string;
let agentSkillDir: string;
let origHome: string | undefined;
let origProjectRoot: string | undefined;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-matrix-test-'));
  mindRoot = path.join(tempHome, 'mind');
  projectRoot = path.join(tempHome, 'project');
  agentSkillDir = path.join(tempHome, '.claude', 'skills');
  fs.mkdirSync(mindRoot, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });

  origHome = process.env.HOME;
  origProjectRoot = process.env.MINDOS_PROJECT_ROOT;
  process.env.HOME = tempHome;
  process.env.MINDOS_PROJECT_ROOT = projectRoot;

  mocks.settings.mindRoot = mindRoot;
  mocks.settings.disabledSkills = undefined;
  mocks.migrateInstalledSkillAgents.mockReset().mockReturnValue({ converted: [], marked: [], skipped: [] });
  mocks.readInstalledSkillAgents.mockReset().mockReturnValue([]);
  mocks.clearInstalledSkillAgents.mockReset();
  mocks.listSkillLinkAgents.mockReset().mockReturnValue([
    { key: 'claude-code', name: 'Claude Code', mode: 'additional', skillDir: agentSkillDir },
  ]);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  fs.rmSync(tempHome, { recursive: true, force: true });
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origProjectRoot === undefined) delete process.env.MINDOS_PROJECT_ROOT;
  else process.env.MINDOS_PROJECT_ROOT = origProjectRoot;
});

function seedSkill(root: string, name: string): string {
  const skillDir = path.join(root, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\n\nBody`, 'utf-8');
  return skillDir;
}

// Re-import per test so the route picks up the per-test MINDOS_PROJECT_ROOT/HOME.
async function importMatrixRoute() {
  vi.resetModules();
  return await import('../../app/api/skills/matrix/route');
}

describe('GET /api/skills/matrix', () => {
  it('returns the skills × agents matrix with MindOS as the first (self) column', async () => {
    const alphaBody = seedSkill(path.join(mindRoot, '.skills'), 'alpha-skill');
    seedSkill(path.join(projectRoot, 'skills'), 'beta-skill');
    mocks.settings.disabledSkills = ['beta-skill'];

    // alpha-skill is linked into the downstream agent's skill dir; beta-skill is not.
    fs.mkdirSync(agentSkillDir, { recursive: true });
    fs.symlinkSync(alphaBody, path.join(agentSkillDir, 'alpha-skill'), 'dir');

    const { GET } = await importMatrixRoute();
    const res = await GET();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);

    expect(body.agents[0]).toMatchObject({ key: 'mindos', mode: 'self' });
    expect(body.agents).toHaveLength(2);
    expect(body.agents[1]).toMatchObject({ key: 'claude-code', mode: 'additional', skillDir: agentSkillDir });

    const skillNames = body.skills.map((skill: { name: string }) => skill.name);
    expect(skillNames).toContain('alpha-skill');
    expect(skillNames).toContain('beta-skill');

    expect(body.state['alpha-skill']).toEqual({ mindos: true, 'claude-code': true });
    expect(body.state['beta-skill']).toEqual({ mindos: false, 'claude-code': false });

    expect(body.cells['alpha-skill']['claude-code']).toEqual({ enabled: true, status: 'linked' });
    expect(body.cells['alpha-skill'].mindos).toEqual({ enabled: true, status: 'enabled' });
    expect(body.cells['beta-skill']['claude-code']).toEqual({ enabled: false, status: 'none' });
    expect(body.cells['beta-skill'].mindos).toEqual({ enabled: false, status: 'disabled' });
  }, 15_000);

  it('does not run the legacy migration when there are no installedSkillAgents records', async () => {
    const { GET } = await importMatrixRoute();
    const res = await GET();

    expect(res.status).toBe(200);
    expect(mocks.migrateInstalledSkillAgents).not.toHaveBeenCalled();
    expect(mocks.clearInstalledSkillAgents).not.toHaveBeenCalled();
  });

  it('migrates legacy installedSkillAgents records and clears them afterwards', async () => {
    const records = [{ agent: 'claude-code', skill: 'alpha-skill', path: path.join(agentSkillDir, 'alpha-skill', 'SKILL.md') }];
    mocks.readInstalledSkillAgents.mockReturnValue(records);

    const { GET } = await importMatrixRoute();
    const res = await GET();

    expect(res.status).toBe(200);
    expect(mocks.migrateInstalledSkillAgents).toHaveBeenCalledTimes(1);
    expect(mocks.migrateInstalledSkillAgents).toHaveBeenCalledWith(expect.objectContaining({
      records,
      skillRoots: expect.any(Array),
      agents: [expect.objectContaining({ key: 'claude-code', skillDir: agentSkillDir })],
    }));
    expect(mocks.clearInstalledSkillAgents).toHaveBeenCalledTimes(1);
  });

  it('still returns the matrix when the legacy migration throws', async () => {
    seedSkill(path.join(mindRoot, '.skills'), 'alpha-skill');
    mocks.readInstalledSkillAgents.mockReturnValue([{ agent: 'claude-code', skill: 'alpha-skill', path: '/tmp/x' }]);
    mocks.migrateInstalledSkillAgents.mockImplementation(() => { throw new Error('migration exploded'); });

    const { GET } = await importMatrixRoute();
    const res = await GET();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.agents[0]).toMatchObject({ key: 'mindos', mode: 'self' });
    expect(body.state['alpha-skill'].mindos).toBe(true);
    // Records stay in place for the next attempt; only a warning is logged.
    expect(mocks.clearInstalledSkillAgents).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
