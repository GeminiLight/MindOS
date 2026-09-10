import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAgentConfigProbes } from './probes.js';
import { listInstalledSkillNames, resolveAgentHiddenRoot, resolveSkillWorkspaceProfile, UNIVERSAL_SKILLS_DIR } from './skill-workspace.js';
import type { AgentConfigDef } from './types.js';

let home: string;

function probes() {
  return resolveAgentConfigProbes({ homeDir: home });
}

const claude: AgentConfigDef = {
  name: 'Claude Code',
  project: '.mcp.json',
  global: '~/.claude.json',
  key: 'mcpServers',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.claude/'],
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'skill-workspace-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('resolveAgentHiddenRoot', () => {
  it('prefers the presence dir that contains the global config', () => {
    const codex: AgentConfigDef = { ...claude, global: '~/.codex/config.toml', presenceDirs: ['~/.codex/'] };
    expect(resolveAgentHiddenRoot(codex, probes())).toBe(join(home, '.codex'));
  });

  it('falls back to the first declared presence dir on a fresh machine, never dirname(global)', () => {
    // Regression: Claude's global config lives at ~/.claude.json, so the old
    // dirname(global) fallback produced `~/skills` instead of `~/.claude/skills`.
    expect(resolveAgentHiddenRoot(claude, probes())).toBe(join(home, '.claude'));
  });

  it('uses the first existing presence dir when the global config matches none', () => {
    const def: AgentConfigDef = { ...claude, global: '~/somewhere/config.json', presenceDirs: ['~/.gone/', '~/.here/'] };
    mkdirSync(join(home, '.here'), { recursive: true });
    expect(resolveAgentHiddenRoot(def, probes())).toBe(join(home, '.here'));
  });

  it('treats a presence FILE as its directory', () => {
    const def: AgentConfigDef = { ...claude, global: '~/elsewhere/config.json', presenceDirs: ['~/.qoder.json'] };
    writeFileSync(join(home, '.qoder.json'), '{}', 'utf-8');
    expect(resolveAgentHiddenRoot(def, probes())).toBe(home);
  });

  it('falls back to the global config directory, then ~/.agents', () => {
    const noPresence: AgentConfigDef = { ...claude, global: '~/.config/agent/cfg.json', presenceDirs: [] };
    expect(resolveAgentHiddenRoot(noPresence, probes())).toBe(join(home, '.config', 'agent'));
  });
});

describe('resolveSkillWorkspaceProfile', () => {
  it('routes universal agents to the shared pool', () => {
    const profile = resolveSkillWorkspaceProfile('cursor', claude, { mode: 'universal' }, probes());
    expect(profile).toEqual({ mode: 'universal', workspacePath: join(home, '.agents', 'skills') });
    expect(UNIVERSAL_SKILLS_DIR).toBe('~/.agents/skills');
  });

  it('uses the declared skillDir when present', () => {
    const def: AgentConfigDef = { ...claude, skillDir: '~/.custom/skillz' };
    const profile = resolveSkillWorkspaceProfile('x', def, { mode: 'additional', skillAgentName: 'x' }, probes());
    expect(profile).toEqual({ mode: 'additional', skillAgentName: 'x', workspacePath: join(home, '.custom', 'skillz') });
  });

  it('defaults to <hidden root>/skills for additional agents', () => {
    const profile = resolveSkillWorkspaceProfile('claude-code', claude, { mode: 'additional', skillAgentName: 'claude-code' }, probes());
    expect(profile.workspacePath).toBe(join(home, '.claude', 'skills'));
  });

  it('reports the MindOS self row as universal over its own dir', () => {
    const mindos: AgentConfigDef = { name: 'MindOS', project: null, global: '~/.mindos/mcp.json', key: 'mcpServers', preferredTransport: 'stdio', presenceDirs: ['~/.mindos/'] };
    const profile = resolveSkillWorkspaceProfile('mindos', mindos, undefined, probes());
    expect(profile.mode).toBe('universal');
    expect(profile.workspacePath).toBe(join(home, '.mindos', 'skills'));
  });

  it('reports unsupported when there is no registration', () => {
    const profile = resolveSkillWorkspaceProfile('unknown', claude, undefined, probes());
    expect(profile.mode).toBe('unsupported');
  });
});

describe('listInstalledSkillNames', () => {
  it('lists visible directories and symlinks, sorted, skipping dot entries', () => {
    const workspace = join(home, 'ws');
    mkdirSync(join(workspace, 'zeta'), { recursive: true });
    mkdirSync(join(workspace, 'alpha'), { recursive: true });
    mkdirSync(join(workspace, '.hidden'), { recursive: true });
    const outside = join(home, 'body');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(workspace, 'linked'));

    expect(listInstalledSkillNames(workspace, probes())).toEqual(['alpha', 'linked', 'zeta']);
  });

  it('returns empty for a missing workspace', () => {
    expect(listInstalledSkillNames(join(home, 'nope'), probes())).toEqual([]);
  });

  it('filters to entries carrying a SKILL.md when requireSkillFile is set', () => {
    const workspace = join(home, 'ws');
    mkdirSync(join(workspace, 'real'), { recursive: true });
    writeFileSync(join(workspace, 'real', 'SKILL.md'), '---\nname: real\n---\n', 'utf-8');
    mkdirSync(join(workspace, 'empty'), { recursive: true });

    expect(listInstalledSkillNames(workspace, probes(), { requireSkillFile: true })).toEqual(['real']);
    expect(listInstalledSkillNames(workspace, probes())).toEqual(['empty', 'real']);
  });
});
