import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MindosSkillLinkAgent } from './skill-links.js';
import { handleSkillMatrixGet, handleSkillsPost, type MindosSkillRoot, type MindosSkillsSettings } from './skills.js';

/**
 * Legacy `installedSkillAgents[]` copy installs are replayed once, on the
 * first matrix write, and then dropped from settings (links on disk are the
 * only truth). Reads never touch the ledger.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeSkillBody(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n\nbody of ${name}\n`, 'utf-8');
  return dir;
}

function makeFixture(buildSettings: (agent: MindosSkillLinkAgent) => MindosSkillsSettings) {
  const base = mkdtempSync(join(tmpdir(), 'mindos-skills-legacy-'));
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  const mindRoot = join(base, 'mind');
  mkdirSync(mindRoot, { recursive: true });
  const skillsRoot = join(base, 'skills-root');
  const demoBody = makeSkillBody(skillsRoot, 'demo');
  makeSkillBody(skillsRoot, 'other');
  const skillRoots: MindosSkillRoot[] = [{ path: skillsRoot, source: 'builtin', origin: 'app-builtin', editable: false }];
  const agent: MindosSkillLinkAgent = { key: 'claude-code', name: 'Claude Code', mode: 'additional', skillDir: join(base, 'agent', 'skills') };
  // A legacy copy install: the same content as the body, but a real directory.
  const legacyDir = join(agent.skillDir, 'demo');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'SKILL.md'), readFileSync(join(demoBody, 'SKILL.md')));

  const writes: MindosSkillsSettings[] = [];
  let current = buildSettings(agent);
  const services = {
    mindRoot,
    skillRoots,
    readSettings: () => current,
    writeSettings: (next: MindosSkillsSettings) => { writes.push(next); current = next; },
    listLinkAgents: () => [agent],
  };
  return { base, demoBody, legacyDir, agent, services, writes, skillRoots };
}

describe('legacy installedSkillAgents migration', () => {
  it('converts an identical legacy copy into a link and drops the ledger on the first matrix write', () => {
    const { demoBody, legacyDir, agent, services, writes } = makeFixture((fixtureAgent) => ({
      disabledSkills: ['keep-me'],
      installedSkillAgents: [{ agent: 'claude-code', skill: 'demo', path: join(fixtureAgent.skillDir, 'demo', 'SKILL.md') }],
    }));
    expect(agent.key).toBe('claude-code');

    const linked = handleSkillsPost({ action: 'link', name: 'other', agentKey: 'claude-code' }, services);
    expect(linked.status).toBe(200);

    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(true);
    expect(realpathSync(legacyDir)).toBe(realpathSync(demoBody));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ disabledSkills: ['keep-me'] });
    expect('installedSkillAgents' in writes[0]!).toBe(false);

    // Second write: nothing left to migrate, settings untouched.
    handleSkillsPost({ action: 'unlink', name: 'other', agentKey: 'claude-code' }, services);
    expect(writes).toHaveLength(1);
  });

  it('keeps a user-modified copy, still drops the ledger, and reports the skip', () => {
    const { legacyDir, services, writes } = makeFixture((fixtureAgent) => ({
      installedSkillAgents: [{ agent: 'claude-code', skill: 'demo', path: join(fixtureAgent.skillDir, 'demo', 'SKILL.md') }],
    }));
    writeFileSync(join(legacyDir, 'SKILL.md'), 'edited by the user', 'utf-8');
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: string) => { warnings.push(String(message)); };
    try {
      handleSkillsPost({ action: 'link', name: 'other', agentKey: 'claude-code' }, services);
    } finally {
      console.warn = warn;
    }

    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(legacyDir, 'SKILL.md'), 'utf-8')).toBe('edited by the user');
    expect(writes).toEqual([{}]);
    expect(warnings.some((message) => /differs from its body/.test(message))).toBe(true);
  });

  it('drops an empty or malformed ledger without touching agent skill dirs', () => {
    const { legacyDir, services, writes } = makeFixture(() => ({
      installedSkillAgents: [{ agent: 42, skill: null } as unknown as { agent: string; skill: string; path: string }],
    }));

    handleSkillsPost({ action: 'link', name: 'other', agentKey: 'claude-code' }, services);

    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(false);
    expect(writes).toEqual([{}]);
  });

  it('never migrates or clears on a matrix read', () => {
    const { legacyDir, agent, services, writes, skillRoots } = makeFixture((fixtureAgent) => ({
      installedSkillAgents: [{ agent: 'claude-code', skill: 'demo', path: join(fixtureAgent.skillDir, 'demo', 'SKILL.md') }],
    }));

    const response = handleSkillMatrixGet({ skillRoots, listLinkAgents: () => [agent] });

    expect(response.status).toBe(200);
    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(false);
    expect(writes).toEqual([]);
    expect(services.readSettings().installedSkillAgents).toHaveLength(1);
  });

  it('rejects the retired record-install action', () => {
    const { services } = makeFixture(() => ({}));
    expect(handleSkillsPost({ action: 'record-install', name: 'demo', agentKey: 'claude-code', installPath: '/tmp/x' }, services))
      .toMatchObject({ status: 400, body: { error: 'Unknown action: record-install' } });
  });
});
