import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSkillMatrix,
  disableNativeSkill,
  enableNativeSkill,
  getSkillCellStatus,
  linkSkillToAgent,
  migrateInstalledSkillAgents,
  MINDOS_DISABLED_DIR,
  MINDOS_MANAGED_MARKER,
  resolveSkillSourceDir,
  unlinkSkillFromAgent,
  type MindosSkillLinkAgent,
} from './skill-links.js';
import { resolveSkillLinkAgents } from './mcp-agents.js';
import {
  collectSkillInfos,
  handleSkillMatrixGet,
  handleSkillsGet,
  handleSkillsPost,
  type MindosSkillRoot,
  type MindosSkillsSettings,
  type SkillsPostHandlerServices,
} from './skills.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeSkillBody(root: string, name: string, content = `body of ${name}`): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${content}\n`, 'utf-8');
  writeFileSync(join(dir, 'extra.txt'), `${content}-extra`, 'utf-8');
  return dir;
}

function makeFixture(options: { source?: 'builtin' | 'user' } = {}) {
  const base = makeTempDir('mindos-skill-links-');
  const skillsRoot = join(base, 'skills-root');
  mkdirSync(skillsRoot, { recursive: true });
  const bodyDir = makeSkillBody(skillsRoot, 'demo');
  const skillRoots: MindosSkillRoot[] = [{
    path: skillsRoot,
    source: options.source ?? 'builtin',
    origin: options.source === 'user' ? 'mindos-global' : 'app-builtin',
    editable: options.source === 'user',
  }];
  const agent: MindosSkillLinkAgent = {
    key: 'claude-code',
    name: 'Claude Code',
    mode: 'additional',
    skillDir: join(base, 'agent-claude', 'skills'),
  };
  const otherAgent: MindosSkillLinkAgent = {
    key: 'windsurf',
    name: 'Windsurf',
    mode: 'additional',
    skillDir: join(base, 'agent-windsurf', 'skills'),
  };
  return { base, skillsRoot, bodyDir, skillRoots, agent, otherAgent };
}

