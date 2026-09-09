import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../../foundation/shared/utils/jsonc.js';
import {
  assertSafeMcpServerName,
  assertSafeObjectKey,
  assertSafeObjectKeyPath,
  buildTomlEntry,
  buildYamlEntry,
  detectConfigFormat,
  getNestedPath,
  mergeTomlEntry,
  mergeYamlEntry,
  parseTomlMcpServerEntry,
  parseYamlMcpServerEntry,
  readJsonConfigDocument,
  readMcpServerEntryFromText,
  readOwnRecord,
  removeMcpServerEntryFromFile,
  removeTomlEntry,
  removeYamlEntry,
  writeFileAtomically,
  writeMcpServerEntryToFile,
  type McpServerEntryLocation,
} from './mcp-config-formats.js';

const STDIO_ENTRY = { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } };
const JSON_LOCATION: McpServerEntryLocation = { format: 'json', sectionKey: 'mcpServers' };
const TOML_LOCATION: McpServerEntryLocation = { format: 'toml', sectionKey: 'mcp_servers' };
const YAML_LOCATION: McpServerEntryLocation = { format: 'yaml', sectionKey: 'mcp_servers' };

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `mindos-config-formats-${prefix}-`));
}

function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => /\.tmp-\d+$/.test(name));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('detectConfigFormat', () => {
  it('selects the TOML and YAML walkers only for those explicit formats', () => {
    expect(detectConfigFormat('toml')).toBe('toml');
    expect(detectConfigFormat('yaml')).toBe('yaml');
  });

  it('falls back to JSON for a missing, empty or unknown format', () => {
    expect(detectConfigFormat(undefined)).toBe('json');
    expect(detectConfigFormat('json')).toBe('json');
    expect(detectConfigFormat('')).toBe('json');
    expect(detectConfigFormat('xml')).toBe('json');
  });
});

