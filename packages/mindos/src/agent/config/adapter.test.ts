import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentConfigScopeError, createAgentConfigAdapter, mergeAgentConfigDefs } from './adapter.js';
import { resetAgentConfigReadCacheForTests } from './config-read.js';
import { customAgentToConfigDef } from './registry.js';
import type { AgentConfigDef, CustomAgentConfigDef } from './types.js';

const claude: AgentConfigDef = {
  name: 'Claude Code',
  project: '.mcp.json',
  global: '~/.claude.json',
  key: 'mcpServers',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.claude/'],
};

const codex: AgentConfigDef = {
  name: 'Codex',
  project: null,
  global: '~/.codex/config.toml',
  key: 'mcp_servers',
  format: 'toml',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.codex/'],
};

const hermes: AgentConfigDef = {
  name: 'Hermes',
  project: null,
  global: '~/.hermes/config.yaml',
  key: 'mcp_servers',
  format: 'yaml',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.hermes/'],
};

const copaw: AgentConfigDef = {
  name: 'CoPaw',
  project: null,
  global: '~/.copaw/config.json',
  key: 'mcp',
  globalNestedKey: 'mcp.clients',
  preferredTransport: 'stdio',
  presenceDirs: ['~/.copaw/'],
};

let home: string;

function adapter(def: AgentConfigDef, projectRoot?: string) {
  return createAgentConfigAdapter(def.name.toLowerCase(), def, undefined, {
    homeDir: home,
    ...(projectRoot ? { projectRoot } : {}),
  });
}

const mindosEntry = { command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agent-config-adapter-'));
  resetAgentConfigReadCacheForTests();
});

describe('JSON adapter roundtrip', () => {
  it('creates the config, reads the entry back and removes it again', () => {
    const agent = adapter(claude);
    const write = agent.writeServer('mindos', mindosEntry, 'global');
    expect(write).toMatchObject({ existed: false, previousText: null, written: true, warnings: [] });
    expect(JSON.parse(readFileSync(write.absPath, 'utf-8'))).toEqual({ mcpServers: { mindos: mindosEntry } });

    const read = agent.readServer('mindos');
    expect(read).toMatchObject({ entry: mindosEntry, scope: 'global', configPath: '~/.claude.json', transport: 'stdio' });
    expect(agent.listServers()).toEqual({ servers: ['mindos'], sources: ['global:~/.claude.json'] });

    const removal = agent.removeServer('mindos', 'global');
    expect(removal).toMatchObject({ updatedPaths: ['~/.claude.json'], errors: [], existedAnywhere: true });
    expect(agent.readServer('mindos')).toBeNull();
    expect(agent.listServers().servers).toEqual([]);
  });

  it('keeps comments and existing servers when editing a JSONC file in place', () => {
    const configPath = join(home, '.claude.json');
    writeFileSync(configPath, '{\n  // keep me\n  "mcpServers": { "other": { "command": "other" } }\n}\n', 'utf-8');
    const agent = adapter(claude);

    const write = agent.writeServer('mindos', mindosEntry, 'global');
    expect(write.existed).toBe(false);
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toContain('// keep me');
    expect(text).toContain('"other"');
    expect(agent.listServers().servers).toEqual(['mindos', 'other']);
  });

  it('reports an existing entry and honours overwrite:false', () => {
    const agent = adapter(claude);
    agent.writeServer('mindos', mindosEntry, 'global');
    const before = readFileSync(join(home, '.claude.json'), 'utf-8');

    const skip = agent.writeServer('mindos', { url: 'http://127.0.0.1:9/mcp' }, 'global', { overwrite: false });
    expect(skip).toMatchObject({ existed: true, written: false });
    expect(readFileSync(join(home, '.claude.json'), 'utf-8')).toBe(before);

    const replace = agent.writeServer('mindos', { url: 'http://127.0.0.1:9/mcp' }, 'global');
    expect(replace).toMatchObject({ existed: true, written: true, previousText: before });
    const read = agent.readServer('mindos');
    expect(read).toMatchObject({ transport: 'http', url: 'http://127.0.0.1:9/mcp' });
  });

  it('tolerates a BOM-prefixed JSONC file and writes a parsable entry', () => {
    const configPath = join(home, '.claude.json');
    writeFileSync(configPath, '﻿{ "mcpServers": {} }', 'utf-8');
    adapter(claude).writeServer('mindos', mindosEntry, 'global');
    const text = readFileSync(configPath, 'utf-8');
    // JSONC edits strip the BOM; the result must parse to the merged object.
    expect(JSON.parse(text.replace(/^﻿/, ''))).toEqual({ mcpServers: { mindos: mindosEntry } });
    expect(adapter(claude).readServer('mindos')?.entry).toEqual(mindosEntry);
  });

  it('reads a nested CoPaw-style container instead of the top-level key', () => {
    const agent = adapter(copaw);
    agent.writeServer('mindos', mindosEntry, 'global');
    expect(JSON.parse(readFileSync(join(home, '.copaw', 'config.json'), 'utf-8'))).toEqual({
      mcp: { clients: { mindos: mindosEntry } },
    });
    expect(agent.readServer('mindos')?.entry).toEqual(mindosEntry);
    expect(agent.location('global')).toEqual({ format: 'json', sectionKey: 'mcp', nestedPath: 'mcp.clients' });
  });
});