/** What a downstream agent does on startup: list skill dirs (following links) and read SKILL.md. */
function downstreamScan(skillDir: string): string[] {
  if (!existsSync(skillDir)) return [];
  return readdirSync(skillDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .filter((entry) => {
      const skillFile = join(skillDir, entry.name, 'SKILL.md');
      try {
        return statSync(skillFile).isFile() && readFileSync(skillFile, 'utf-8').length > 0;
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name);
}

describe('skill link/unlink against a downstream agent', () => {
  it("linking a skill to an agent creates a symlink in that agent's skill directory pointing to the skill body", () => {
    const { bodyDir, skillRoots, agent } = makeFixture();

    const outcome = linkSkillToAgent('demo', agent, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'linked' });
    const linkPath = join(agent.skillDir, 'demo');
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(linkPath)).toBe(realpathSync(bodyDir));
  });

  it('the downstream agent discovers and loads a newly linked skill on its next scan', () => {
    const { skillRoots, agent } = makeFixture();

    expect(downstreamScan(agent.skillDir)).toEqual([]);
    linkSkillToAgent('demo', agent, skillRoots);
    expect(downstreamScan(agent.skillDir)).toEqual(['demo']);
  });

  it('unlinking a skill removes only the link, leaving the skill body untouched', () => {
    const { bodyDir, skillRoots, agent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots);

    const outcome = unlinkSkillFromAgent('demo', agent);

    expect(outcome).toEqual({ ok: true, result: 'removed' });
    expect(existsSync(join(agent.skillDir, 'demo'))).toBe(false);
    expect(readFileSync(join(bodyDir, 'SKILL.md'), 'utf-8')).toContain('body of demo');
    expect(readFileSync(join(bodyDir, 'extra.txt'), 'utf-8')).toBe('body of demo-extra');
  });

  it('the downstream agent no longer loads an unlinked skill on its next scan', () => {
    const { skillRoots, agent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots);
    expect(downstreamScan(agent.skillDir)).toEqual(['demo']);

    unlinkSkillFromAgent('demo', agent);

    expect(downstreamScan(agent.skillDir)).toEqual([]);
  });

  it('linking falls back to a junction on Windows, and to a copy when linking is unavailable', () => {
    const { skillRoots, agent, otherAgent } = makeFixture();

    // Windows: plain symlink denied (no privilege) → junction succeeds.
    const attempts: string[] = [];
    const junctionOutcome = linkSkillToAgent('demo', agent, skillRoots, {
      platform: 'win32',
      symlink: (target, path, type) => {
        attempts.push(type);
        if (type !== 'junction') throw new Error('EPERM: symlink requires elevation');
        symlinkSync(target, path); // simulate the junction with a real link for inspection
      },
    });
    expect(junctionOutcome).toEqual({ ok: true, result: 'linked' });
    expect(attempts).toEqual(['dir', 'junction']);

    // Linking entirely unavailable → copy fallback.
    const copyOutcome = linkSkillToAgent('demo', otherAgent, skillRoots, {
      platform: 'win32',
      symlink: () => {
        throw new Error('EPERM: no link support at all');
      },
    });
    expect(copyOutcome).toEqual({ ok: true, result: 'copied' });
    const copyPath = join(otherAgent.skillDir, 'demo');
    expect(lstatSync(copyPath).isDirectory()).toBe(true);
    expect(lstatSync(copyPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(copyPath, 'SKILL.md'), 'utf-8')).toContain('body of demo');
  });

  it('copy fallback places a .mindos-managed marker inside the copied directory for identification', () => {
    const { skillRoots, agent } = makeFixture();

    linkSkillToAgent('demo', agent, skillRoots, { symlink: () => { throw new Error('EPERM'); } });

    expect(existsSync(join(agent.skillDir, 'demo', MINDOS_MANAGED_MARKER))).toBe(true);
  });

  it('unlinking a copy-fallback skill removes the copied files but never the original body', () => {
    const { bodyDir, skillRoots, agent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots, { symlink: () => { throw new Error('EPERM'); } });

    const outcome = unlinkSkillFromAgent('demo', agent);

    expect(outcome).toEqual({ ok: true, result: 'removed' });
    expect(existsSync(join(agent.skillDir, 'demo'))).toBe(false);
    expect(readFileSync(join(bodyDir, 'SKILL.md'), 'utf-8')).toContain('body of demo');
  });

  it('linking the same skill to one agent does not affect its state in other agents', () => {
    const { skillRoots, agent, otherAgent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots);
    linkSkillToAgent('demo', otherAgent, skillRoots);

    unlinkSkillFromAgent('demo', agent);

    expect(getSkillCellStatus(agent, 'demo')).toBe('none');
    expect(getSkillCellStatus(otherAgent, 'demo')).toBe('linked');
  });

  it('link/unlink is idempotent (re-linking an existing link, or unlinking a missing one, succeeds without error)', () => {
    const { skillRoots, agent } = makeFixture();

    expect(linkSkillToAgent('demo', agent, skillRoots)).toEqual({ ok: true, result: 'linked' });
    expect(linkSkillToAgent('demo', agent, skillRoots)).toEqual({ ok: true, result: 'already' });
    expect(unlinkSkillFromAgent('demo', agent)).toEqual({ ok: true, result: 'removed' });
    expect(unlinkSkillFromAgent('demo', agent)).toEqual({ ok: true, result: 'missing' });
  });

  it('unlinking a builtin skill from a downstream agent succeeds (only the downstream link is removed)', () => {
    const { bodyDir, skillRoots, agent } = makeFixture({ source: 'builtin' });
    linkSkillToAgent('demo', agent, skillRoots);

    const outcome = unlinkSkillFromAgent('demo', agent);

    expect(outcome.ok).toBe(true);
    expect(existsSync(join(agent.skillDir, 'demo'))).toBe(false);
    expect(existsSync(join(bodyDir, 'SKILL.md'))).toBe(true);
    // MindOS's own view of the builtin skill is untouched by the downstream unlink.
    const skills = collectSkillInfos(skillRoots, new Set());
    expect(skills.find((skill) => skill.name === 'demo')?.enabled).toBe(true);
  });

  it('a dangling symlink (target removed) is reported as disabled or broken in the matrix, and re-linking replaces it cleanly', () => {
    const { base, bodyDir, skillRoots, agent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots);
    rmSync(bodyDir, { recursive: true, force: true });

    expect(getSkillCellStatus(agent, 'demo')).toBe('broken');
    const matrix = buildSkillMatrix({
      skills: collectSkillInfos(skillRoots, new Set()),
      agents: [agent],
    });
    // Body is gone so the skill no longer appears; the cell helper reports broken → disabled.
    expect(matrix.skills.find((skill) => skill.name === 'demo')).toBeUndefined();

    // The body re-appears at a DIFFERENT path (user root) — the old link stays dangling.
    const userRoot = join(base, 'user-root');
    mkdirSync(userRoot, { recursive: true });
    const newBody = makeSkillBody(userRoot, 'demo', 'recreated body');
    skillRoots.push({ path: userRoot, source: 'user', origin: 'mindos-global', editable: true });

    const relink = linkSkillToAgent('demo', agent, skillRoots);
    expect(relink).toEqual({ ok: true, result: 'linked' });
    expect(getSkillCellStatus(agent, 'demo')).toBe('linked');
    expect(realpathSync(join(agent.skillDir, 'demo'))).toBe(realpathSync(newBody));
    expect(readFileSync(join(agent.skillDir, 'demo', 'SKILL.md'), 'utf-8')).toContain('recreated body');
  });

  it('linking to a path where a real (non-symlink) directory already exists returns a conflict error without overwriting', () => {
    const { skillRoots, agent } = makeFixture();
    const userDir = join(agent.skillDir, 'demo');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'SKILL.md'), 'hand-written by the user', 'utf-8');

    const outcome = linkSkillToAgent('demo', agent, skillRoots);

    expect(outcome).toMatchObject({ ok: false, code: 'conflict' });
    expect(readFileSync(join(userDir, 'SKILL.md'), 'utf-8')).toBe('hand-written by the user');
    expect(lstatSync(userDir).isSymbolicLink()).toBe(false);
  });

  it('unlinking a real directory without the managed marker is refused', () => {
    const { agent } = makeFixture();
    const userDir = join(agent.skillDir, 'demo');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'SKILL.md'), 'user content', 'utf-8');

    const outcome = unlinkSkillFromAgent('demo', agent);

    expect(outcome).toMatchObject({ ok: false, code: 'conflict' });
    expect(readFileSync(join(userDir, 'SKILL.md'), 'utf-8')).toBe('user content');
  });

  it('linking a skill whose body already lives inside the agent skill directory is a no-op that never deletes the body', () => {
    const base = makeTempDir('mindos-self-link-');
    // The universal shared dir is BOTH a skill root and the agent's skill dir.
    const sharedDir = join(base, 'agents-skills');
    mkdirSync(sharedDir, { recursive: true });
    const bodyDir = makeSkillBody(sharedDir, 'demo');
    const skillRoots: MindosSkillRoot[] = [
      { path: sharedDir, source: 'builtin', origin: 'agents-global', editable: false },
    ];
    const universalAgent: MindosSkillLinkAgent = {
      key: 'cursor',
      name: 'Cursor',
      mode: 'universal',
      skillDir: sharedDir,
    };

    const outcome = linkSkillToAgent('demo', universalAgent, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'already' });
    // The body must still be a REAL directory — not removed, not a self-referencing symlink.
    expect(lstatSync(bodyDir).isDirectory()).toBe(true);
    expect(lstatSync(bodyDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(bodyDir, 'SKILL.md'), 'utf-8')).toContain('body of demo');
  });

  it('unlinking an unmarked copy that is content-identical to the body removes it safely', () => {
    const { bodyDir, skillRoots, agent } = makeFixture();
    // Legacy copy-route artifact: real dir, no marker, same content as the body.
    const copyDir = join(agent.skillDir, 'demo');
    mkdirSync(copyDir, { recursive: true });
    writeFileSync(join(copyDir, 'SKILL.md'), readFileSync(join(bodyDir, 'SKILL.md')));
    writeFileSync(join(copyDir, 'extra.txt'), readFileSync(join(bodyDir, 'extra.txt')));

    const outcome = unlinkSkillFromAgent('demo', agent, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'removed' });
    expect(existsSync(copyDir)).toBe(false);
    expect(readFileSync(join(bodyDir, 'SKILL.md'), 'utf-8')).toContain('body of demo');
  });

  it('unlinking an unmarked copy with diverged content is still refused even when skill roots are known', () => {
    const { skillRoots, agent } = makeFixture();
    const copyDir = join(agent.skillDir, 'demo');
    mkdirSync(copyDir, { recursive: true });
    writeFileSync(join(copyDir, 'SKILL.md'), 'user edited this copy', 'utf-8');

    const outcome = unlinkSkillFromAgent('demo', agent, skillRoots);

    expect(outcome).toMatchObject({ ok: false, code: 'conflict' });
    expect(readFileSync(join(copyDir, 'SKILL.md'), 'utf-8')).toBe('user edited this copy');
  });

  it('linking converts a content-identical legacy copy into a link instead of failing', () => {
    const { bodyDir, skillRoots, agent } = makeFixture();
    mkdirSync(agent.skillDir, { recursive: true });
    // Simulate the pre-symlink copy install: same content, no marker.
    const legacyDir = join(agent.skillDir, 'demo');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'SKILL.md'), readFileSync(join(bodyDir, 'SKILL.md')));
    writeFileSync(join(legacyDir, 'extra.txt'), readFileSync(join(bodyDir, 'extra.txt')));

    const outcome = linkSkillToAgent('demo', agent, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'linked' });
    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(true);
  });

  it('link on an unwritable agent directory returns an explicit error, not silent success', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // chmod semantics differ
    const { skillRoots, agent } = makeFixture();
    mkdirSync(agent.skillDir, { recursive: true });
    chmodSync(agent.skillDir, 0o500);
    cleanups.push(() => chmodSync(agent.skillDir, 0o700));

    const outcome = linkSkillToAgent('demo', agent, skillRoots);

    expect(outcome).toMatchObject({ ok: false, code: 'io-error' });
    expect(getSkillCellStatus(agent, 'demo')).toBe('none');
  });
});