describe('writeFileAtomically', () => {
  it('writes the content and leaves no temp file behind', () => {
    const dir = tempDir('atomic');
    const target = join(dir, 'config.json');
    writeFileAtomically(target, '{"a":1}\n');
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
    expect(leftovers(dir)).toEqual([]);
  });

  it('replaces existing content in one step', () => {
    const dir = tempDir('atomic');
    const target = join(dir, 'config.json');
    writeFileSync(target, 'old');
    writeFileAtomically(target, 'new');
    expect(readFileSync(target, 'utf-8')).toBe('new');
    expect(leftovers(dir)).toEqual([]);
  });

  it('throws and leaves nothing behind when the directory does not exist', () => {
    const dir = tempDir('atomic');
    expect(() => writeFileAtomically(join(dir, 'missing', 'config.json'), 'x')).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('key safety guards', () => {
  it('accepts ordinary, spaced and unicode server names', () => {
    expect(() => assertSafeMcpServerName('mindos')).not.toThrow();
    expect(() => assertSafeMcpServerName('my server')).not.toThrow();
    expect(() => assertSafeMcpServerName('服务器')).not.toThrow();
  });

  it('rejects blank, control-character and prototype-polluting server names', () => {
    for (const name of ['', '   ', 'a\nb', 'a\rb', 'a\0b', '__proto__', 'constructor', 'prototype']) {
      expect(() => assertSafeMcpServerName(name), JSON.stringify(name)).toThrow('Invalid MCP server name');
    }
  });

  it('splits and trims a dot path but refuses empty or polluting segments', () => {
    expect(assertSafeObjectKeyPath('mcp.clients', 'nested config path')).toEqual(['mcp', 'clients']);
    expect(assertSafeObjectKeyPath(' mcp . clients ', 'nested config path')).toEqual(['mcp', 'clients']);
    expect(() => assertSafeObjectKeyPath('', 'nested config path')).toThrow('Invalid nested config path');
    expect(() => assertSafeObjectKeyPath('..', 'nested config path')).toThrow('Invalid nested config path');
    expect(() => assertSafeObjectKeyPath('mcp.__proto__', 'nested config path')).toThrow('Invalid nested config path');
    expect(() => assertSafeObjectKey('', 'agent config key')).toThrow('Invalid agent config key');
    expect(() => assertSafeObjectKey('constructor', 'agent config key')).toThrow('Invalid agent config key');
  });

  it('reads own object properties only and never walks the prototype', () => {
    expect(readOwnRecord({ a: { b: 1 } }, 'a')).toEqual({ b: 1 });
    expect(readOwnRecord({ a: 'scalar' }, 'a')).toBeNull();
    expect(readOwnRecord({}, 'constructor')).toBeNull();
    expect(getNestedPath({ mcp: { clients: { x: 1 } } }, 'mcp.clients')).toEqual({ x: 1 });
    expect(getNestedPath({ mcp: {} }, 'mcp.clients')).toBeNull();
    expect(getNestedPath({ mcp: { clients: 'scalar' } }, 'mcp.clients')).toBeNull();
    expect(getNestedPath({}, 'toString')).toBeNull();
  });
});

describe('TOML (Codex config.toml)', () => {
  const EXISTING = [
    '# Codex settings',
    'model = "o3"',
    '',
    '[mcp_servers.other]',
    'command = "other"',
    '',
    '[mcp_servers.mindos]',
    'command = "old"',
    '',
    '[mcp_servers.mindos.env]',
    'OLD = "1"',
    '',
    '[projects."/tmp/x"]',
    'trust_level = "trusted"',
    '',
  ].join('\n');

  it('builds a server table with an env sub-table', () => {
    expect(buildTomlEntry('mcp_servers', 'mindos', STDIO_ENTRY)).toBe([
      '[mcp_servers.mindos]',
      'type = "stdio"',
      'command = "mindos"',
      'args = ["mcp"]',
      '',
      '[mcp_servers.mindos.env]',
      'MCP_TRANSPORT = "stdio"',
    ].join('\n'));
  });

  it('replaces the existing server tables and keeps everything else', () => {
    const merged = mergeTomlEntry(EXISTING, 'mcp_servers', 'mindos', STDIO_ENTRY);
    expect(merged).toContain('# Codex settings');
    expect(merged).toContain('model = "o3"');
    expect(merged).toContain('[projects."/tmp/x"]');
    expect(merged).not.toContain('OLD = "1"');
    expect(merged).not.toContain('command = "old"');
    expect(countOccurrences(merged, '[mcp_servers.mindos]')).toBe(1);
    expect(merged.endsWith('\n')).toBe(true);
    expect(parseTomlMcpServerEntry(merged, 'mcp_servers', 'mindos')).toEqual(STDIO_ENTRY);
    expect(parseTomlMcpServerEntry(merged, 'mcp_servers', 'other')).toEqual({ command: 'other' });
  });

  it('removes the server tables including sub-tables and collapses blank lines', () => {
    const removed = removeTomlEntry(EXISTING, 'mcp_servers', 'mindos');
    expect(removed).not.toContain('[mcp_servers.mindos');
    expect(removed).not.toContain('OLD = "1"');
    expect(removed).toContain('[mcp_servers.other]');
    expect(removed).toContain('[projects."/tmp/x"]');
    expect(removed).not.toContain('\n\n\n');
    expect(parseTomlMcpServerEntry(removed, 'mcp_servers', 'mindos')).toBeNull();
  });

  it('starts a table from an empty file', () => {
    const merged = mergeTomlEntry('', 'mcp_servers', 'mindos', { command: 'mindos' });
    expect(merged.trim()).toBe('[mcp_servers.mindos]\ncommand = "mindos"');
    expect(merged.endsWith('\n')).toBe(true);
  });

  it('tolerates a UTF-8 BOM in front of the first table header', () => {
    const bom = '﻿[mcp_servers.other]\ncommand = "other"\n';
    expect(parseTomlMcpServerEntry(bom, 'mcp_servers', 'other')).toEqual({ command: 'other' });
    const merged = mergeTomlEntry(bom, 'mcp_servers', 'mindos', { command: 'mindos' });
    expect(parseTomlMcpServerEntry(merged, 'mcp_servers', 'other')).toEqual({ command: 'other' });
    expect(parseTomlMcpServerEntry(merged, 'mcp_servers', 'mindos')).toEqual({ command: 'mindos' });
    expect(removeTomlEntry(bom, 'mcp_servers', 'other')).not.toContain('command = "other"');
  });

  it('quotes server names that are not bare keys and still recognises the legacy unquoted header', () => {
    const merged = mergeTomlEntry('', 'mcp_servers', 'my.server', { command: 'x' });
    expect(merged).toContain('[mcp_servers."my.server"]');
    expect(parseTomlMcpServerEntry(merged, 'mcp_servers', 'my.server')).toEqual({ command: 'x' });
    const legacy = '[mcp_servers.my.server]\ncommand = "x"\n\n[mcp_servers.my.server.env]\nA = "1"\n';
    expect(parseTomlMcpServerEntry(legacy, 'mcp_servers', 'my.server')).toEqual({ command: 'x', env: { A: '1' } });
    expect(removeTomlEntry(legacy, 'mcp_servers', 'my.server')).not.toContain('command');
  });

  it('parses nested env and headers tables and typed scalars', () => {
    const text = [
      '[mcp_servers.remote]',
      'url = "http://127.0.0.1:8781/mcp"',
      'enabled = true',
      'timeout = 30',
      "args = ['a', 'b']",
      '',
      '[mcp_servers.remote.headers]',
      'Authorization = "Bearer abc"',
      '',
      '[mcp_servers.remote.env]',
      'A = "1"',
      '',
      '[mcp_servers.other]',
      'command = "other"',
    ].join('\n');
    expect(parseTomlMcpServerEntry(text, 'mcp_servers', 'remote')).toEqual({
      url: 'http://127.0.0.1:8781/mcp',
      enabled: true,
      timeout: 30,
      args: ['a', 'b'],
      headers: { Authorization: 'Bearer abc' },
      env: { A: '1' },
    });
  });

  it('parses an inline table under the bare [mcp_servers] section', () => {
    const text = '[mcp_servers]\nmindos = { command = "mindos", args = ["mcp"], enabled = true }\n';
    expect(parseTomlMcpServerEntry(text, 'mcp_servers', 'mindos')).toEqual({
      command: 'mindos',
      args: ['mcp'],
      enabled: true,
    });
    expect(parseTomlMcpServerEntry(text, 'mcp_servers', 'other')).toBeNull();
  });

  it('returns null for malformed TOML instead of throwing, and merge still appends a valid table', () => {
    const malformed = 'this is = not [ toml\n[mcp_servers.mindos\ncommand = "x"\n';
    expect(parseTomlMcpServerEntry(malformed, 'mcp_servers', 'mindos')).toBeNull();
    const merged = mergeTomlEntry(malformed, 'mcp_servers', 'mindos', { command: 'mindos' });
    expect(parseTomlMcpServerEntry(merged, 'mcp_servers', 'mindos')).toEqual({ command: 'mindos' });
    expect(removeTomlEntry('garbage ===\n', 'mcp_servers', 'mindos')).toBe('garbage ===\n');
  });

  it('degrades an unterminated array value to its raw text', () => {
    const text = '[mcp_servers.mindos]\nargs = [unclosed\n';
    expect(parseTomlMcpServerEntry(text, 'mcp_servers', 'mindos')).toEqual({ args: '[unclosed' });
  });
});

describe('YAML (Hermes config.yaml)', () => {
  const EXISTING = [
    '# Hermes config',
    'model: gpt',
    '',
    'mcp_servers:',
    '  # keep me',
    '  other:',
    '    command: "other"',
    '  mindos:',
    '    command: "old"',
    '    env:',
    '      OLD: "1"',
    '',
    'tools:',
    '  - web',
    '',
  ].join('\n');

  it('builds an indented mapping block with an env sub-mapping', () => {
    expect(buildYamlEntry('mindos', STDIO_ENTRY)).toBe([
      '  mindos:',
      '    type: "stdio"',
      '    command: "mindos"',
      '    args: ["mcp"]',
      '    env:',
      '      MCP_TRANSPORT: "stdio"',
    ].join('\n'));
  });

  it('replaces the server block inside the section and keeps siblings, comments and later keys', () => {
    const merged = mergeYamlEntry(EXISTING, 'mcp_servers', 'mindos', STDIO_ENTRY);
    expect(merged).toContain('# Hermes config');
    expect(merged).toContain('model: gpt');
    expect(merged).toContain('  # keep me');
    expect(merged).not.toContain('OLD: "1"');
    expect(merged).not.toContain('command: "old"');
    expect(countOccurrences(merged, '  mindos:')).toBe(1);
    expect(merged.indexOf('  mindos:')).toBeLessThan(merged.indexOf('tools:'));
    expect(merged.endsWith('\n')).toBe(true);
    expect(parseYamlMcpServerEntry(merged, 'mcp_servers', 'mindos')).toEqual(STDIO_ENTRY);
    expect(parseYamlMcpServerEntry(merged, 'mcp_servers', 'other')).toEqual({ command: 'other' });
  });

  it('removes the server block and its nested mapping, collapsing blank lines', () => {
    const removed = removeYamlEntry(EXISTING, 'mcp_servers', 'mindos');
    expect(removed).not.toContain('  mindos:');
    expect(removed).not.toContain('OLD: "1"');
    expect(removed).toContain('  other:');
    expect(removed).toContain('tools:');
    expect(removed).not.toContain('\n\n\n');
    expect(parseYamlMcpServerEntry(removed, 'mcp_servers', 'mindos')).toBeNull();
  });

  it('creates the section from an empty file', () => {
    expect(mergeYamlEntry('', 'mcp_servers', 'mindos', { command: 'mindos' })).toBe(
      'mcp_servers:\n  mindos:\n    command: "mindos"\n',
    );
  });

  it('appends a new section when the file has other keys but no servers section', () => {
    const merged = mergeYamlEntry('model: gpt\n', 'mcp_servers', 'mindos', { command: 'mindos' });
    expect(merged).toBe('model: gpt\n\nmcp_servers:\n  mindos:\n    command: "mindos"\n');
  });

  it('parses nested env and headers mappings, quoted keys and typed scalars', () => {
    const text = [
      'mcp_servers:',
      '  remote:',
      '    url: "http://127.0.0.1:8781/mcp"',
      '    enabled: true',
      '    timeout: 30',
      "    args: ['a', 'b']",
      '    headers:',
      '      Authorization: "Bearer abc"',
      '    env:',
      '      "MY.VAR": "1"',
      '  other:',
      '    command: "other"',
      'tools:',
      '  - web',
    ].join('\n');
    expect(parseYamlMcpServerEntry(text, 'mcp_servers', 'remote')).toEqual({
      url: 'http://127.0.0.1:8781/mcp',
      enabled: true,
      timeout: 30,
      args: ['a', 'b'],
      headers: { Authorization: 'Bearer abc' },
      env: { 'MY.VAR': '1' },
    });
    expect(parseYamlMcpServerEntry(text, 'mcp_servers', 'other')).toEqual({ command: 'other' });
  });

  // The walkers compute indentation as `line.length - line.trimStart().length`,
  // and `trimStart()` strips U+FEFF, so a BOM counts as one column and the
  // first-line `mcp_servers:` header is not recognised. Pre-existing quirk kept
  // as-is by the pure refactor; tracked in wiki/85-backlog.md.
  it.fails('recognises the servers section when the file starts with a UTF-8 BOM (known quirk)', () => {
    const bom = '﻿mcp_servers:\n  other:\n    command: "other"\n';
    expect(parseYamlMcpServerEntry(bom, 'mcp_servers', 'other')).toEqual({ command: 'other' });
  });

  it('returns null for malformed YAML instead of throwing, and merge still appends a valid section', () => {
    expect(parseYamlMcpServerEntry('{{ not: yaml', 'mcp_servers', 'mindos')).toBeNull();
    expect(parseYamlMcpServerEntry('mcp_servers: none\n', 'mcp_servers', 'mindos')).toBeNull();
    const merged = mergeYamlEntry('{{ not: yaml\n', 'mcp_servers', 'mindos', { command: 'mindos' });
    expect(parseYamlMcpServerEntry(merged, 'mcp_servers', 'mindos')).toEqual({ command: 'mindos' });
    expect(removeYamlEntry('model: gpt\n', 'mcp_servers', 'mindos')).toBe('model: gpt\n');
  });
});

describe('JSON / JSONC via the format dispatch', () => {
  it('adds a server next to existing ones, reads it back and removes it again', () => {
    const dir = tempDir('json');
    const file = join(dir, 'config.json');
    const original = JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'other' } } }, null, 2);
    writeFileSync(file, original);

    expect(writeMcpServerEntryToFile(file, original, JSON_LOCATION, 'mindos', STDIO_ENTRY)).toEqual([]);
    const written = readFileSync(file, 'utf-8');
    expect(parseJsonc(written)).toEqual({ theme: 'dark', mcpServers: { other: { command: 'other' }, mindos: STDIO_ENTRY } });
    expect(readMcpServerEntryFromText(written, JSON_LOCATION, 'mindos')).toEqual(STDIO_ENTRY);
    expect(readMcpServerEntryFromText(written, JSON_LOCATION, 'missing')).toBeNull();

    expect(removeMcpServerEntryFromFile(file, written, JSON_LOCATION, 'mindos')).toEqual([]);
    expect(parseJsonc(readFileSync(file, 'utf-8'))).toEqual({ theme: 'dark', mcpServers: { other: { command: 'other' } } });
    expect(leftovers(dir)).toEqual([]);
  });

  it('keeps comments when editing a BOM-prefixed JSONC file in place', () => {
    const dir = tempDir('jsonc-bom');
    const file = join(dir, 'settings.json');
    const original = '﻿{\n  // servers\n  "mcpServers": { /* keep */ }\n}\n';
    writeFileSync(file, original);

    expect(writeMcpServerEntryToFile(file, original, JSON_LOCATION, 'mindos', { command: 'mindos' })).toEqual([]);
    const written = readFileSync(file, 'utf-8');
    expect(written).toContain('// servers');
    expect(written).toContain('/* keep */');
    expect(parseJsonc(written)).toEqual({ mcpServers: { mindos: { command: 'mindos' } } });
    expect(readMcpServerEntryFromText(original, JSON_LOCATION, 'mindos')).toBeNull();
  });

  it('treats an empty or comment-only file as an empty config', () => {
    const dir = tempDir('jsonc-empty');
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, '');
    expect(writeMcpServerEntryToFile(empty, '', JSON_LOCATION, 'mindos', { command: 'mindos' })).toEqual([]);
    expect(readFileSync(empty, 'utf-8')).toBe('{\n  "mcpServers": {\n    "mindos": {\n      "command": "mindos"\n    }\n  }\n}\n');

    const commentOnly = join(dir, 'comment.jsonc');
    writeFileSync(commentOnly, '// nothing here yet\n');
    expect(writeMcpServerEntryToFile(commentOnly, '// nothing here yet\n', JSON_LOCATION, 'mindos', { command: 'mindos' })).toEqual([]);
    const written = readFileSync(commentOnly, 'utf-8');
    expect(written).toContain('// nothing here yet');
    expect(parseJsonc(written)).toEqual({ mcpServers: { mindos: { command: 'mindos' } } });
  });

  it('creates the nested container for a dotted nestedPath (CoPaw mcp.clients)', () => {
    const dir = tempDir('jsonc-nested');
    const file = join(dir, 'config.json');
    writeFileSync(file, '{}\n');
    const location: McpServerEntryLocation = { format: 'json', sectionKey: 'mcpServers', nestedPath: 'mcp.clients' };

    expect(writeMcpServerEntryToFile(file, '{}\n', location, 'mindos', { command: 'mindos' })).toEqual([]);
    const written = readFileSync(file, 'utf-8');
    expect(parseJsonc(written)).toEqual({ mcp: { clients: { mindos: { command: 'mindos' } } } });
    expect(readMcpServerEntryFromText(written, location, 'mindos')).toEqual({ command: 'mindos' });
    expect(readMcpServerEntryFromText(written, JSON_LOCATION, 'mindos')).toBeNull();

    expect(removeMcpServerEntryFromFile(file, written, location, 'mindos')).toEqual([]);
    expect(parseJsonc(readFileSync(file, 'utf-8'))).toEqual({ mcp: { clients: {} } });
  });

  it('refuses prototype-polluting section keys and nested paths without touching the file', () => {
    const dir = tempDir('jsonc-proto');
    const file = join(dir, 'config.json');
    writeFileSync(file, '{}\n');
    expect(() => writeMcpServerEntryToFile(file, '{}\n', { format: 'json', sectionKey: '__proto__' }, 'mindos', {}))
      .toThrow('Invalid agent config key');
    expect(() => writeMcpServerEntryToFile(file, '{}\n', { format: 'json', sectionKey: 'x', nestedPath: 'mcp.__proto__' }, 'mindos', {}))
      .toThrow('Invalid nested config path');
    expect(() => writeMcpServerEntryToFile(file, '{}\n', JSON_LOCATION, '__proto__', {})).toThrow('Invalid MCP server name');
    expect(readFileSync(file, 'utf-8')).toBe('{}\n');
  });

  it('reads own properties only, returning a detached copy', () => {
    const text = '{"mcpServers":{"a":{"command":"x","env":{"K":"V"}}}}';
    const entry = readMcpServerEntryFromText(text, JSON_LOCATION, 'a');
    expect(entry).toEqual({ command: 'x', env: { K: 'V' } });
    expect(readMcpServerEntryFromText(text, JSON_LOCATION, 'toString')).toBeNull();
    expect(readMcpServerEntryFromText('{"other":{}}', JSON_LOCATION, 'a')).toBeNull();
  });

  it('edits a file with recoverable syntax issues in place and reports a warning', () => {
    const dir = tempDir('jsonc-warn');
    const file = join(dir, 'config.json');
    const broken = '{ "mcpServers": { "other": {} }';
    writeFileSync(file, broken);

    const warnings = writeMcpServerEntryToFile(file, broken, JSON_LOCATION, 'mindos', { command: 'mindos' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(file);
    expect(warnings[0]).toContain('JSONC syntax issues');
    expect(warnings[0]).toContain('CloseBraceExpected');
    expect(readFileSync(file, 'utf-8')).toContain('"mindos"');

    const document = readJsonConfigDocument(file, broken);
    expect(document.value).toEqual({ mcpServers: { other: {} } });
    expect(document.warnings).toHaveLength(1);
  });

  it('throws for a non-object root or unparsable garbage and leaves the file untouched', () => {
    const dir = tempDir('jsonc-error');
    const file = join(dir, 'config.json');
    writeFileSync(file, '[1,2]');
    expect(() => writeMcpServerEntryToFile(file, '[1,2]', JSON_LOCATION, 'mindos', {})).toThrow(/object/);
    expect(() => removeMcpServerEntryFromFile(file, '[1,2]', JSON_LOCATION, 'mindos')).toThrow(/object/);
    expect(readFileSync(file, 'utf-8')).toBe('[1,2]');

    writeFileSync(file, '}}} not json');
    expect(() => writeMcpServerEntryToFile(file, '}}} not json', JSON_LOCATION, 'mindos', {})).toThrow(SyntaxError);
    expect(() => readMcpServerEntryFromText('}}} not json', JSON_LOCATION, 'mindos')).toThrow(SyntaxError);
    expect(readFileSync(file, 'utf-8')).toBe('}}} not json');
    expect(leftovers(dir)).toEqual([]);
  });

  it('does not rewrite the file when removing a server that is not configured', () => {
    const dir = tempDir('jsonc-noop');
    const file = join(dir, 'config.json');
    const original = '{\n  // untouched\n  "mcpServers": { "other": {} }\n}\n';
    writeFileSync(file, original);
    expect(removeMcpServerEntryFromFile(file, original, JSON_LOCATION, 'mindos')).toEqual([]);
    expect(readFileSync(file, 'utf-8')).toBe(original);
  });
});

describe('TOML and YAML via the format dispatch', () => {
  it('writes TOML atomically, reads it back and removes it, reporting no warnings', () => {
    const dir = tempDir('toml-dispatch');
    const file = join(dir, 'config.toml');
    const original = '[mcp_servers.other]\ncommand = "other"\n';
    writeFileSync(file, original);

    expect(writeMcpServerEntryToFile(file, original, TOML_LOCATION, 'mindos', STDIO_ENTRY)).toEqual([]);
    const written = readFileSync(file, 'utf-8');
    expect(readMcpServerEntryFromText(written, TOML_LOCATION, 'mindos')).toEqual(STDIO_ENTRY);
    expect(readMcpServerEntryFromText(written, TOML_LOCATION, 'other')).toEqual({ command: 'other' });

    expect(removeMcpServerEntryFromFile(file, written, TOML_LOCATION, 'mindos')).toEqual([]);
    const removed = readFileSync(file, 'utf-8');
    expect(readMcpServerEntryFromText(removed, TOML_LOCATION, 'mindos')).toBeNull();
    expect(readMcpServerEntryFromText(removed, TOML_LOCATION, 'other')).toEqual({ command: 'other' });
    expect(leftovers(dir)).toEqual([]);
  });

  it('writes YAML atomically, reads it back and removes it, reporting no warnings', () => {
    const dir = tempDir('yaml-dispatch');
    const file = join(dir, 'config.yaml');
    const original = 'mcp_servers:\n  other:\n    command: "other"\n';
    writeFileSync(file, original);

    expect(writeMcpServerEntryToFile(file, original, YAML_LOCATION, 'mindos', STDIO_ENTRY)).toEqual([]);
    const written = readFileSync(file, 'utf-8');
    expect(readMcpServerEntryFromText(written, YAML_LOCATION, 'mindos')).toEqual(STDIO_ENTRY);
    expect(readMcpServerEntryFromText(written, YAML_LOCATION, 'other')).toEqual({ command: 'other' });

    expect(removeMcpServerEntryFromFile(file, written, YAML_LOCATION, 'mindos')).toEqual([]);
    const removed = readFileSync(file, 'utf-8');
    expect(readMcpServerEntryFromText(removed, YAML_LOCATION, 'mindos')).toBeNull();
    expect(readMcpServerEntryFromText(removed, YAML_LOCATION, 'other')).toEqual({ command: 'other' });
    expect(leftovers(dir)).toEqual([]);
  });

  it('rejects unsafe server names before touching TOML or YAML files', () => {
    const dir = tempDir('dispatch-unsafe');
    const file = join(dir, 'config.toml');
    writeFileSync(file, '');
    expect(() => writeMcpServerEntryToFile(file, '', TOML_LOCATION, 'bad\nname', {})).toThrow('Invalid MCP server name');
    expect(() => removeMcpServerEntryFromFile(file, '', YAML_LOCATION, '__proto__')).toThrow('Invalid MCP server name');
    expect(() => readMcpServerEntryFromText('', YAML_LOCATION, '')).toThrow('Invalid MCP server name');
    expect(readFileSync(file, 'utf-8')).toBe('');
  });
});