describe('TOML adapter roundtrip', () => {
  it('appends a table, reads it back and strips it on remove', () => {
    const agent = adapter(codex);
    agent.writeServer('mindos', mindosEntry, 'global');
    const text = readFileSync(join(home, '.codex', 'config.toml'), 'utf-8');
    expect(text).toContain('[mcp_servers.mindos]');
    expect(text).toContain('command = "mindos"');

    expect(agent.readServer('mindos')).toMatchObject({ entry: { command: 'mindos' }, scope: 'global', transport: 'stdio' });
    expect(agent.listServers().servers).toEqual(['mindos']);

    agent.removeServer('mindos', 'global');
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf-8')).not.toContain('mindos');
  });

  it('replaces both an inline table and a duplicate table without leaving two definitions', () => {
    const configPath = join(home, '.codex', 'config.toml');
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(configPath, '[mcp_servers]\nmindos = { command = "old" }\n\n[mcp_servers.mindos]\ncommand = "older"\n', 'utf-8');

    adapter(codex).writeServer('mindos', mindosEntry, 'global');
    const text = readFileSync(configPath, 'utf-8');
    expect(text.match(/mindos/g)?.length).toBeGreaterThan(0);
    expect(text).not.toContain('old');
    expect(text).toContain('[mcp_servers.mindos]');
    expect((text.match(/\[mcp_servers\.mindos\]/g) ?? []).length).toBe(1);
  });
});

describe('YAML adapter roundtrip', () => {
  it('merges under the section key, reads back and removes', () => {
    const agent = adapter(hermes);
    agent.writeServer('mindos', mindosEntry, 'global');
    const text = readFileSync(join(home, '.hermes', 'config.yaml'), 'utf-8');
    expect(text).toContain('mcp_servers:');
    expect(text).toContain('mindos:');

    expect(agent.readServer('mindos')?.entry).toMatchObject({ command: 'mindos' });
    expect(agent.listServers().servers).toEqual(['mindos']);

    agent.removeServer('mindos', 'global');
    expect(readFileSync(join(home, '.hermes', 'config.yaml'), 'utf-8')).not.toContain('mindos:');
  });

  it('keeps unrelated YAML content when merging', () => {
    const configPath = join(home, '.hermes', 'config.yaml');
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(configPath, 'model: hermes-4\nmcp_servers:\n  other:\n    command: other\n', 'utf-8');
    adapter(hermes).writeServer('mindos', mindosEntry, 'global');
    const text = readFileSync(configPath, 'utf-8');
    expect(text).toContain('model: hermes-4');
    expect(text).toContain('other:');
    expect(text).toContain('mindos:');
  });
});

describe('project scope', () => {
  it('resolves relative project configs under the project root, never the cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-config-project-'));
    writeFileSync(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { mindos: { command: 'mindos' } } }), 'utf-8');
    const agent = adapter(claude, root);
    expect(agent.readServer('mindos', { scope: 'project' })).toMatchObject({ scope: 'project', configPath: '.mcp.json' });
    expect(agent.needsProjectRoot('project')).toBe(false);
  });

  it('skips project files without a project root and flags needsProjectRoot', () => {
    const agent = adapter(claude);
    expect(agent.readServer('mindos')).toBeNull();
    expect(agent.needsProjectRoot('project')).toBe(true);
  });

  it('throws AgentConfigProjectRootError when writing a relative project path without a root', () => {
    expect(() => adapter(claude).writeServer('mindos', mindosEntry, 'project')).toThrow(/project root/i);
  });

  it('throws AgentConfigScopeError for an agent without the requested scope', () => {
    expect(() => adapter(codex).writeServer('mindos', mindosEntry, 'project')).toThrow(AgentConfigScopeError);
    expect(adapter(codex).hasScope('project')).toBe(false);
    expect(adapter(codex).hasScope('global')).toBe(true);
  });
});