describe('disabling native skills without deleting them', () => {
  /** A native skill = real directory the agent owns, no MindOS marker. */
  function makeNativeFixture() {
    const fixture = makeFixture();
    const nativeDir = join(fixture.agent.skillDir, 'native-thing');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'SKILL.md'), '---\nname: native-thing\n---\nagent-owned body', 'utf-8');
    return { ...fixture, nativeDir };
  }

  it('disabling a native skill parks it under .mindos-disabled so the agent stops loading it, body untouched', () => {
    const { agent, nativeDir } = makeNativeFixture();

    const outcome = disableNativeSkill('native-thing', agent);

    expect(outcome).toEqual({ ok: true, result: 'disabled' });
    expect(existsSync(nativeDir)).toBe(false);
    expect(downstreamScan(agent.skillDir)).not.toContain('native-thing');
    const parked = join(agent.skillDir, MINDOS_DISABLED_DIR, 'native-thing');
    expect(readFileSync(join(parked, 'SKILL.md'), 'utf-8')).toContain('agent-owned body');
    expect(getSkillCellStatus(agent, 'native-thing')).toBe('native-disabled');
  });

  it('re-enabling restores the directory exactly and the agent loads it again', () => {
    const { agent, nativeDir } = makeNativeFixture();
    disableNativeSkill('native-thing', agent);

    const outcome = enableNativeSkill('native-thing', agent);

    expect(outcome).toEqual({ ok: true, result: 'enabled' });
    expect(readFileSync(join(nativeDir, 'SKILL.md'), 'utf-8')).toContain('agent-owned body');
    expect(downstreamScan(agent.skillDir)).toContain('native-thing');
    expect(existsSync(join(agent.skillDir, MINDOS_DISABLED_DIR))).toBe(false); // emptied holding dir is removed
  });

  it('disable and enable are idempotent', () => {
    const { agent } = makeNativeFixture();

    expect(disableNativeSkill('native-thing', agent)).toEqual({ ok: true, result: 'disabled' });
    expect(disableNativeSkill('native-thing', agent)).toEqual({ ok: true, result: 'already' });
    expect(enableNativeSkill('native-thing', agent)).toEqual({ ok: true, result: 'enabled' });
    expect(enableNativeSkill('native-thing', agent)).toEqual({ ok: true, result: 'already' });
    expect(disableNativeSkill('ghost', agent)).toEqual({ ok: true, result: 'missing' });
    expect(enableNativeSkill('ghost', agent)).toEqual({ ok: true, result: 'missing' });
  });

  it('refuses to disable a MindOS-managed link (unlink is the right operation)', () => {
    const { skillRoots, agent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots);

    const outcome = disableNativeSkill('demo', agent);

    expect(outcome).toMatchObject({ ok: false, code: 'conflict' });
    expect(getSkillCellStatus(agent, 'demo')).toBe('linked');
  });

  it('re-enabling is refused when a new directory occupies the original name', () => {
    const { agent, nativeDir } = makeNativeFixture();
    disableNativeSkill('native-thing', agent);
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'SKILL.md'), 'newcomer', 'utf-8');

    const outcome = enableNativeSkill('native-thing', agent);

    expect(outcome).toMatchObject({ ok: false, code: 'conflict' });
    expect(readFileSync(join(nativeDir, 'SKILL.md'), 'utf-8')).toBe('newcomer');
  });

  it('the matrix reports a disabled native skill as native-disabled (off), and link restores it instead of shadowing', () => {
    const { base, agent } = makeFixture();
    // The native skill is also known to MindOS via a custom root pointing at the agent dir itself.
    const nativeDir = join(agent.skillDir, 'native-thing');
    mkdirSync(nativeDir, { recursive: true });
    writeFileSync(join(nativeDir, 'SKILL.md'), '---\nname: native-thing\n---\nagent-owned body', 'utf-8');
    const skillRoots: MindosSkillRoot[] = [
      { path: agent.skillDir, source: 'builtin', origin: 'custom', editable: false },
      { path: join(base, 'skills-root'), source: 'builtin', origin: 'app-builtin', editable: false },
    ];
    disableNativeSkill('native-thing', agent);

    const matrix = buildSkillMatrix({
      skills: collectSkillInfos(skillRoots, new Set()),
      agents: [agent],
    });
    // The body is parked, so it leaves the skill roots — but the matrix unions
    // parked-only entries back in, keeping a UI handle to restore it.
    expect(getSkillCellStatus(agent, 'native-thing')).toBe('native-disabled');
    expect(matrix.skills.find((skill) => skill.name === 'native-thing')).toBeTruthy();
    expect(matrix.cells['native-thing']?.[agent.key]).toEqual({ enabled: false, status: 'native-disabled' });

    // "Turn on" via the unified link action restores the original directory.
    const outcome = linkSkillToAgent('native-thing', agent, skillRoots);
    expect(outcome).toEqual({ ok: true, result: 'enabled' });
    expect(getSkillCellStatus(agent, 'native-thing')).toBe('conflict'); // back to a real agent-owned dir
    expect(readFileSync(join(nativeDir, 'SKILL.md'), 'utf-8')).toContain('agent-owned body');
  });
});

