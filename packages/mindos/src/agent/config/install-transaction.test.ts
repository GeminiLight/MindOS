import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentConfigAdapter } from './adapter.js';
import { resetAgentConfigReadCacheForTests } from './config-read.js';
import { installAgentConnection, removeInstalledSkill } from './install-transaction.js';
import { MINDOS_MANAGED_MARKER } from './skill-link.js';
import type { AgentConfigDef, SkillRoot } from './types.js';

const def: AgentConfigDef = {
  name: 'Test Agent',
  project: null,
  global: '~/.test-agent/config.json',
  key: 'mcpServers',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.test-agent/'],
};

let home: string;
let skillSource: string;
let sourceRoots: SkillRoot[];

function adapter() {
  return createAgentConfigAdapter('test-agent', def, { mode: 'additional', skillAgentName: 'test-agent' }, { homeDir: home });
}

const entry = { command: 'mindos', args: ['mcp'] };

beforeEach(() => {
  resetAgentConfigReadCacheForTests();
  home = mkdtempSync(join(tmpdir(), 'install-tx-'));
  skillSource = mkdtempSync(join(tmpdir(), 'install-tx-skills-'));
  mkdirSync(join(skillSource, 'mindos'), { recursive: true });
  writeFileSync(join(skillSource, 'mindos', 'SKILL.md'), '---\nname: mindos\n---\nbody\n', 'utf-8');
  sourceRoots = [{ path: skillSource, source: 'builtin', origin: 'project-builtin', editable: false }];
});

afterEach(() => {
  resetAgentConfigReadCacheForTests();
  rmSync(home, { recursive: true, force: true });
  rmSync(skillSource, { recursive: true, force: true });
});

describe('installAgentConnection', () => {
  it('writes the config entry, copies the skill with a managed marker and mutates settings', () => {
    const settingsPath = join(home, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ installed: [] }), 'utf-8');
    const settings = {
      read: () => JSON.parse(readFileSync(settingsPath, 'utf-8')) as { installed: string[] },
      write: (value: { installed: string[] }) => writeFileSync(settingsPath, JSON.stringify(value), 'utf-8'),
      mutate: (value: { installed: string[] }) => ({ installed: [...value.installed, 'test-agent'] }),
    };

    const result = installAgentConnection({
      adapter: adapter(),
      scope: 'global',
      entry,
      skill: { name: 'mindos', sourceRoots, deps: { strategy: 'copy' } },
      settings,
    });

    expect(result).toMatchObject({ ok: true, rolledBack: false, settings: 'written', skill: { status: 'copied' } });
    const configPath = join(home, '.test-agent', 'config.json');
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({ mcpServers: { mindos: entry } });
    const skillPath = join(home, '.test-agent', 'skills', 'mindos');
    expect(existsSync(join(skillPath, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillPath, MINDOS_MANAGED_MARKER))).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath, 'utf-8'))).toEqual({ installed: ['test-agent'] });

    // The installed skill is removable through the same adapter.
    const removal = removeInstalledSkill(adapter(), 'mindos', sourceRoots);
    expect(removal.ok).toBe(true);
    expect(existsSync(skillPath)).toBe(false);
  });

  it('rolls the config file back (deletes it) when the skill step fails', () => {
    const configPath = join(home, '.test-agent', 'config.json');
    expect(existsSync(configPath)).toBe(false);

    const result = installAgentConnection({
      adapter: adapter(),
      scope: 'global',
      entry,
      // A skill name that is not in any source root makes linkSkillToAgent fail.
      skill: { name: 'missing-skill', sourceRoots, deps: { strategy: 'copy' } },
    });

    expect(result).toMatchObject({ ok: false, failedStep: 'skill', rolledBack: true });
    expect(existsSync(configPath)).toBe(false);
  });

  it('restores the previous config text when a later step fails', () => {
    const configPath = join(home, '.test-agent', 'config.json');
    mkdirSync(join(home, '.test-agent'), { recursive: true });
    const before = JSON.stringify({ mcpServers: { existing: { command: 'keep' } } }, null, 2);
    writeFileSync(configPath, before, 'utf-8');

    const result = installAgentConnection({
      adapter: adapter(),
      scope: 'global',
      entry,
      skill: { name: 'missing-skill', sourceRoots, deps: { strategy: 'copy' } },
    });

    expect(result).toMatchObject({ ok: false, failedStep: 'skill', rolledBack: true });
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
  });

  it('rolls config and skill back when the settings step throws', () => {
    const configPath = join(home, '.test-agent', 'config.json');
    const skillPath = join(home, '.test-agent', 'skills', 'mindos');

    const result = installAgentConnection({
      adapter: adapter(),
      scope: 'global',
      entry,
      skill: { name: 'mindos', sourceRoots, deps: { strategy: 'copy' } },
      settings: {
        read: () => { throw new Error('settings store offline'); },
        write: () => {},
        mutate: (value: unknown) => value,
      },
    });

    expect(result).toMatchObject({ ok: false, failedStep: 'settings', rolledBack: true, settings: 'failed' });
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(skillPath)).toBe(false);
  });

  it('reports config failure without any rollback when the scope is unsupported', () => {
    const noScope = createAgentConfigAdapter('codex-like', { ...def, global: '', project: null }, undefined, { homeDir: home });
    const result = installAgentConnection({ adapter: noScope, scope: 'global', entry });
    expect(result).toMatchObject({ ok: false, failedStep: 'config', rolledBack: false });
  });
});