describe('unsafe input', () => {
  it('rejects prototype-polluting server names on read, write and remove', () => {
    const agent = adapter(claude);
    expect(() => agent.readServer('__proto__')).toThrow(/Invalid MCP server name/);
    expect(() => agent.writeServer('__proto__', mindosEntry, 'global')).toThrow(/Invalid MCP server name/);
    expect(() => agent.removeServer('constructor', 'global')).toThrow(/Invalid MCP server name/);
  });

  it('treats a malformed config as not installed but propagates in strict mode', () => {
    writeFileSync(join(home, '.claude.json'), '{ "mcpServers": {', 'utf-8');
    const agent = adapter(claude);
    expect(agent.readServer('mindos')).toBeNull();
    expect(agent.listServers().servers).toEqual([]);
    expect(() => agent.readServer('mindos', { strict: true })).toThrow();
  });

  it('rejects a non-object JSON root in strict mode', () => {
    writeFileSync(join(home, '.claude.json'), '[]', 'utf-8');
    const agent = adapter(claude);
    expect(agent.readServer('mindos')).toBeNull();
    expect(() => agent.readServer('mindos', { strict: true })).toThrow(/object at the document root/);
  });
});

describe('custom agents', () => {
  const custom: CustomAgentConfigDef = {
    name: 'My Agent',
    key: 'my-agent',
    baseDir: '~/.myagent/',
    global: '~/.myagent/config.toml',
    configKey: 'mcp_servers',
    format: 'toml',
    preferredTransport: 'stdio',
    presenceDirs: ['~/.myagent/'],
  };

  it('run through the same adapter interface as built-ins', () => {
    const agent = createAgentConfigAdapter(custom.key, customAgentToConfigDef(custom), undefined, { homeDir: home }, { isCustom: true });
    expect(agent.isCustom).toBe(true);
    expect(agent.isSelf).toBe(false);
    agent.writeServer('mindos', mindosEntry, 'global');
    expect(readFileSync(join(home, '.myagent', 'config.toml'), 'utf-8')).toContain('[mcp_servers.mindos]');
    expect(agent.readServer('mindos')?.entry).toMatchObject({ command: 'mindos' });
  });

  it('are present when any declared directory exists, absent otherwise', () => {
    const agent = createAgentConfigAdapter(custom.key, customAgentToConfigDef(custom), undefined, { homeDir: home }, { isCustom: true });
    expect(agent.detectPresence()).toBe(false);
    mkdirSync(join(home, '.myagent'), { recursive: true });
    expect(agent.detectPresence()).toBe(true);
  });

  it('mergeAgentConfigDefs lets built-ins win on key collision', () => {
    const merged = mergeAgentConfigDefs({ codex }, [{ ...custom, key: 'codex' }, custom]);
    expect(merged.codex).toBe(codex);
    expect(merged['my-agent']).toMatchObject({ name: 'My Agent', format: 'toml' });
  });
});

it('updates an existing JSONC alternative instead of creating a competing primary file', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-jsonc-'));
  const def = { ...claude, global: '~/config.json', globalReadAlso: ['~/config.jsonc'] };
  writeFileSync(join(home, 'config.jsonc'), '{ /* preserved */ "mcpServers": {} }');
  const agent = createAgentConfigAdapter('example', def, undefined, { homeDir: home });
  const result = agent.writeServer('mindos', { command: 'mindos' }, 'global');
  expect(result.configPath).toBe('~/config.jsonc');
  expect(readFileSync(join(home, 'config.jsonc'), 'utf8')).toContain('/* preserved */');
});

it('reads project overrides before global configuration and supports explicit global reads', () => {
  const home = mkdtempSync(join(tmpdir(), 'agent-scope-'));
  writeFileSync(join(home, '.claude.json'), '{"mcpServers":{"mindos":{"command":"global"}}}');
  writeFileSync(join(home, '.mcp.json'), '{"mcpServers":{"mindos":{"command":"project"}}}');
  const agent = createAgentConfigAdapter('claude', claude, undefined, { homeDir: home, projectRoot: home });
  expect(agent.readServer('mindos')?.entry.command).toBe('project');
  expect(agent.readServer('mindos', { scope: 'global' })?.entry.command).toBe('global');
});