describe('universal agents with their own private skills dir (e.g. Codex)', () => {
  /** Codex-like: pool as workspace, plus its own ~/.codex/skills with a shipped skill. */
  function makeCodexFixture() {
    const base = makeTempDir('mindos-codex-');
    const pool = join(base, 'agents-skills');
    const ownDir = join(base, 'codex-skills');
    mkdirSync(pool, { recursive: true });
    const bodyDir = makeSkillBody(ownDir, 'chronicle');
    // MindOS knows the skill via the custom path pointing at the agent's own dir.
    const skillRoots: MindosSkillRoot[] = [
      { path: ownDir, source: 'builtin', origin: 'custom', editable: false },
    ];
    const codex: MindosSkillLinkAgent = {
      key: 'codex',
      name: 'Codex',
      mode: 'universal',
      skillDir: pool,
      nativeSkillDir: ownDir,
    };
    return { base, pool, ownDir, bodyDir, skillRoots, codex };
  }

  it("a skill shipped in the agent's own dir reports as natively ON, not none", () => {
    const { codex } = makeCodexFixture();
    expect(getSkillCellStatus(codex, 'chronicle')).toBe('conflict');
  });

  it('linking it to that agent is a no-op — the shared pool must stay clean', () => {
    const { pool, codex, skillRoots } = makeCodexFixture();

    const outcome = linkSkillToAgent('chronicle', codex, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'already' });
    expect(existsSync(join(pool, 'chronicle'))).toBe(false); // nothing leaked into ~/.agents/skills
  });

  it("disabling parks it inside the agent's own dir, and the pool stays untouched", () => {
    const { pool, ownDir, codex } = makeCodexFixture();

    const outcome = disableNativeSkill('chronicle', codex);

    expect(outcome).toEqual({ ok: true, result: 'disabled' });
    expect(existsSync(join(ownDir, 'chronicle'))).toBe(false);
    expect(existsSync(join(ownDir, MINDOS_DISABLED_DIR, 'chronicle'))).toBe(true);
    expect(readdirSync(pool)).toEqual([]);
    expect(getSkillCellStatus(codex, 'chronicle')).toBe('native-disabled');
  });

  it('turning it back on restores the original dir instead of creating a pool link', () => {
    const { pool, ownDir, codex, skillRoots } = makeCodexFixture();
    disableNativeSkill('chronicle', codex);

    const outcome = linkSkillToAgent('chronicle', codex, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'enabled' });
    expect(readFileSync(join(ownDir, 'chronicle', 'SKILL.md'), 'utf-8')).toContain('body of chronicle');
    expect(existsSync(join(pool, 'chronicle'))).toBe(false);
  });

  it('unlink removes a managed link from whichever dir holds it', () => {
    const { ownDir, codex } = makeCodexFixture();
    // A managed symlink sitting in the agent's own dir (e.g. created by hand earlier).
    const target = join(ownDir, 'chronicle');
    symlinkSync(target, join(ownDir, 'extra-link'));

    const outcome = unlinkSkillFromAgent('extra-link', codex);

    expect(outcome).toEqual({ ok: true, result: 'removed' });
    expect(existsSync(join(ownDir, 'extra-link'))).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it('a parked skill whose body dir doubles as a skill root STAYS visible in the matrix and is restorable', () => {
    // chronicle's body lives in ~/.codex/skills, which is ALSO a MindOS skill
    // root — parking it removes it from the roots, but the matrix must keep
    // the row, or there is no UI handle left to restore it.
    const { ownDir, codex, skillRoots } = makeCodexFixture();
    disableNativeSkill('chronicle', codex);

    const skills = collectSkillInfos(skillRoots, new Set());
    expect(skills.find((skill) => skill.name === 'chronicle')).toBeUndefined(); // gone from roots

    const matrix = buildSkillMatrix({ skills, agents: [codex] });
    const row = matrix.skills.find((skill) => skill.name === 'chronicle');
    expect(row).toBeTruthy(); // ...but still present in the matrix
    expect(matrix.cells.chronicle?.codex).toEqual({ enabled: false, status: 'native-disabled' });
    expect(matrix.cells.chronicle?.mindos).toEqual({ enabled: false, status: 'disabled' });

    const restore = linkSkillToAgent('chronicle', codex, skillRoots);
    expect(restore).toEqual({ ok: true, result: 'enabled' });
    expect(readFileSync(join(ownDir, 'chronicle', 'SKILL.md'), 'utf-8')).toContain('body of chronicle');
  });

  it('a skill absent from its own dir still links into the pool as usual', () => {
    const { base, pool, codex, skillRoots } = makeCodexFixture();
    const otherRoot = join(base, 'mindos-skills');
    mkdirSync(otherRoot, { recursive: true });
    makeSkillBody(otherRoot, 'managed-one');
    skillRoots.push({ path: otherRoot, source: 'user', origin: 'mindos-global', editable: true });

    const outcome = linkSkillToAgent('managed-one', codex, skillRoots);

    expect(outcome).toEqual({ ok: true, result: 'linked' });
    expect(lstatSync(join(pool, 'managed-one')).isSymbolicLink()).toBe(true);
  });
});

describe('skill source resolution', () => {
  it('prefers a user root over a builtin root when both contain the skill', () => {
    const base = makeTempDir('mindos-skill-source-');
    const builtinRoot = join(base, 'builtin');
    const userRoot = join(base, 'user');
    mkdirSync(builtinRoot, { recursive: true });
    mkdirSync(userRoot, { recursive: true });
    makeSkillBody(builtinRoot, 'demo', 'builtin body');
    const userBody = makeSkillBody(userRoot, 'demo', 'user body');
    const skillRoots: MindosSkillRoot[] = [
      { path: builtinRoot, source: 'builtin', origin: 'app-builtin', editable: false },
      { path: userRoot, source: 'user', origin: 'mindos-global', editable: true },
    ];

    expect(resolveSkillSourceDir('demo', skillRoots)).toBe(userBody);
  });

  it('resolves a skill whose frontmatter name differs from its directory name', () => {
    const base = makeTempDir('mindos-skill-source-');
    const root = join(base, 'root');
    const dir = join(root, 'folder-name');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: pretty-name\n---\nbody', 'utf-8');
    const skillRoots: MindosSkillRoot[] = [{ path: root, source: 'user', origin: 'custom', editable: true }];

    expect(resolveSkillSourceDir('pretty-name', skillRoots)).toBe(dir);
    expect(resolveSkillSourceDir('folder-name', skillRoots)).toBeNull();
  });

  it('returns null for an unknown skill', () => {
    const { skillRoots } = makeFixture();
    expect(resolveSkillSourceDir('nope', skillRoots)).toBeNull();
  });
});

describe('the unified skill matrix', () => {
  function makeMatrixFixture() {
    const fixture = makeFixture();
    makeSkillBody(fixture.skillsRoot, 'second');
    return fixture;
  }

  it('the skill-centric view and the agent-centric view report the same enabled state for every (skill, agent) cell', () => {
    const { skillRoots, agent, otherAgent } = makeMatrixFixture();
    linkSkillToAgent('demo', agent, skillRoots);

    const disabled = new Set(['second']);
    const matrix = buildSkillMatrix({
      skills: collectSkillInfos(skillRoots, disabled),
      agents: [agent, otherAgent],
      disabledSkills: ['second'],
    });

    for (const skill of matrix.skills) {
      // Skill-centric projection (a row) and agent-centric projection (a column)
      // are both reads of matrix.state — assert each cell agrees with the
      // independently-computed ground truth of that cell.
      for (const agentEntry of matrix.agents) {
        const fromState = matrix.state[skill.name]?.[agentEntry.key];
        const fromCells = matrix.cells[skill.name]?.[agentEntry.key]?.enabled;
        expect(fromState).toBe(fromCells);
        if (agentEntry.key === 'mindos') {
          expect(fromState).toBe(!disabled.has(skill.name));
        } else {
          const groundTruth = getSkillCellStatus(
            { key: agentEntry.key, name: agentEntry.name, mode: 'additional', skillDir: agentEntry.skillDir! },
            skill.name,
          );
          expect(fromState).toBe(groundTruth === 'linked' || groundTruth === 'copied');
        }
      }
    }
    expect(matrix.state.demo?.[agent.key]).toBe(true);
    expect(matrix.state.demo?.[otherAgent.key]).toBe(false);
  });

  it("toggling MindOS's own skill updates disabledSkills and is reflected identically in both views", () => {
    const { skillRoots, agent } = makeMatrixFixture();
    let settings: MindosSkillsSettings = {};
    const services: SkillsPostHandlerServices = {
      mindRoot: makeTempDir('mindos-mindroot-'),
      skillRoots,
      readSettings: () => settings,
      writeSettings: (next) => { settings = next; },
      listLinkAgents: () => [agent],
    };

    const response = handleSkillsPost({ action: 'toggle', name: 'demo', enabled: false }, services);
    expect(response.status).toBe(200);
    expect(settings.disabledSkills).toEqual(['demo']);

    const skillsView = handleSkillsGet({ disabledSkills: settings.disabledSkills, skillRoots });
    const matrixView = handleSkillMatrixGet({
      disabledSkills: settings.disabledSkills,
      skillRoots,
      listLinkAgents: () => [agent],
    });
    const demoRow = (skillsView.body!.skills).find((skill) => skill.name === 'demo');
    expect(demoRow?.enabled).toBe(false);
    expect(matrixView.body!.state.demo?.mindos).toBe(false);
    expect(matrixView.body!.cells.demo?.mindos?.status).toBe('disabled');
  });

  it('unsupported-mode agents do not appear in the skill matrix', () => {
    const base = makeTempDir('mindos-link-agents-');
    mkdirSync(join(base, '.claude'), { recursive: true });
    mkdirSync(join(base, '.qclaw'), { recursive: true });
    const agents = {
      'mindos': { name: 'MindOS', project: null, global: '~/.mindos/mcp.json', key: 'mcpServers', preferredTransport: 'stdio' as const, presenceDirs: ['~/.mindos/'] },
      'claude-code': { name: 'Claude Code', project: '.mcp.json', global: '~/.claude.json', key: 'mcpServers', preferredTransport: 'stdio' as const, presenceDirs: ['~/.claude/'] },
      'qclaw': { name: 'QClaw', project: null, global: '~/.qclaw/mcp.json', key: 'mcpServers', preferredTransport: 'stdio' as const, presenceDirs: ['~/.qclaw/'] },
      'windsurf': { name: 'Windsurf', project: null, global: '~/.codeium/windsurf/mcp_config.json', key: 'mcpServers', preferredTransport: 'stdio' as const, presenceDirs: ['~/.codeium/windsurf/'] },
    };
    const registry = {
      'claude-code': { mode: 'additional' as const, skillAgentName: 'claude-code' },
      'qclaw': { mode: 'unsupported' as const },
      'windsurf': { mode: 'additional' as const, skillAgentName: 'windsurf' },
    };

    const linkAgents = resolveSkillLinkAgents({
      agents,
      skillAgentRegistry: registry,
      homeDir: base,
      detectAgentPresence: (key) => key === 'claude-code' || key === 'qclaw',
    });

    const keys = linkAgents.map((entry) => entry.key);
    expect(keys).toContain('claude-code');       // present + additional → in
    expect(keys).not.toContain('qclaw');          // present but unsupported → out
    expect(keys).not.toContain('windsurf');       // supported but absent → out
    expect(keys).not.toContain('mindos');         // self column is added by the matrix, not here
    expect(linkAgents.find((entry) => entry.key === 'claude-code')?.skillDir)
      .toBe(join(base, '.claude', 'skills'));

    const matrix = buildSkillMatrix({ skills: [], agents: linkAgents });
    expect(matrix.agents.map((entry) => entry.key)).toEqual(['mindos', 'claude-code']);
  });
});

describe('skills POST link/unlink actions', () => {
  function makeServices(fixture: ReturnType<typeof makeFixture>) {
    let settings: MindosSkillsSettings = {};
    const services: SkillsPostHandlerServices = {
      mindRoot: makeTempDir('mindos-mindroot-'),
      skillRoots: fixture.skillRoots,
      readSettings: () => settings,
      writeSettings: (next) => { settings = next; },
      listLinkAgents: () => [fixture.agent],
    };
    return services;
  }

  it('link and unlink round-trip through the handler', () => {
    const fixture = makeFixture();
    const services = makeServices(fixture);

    const link = handleSkillsPost({ action: 'link', name: 'demo', agentKey: 'claude-code' }, services);
    expect(link).toMatchObject({ status: 200, body: { ok: true, result: 'linked' } });
    expect(getSkillCellStatus(fixture.agent, 'demo')).toBe('linked');

    const unlink = handleSkillsPost({ action: 'unlink', name: 'demo', agentKey: 'claude-code' }, services);
    expect(unlink).toMatchObject({ status: 200, body: { ok: true, result: 'removed' } });
    expect(getSkillCellStatus(fixture.agent, 'demo')).toBe('none');
  });

  it('link/unlink on a missing or unknown agent returns an explicit error, not silent success', () => {
    const fixture = makeFixture();
    const services = makeServices(fixture);

    const link = handleSkillsPost({ action: 'link', name: 'demo', agentKey: 'ghost-agent' }, services);
    expect(link.status).toBe(404);
    expect(link.body).toMatchObject({ error: expect.stringContaining('ghost-agent') });

    const unlink = handleSkillsPost({ action: 'unlink', name: 'demo', agentKey: 'ghost-agent' }, services);
    expect(unlink.status).toBe(404);
  });

  it('link of an unknown skill returns 404 and a conflict returns 409', () => {
    const fixture = makeFixture();
    const services = makeServices(fixture);

    expect(handleSkillsPost({ action: 'link', name: 'nope', agentKey: 'claude-code' }, services).status).toBe(404);

    const userDir = join(fixture.agent.skillDir, 'demo');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, 'SKILL.md'), 'user-owned', 'utf-8');
    expect(handleSkillsPost({ action: 'link', name: 'demo', agentKey: 'claude-code' }, services).status).toBe(409);
  });

  it('link/unlink without name or agentKey is rejected', () => {
    const fixture = makeFixture();
    const services = makeServices(fixture);

    expect(handleSkillsPost({ action: 'link', name: 'demo' }, services).status).toBe(400);
    expect(handleSkillsPost({ action: 'unlink', agentKey: 'claude-code' }, services).status).toBe(400);
  });
});

describe('migration of legacy copy installs', () => {
  it('replaces a content-identical legacy copy with a symlink to the body', () => {
    const { bodyDir, skillRoots, agent } = makeFixture();
    const legacyDir = join(agent.skillDir, 'demo');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'SKILL.md'), readFileSync(join(bodyDir, 'SKILL.md')));
    writeFileSync(join(legacyDir, 'extra.txt'), readFileSync(join(bodyDir, 'extra.txt')));

    const result = migrateInstalledSkillAgents({
      records: [{ agent: 'claude-code', skill: 'demo', path: join(legacyDir, 'SKILL.md') }],
      skillRoots,
      agents: [agent],
    });

    expect(result.converted).toEqual([{ agent: 'claude-code', skill: 'demo' }]);
    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(true);
    expect(realpathSync(legacyDir)).toBe(realpathSync(bodyDir));
  });

  it('keeps a user-modified copy untouched, marks it managed, and warns', () => {
    const { skillRoots, agent } = makeFixture();
    const legacyDir = join(agent.skillDir, 'demo');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'SKILL.md'), 'modified by the user', 'utf-8');
    const warnings: string[] = [];

    const result = migrateInstalledSkillAgents({
      records: [{ agent: 'claude-code', skill: 'demo', path: join(legacyDir, 'SKILL.md') }],
      skillRoots,
      agents: [agent],
      warn: (message) => warnings.push(message),
    });

    expect(result.marked).toEqual([{ agent: 'claude-code', skill: 'demo' }]);
    expect(lstatSync(legacyDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(legacyDir, 'SKILL.md'), 'utf-8')).toBe('modified by the user');
    expect(existsSync(join(legacyDir, MINDOS_MANAGED_MARKER))).toBe(true);
    expect(warnings.length).toBe(1);
  });

  it('skips absent agents and missing paths without throwing', () => {
    const { skillRoots, agent } = makeFixture();

    const result = migrateInstalledSkillAgents({
      records: [
        { agent: 'ghost', skill: 'demo', path: '/nowhere/SKILL.md' },
        { agent: 'claude-code', skill: 'demo', path: join(agent.skillDir, 'demo', 'SKILL.md') },
      ],
      skillRoots,
      agents: [agent],
    });

    expect(result.converted).toEqual([]);
    expect(result.skipped).toEqual([
      { agent: 'ghost', skill: 'demo', reason: 'agent not present' },
      { agent: 'claude-code', skill: 'demo', reason: 'install path missing' },
    ]);
  });

  it('skips a record whose install path is the skill body itself, leaving the body untouched', () => {
    const base = makeTempDir('mindos-migrate-self-');
    const sharedDir = join(base, 'agents-skills');
    mkdirSync(sharedDir, { recursive: true });
    const bodyDir = makeSkillBody(sharedDir, 'demo');
    const skillRoots: MindosSkillRoot[] = [
      { path: sharedDir, source: 'builtin', origin: 'agents-global', editable: false },
    ];
    const universalAgent: MindosSkillLinkAgent = { key: 'cursor', name: 'Cursor', mode: 'universal', skillDir: sharedDir };

    const result = migrateInstalledSkillAgents({
      records: [{ agent: 'cursor', skill: 'demo', path: join(bodyDir, 'SKILL.md') }],
      skillRoots,
      agents: [universalAgent],
    });

    expect(result.skipped).toEqual([{ agent: 'cursor', skill: 'demo', reason: 'install path is the skill body' }]);
    expect(lstatSync(bodyDir).isDirectory()).toBe(true);
    expect(lstatSync(bodyDir).isSymbolicLink()).toBe(false);
  });

  it('leaves an already-migrated symlink alone', () => {
    const { skillRoots, agent } = makeFixture();
    linkSkillToAgent('demo', agent, skillRoots);

    const result = migrateInstalledSkillAgents({
      records: [{ agent: 'claude-code', skill: 'demo', path: join(agent.skillDir, 'demo', 'SKILL.md') }],
      skillRoots,
      agents: [agent],
    });

    expect(result.skipped).toEqual([{ agent: 'claude-code', skill: 'demo', reason: 'already a link' }]);
    expect(getSkillCellStatus(agent, 'demo')).toBe('linked');
  });
});
