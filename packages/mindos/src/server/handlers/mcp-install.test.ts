import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  handleMcpInstallPost,
  handleMcpServerCopyPost,
  handleMcpUninstallPost,
  hasJsoncComments,
  writeFileAtomically,
  type MindosMcpAgentDef,
} from './mcp-install.js';

const agents: Record<string, MindosMcpAgentDef> = {
  'claude-code': {
    name: 'Claude Code',
    project: '.mcp.json',
    global: '~/.claude.json',
    key: 'mcpServers',
    preferredTransport: 'stdio',
  },
  'kilo-code': {
    name: 'Kilo Code',
    project: null,
    global: '~/.config/kilo/kilo.jsonc',
    key: 'mcp',
    preferredTransport: 'stdio',
    entryStyle: 'kilo',
  },
  codex: {
    name: 'Codex',
    project: null,
    global: '~/.codex/config.toml',
    key: 'mcp_servers',
    format: 'toml',
    preferredTransport: 'stdio',
  },
  hermes: {
    name: 'Hermes',
    project: null,
    global: '~/.hermes/config.yaml',
    key: 'mcp_servers',
    format: 'yaml',
    preferredTransport: 'stdio',
  },
};

function leftovers(dir: string): string[] {
  return readdirSync(dir).filter((name) => /\.tmp-\d+$/.test(name));
}

const COMMENTED_JSONC = `{
  // Kilo user settings
  "theme": "dark", /* keep */
  "mcp": {
    "other": { "type": "remote", "url": "https://example.com/mcp" } // trailing
  }
}
`;

describe('hasJsoncComments', () => {
  it('detects line and block comments outside strings', () => {
    expect(hasJsoncComments('{\n  // note\n  "a": 1\n}')).toBe(true);
    expect(hasJsoncComments('{ "a": 1 /* note */ }')).toBe(true);
    expect(hasJsoncComments('/* header */\n{}')).toBe(true);
  });

  it('ignores comment-looking sequences inside strings and escaped quotes', () => {
    expect(hasJsoncComments('{ "url": "https://example.com/mcp" }')).toBe(false);
    expect(hasJsoncComments('{ "glob": "src/**/*.ts" }')).toBe(false);
    expect(hasJsoncComments('{ "quote": "say \\"//\\" here" }')).toBe(false);
    expect(hasJsoncComments('')).toBe(false);
    expect(hasJsoncComments('{}')).toBe(false);
  });
});

describe('writeFileAtomically', () => {
  it('writes the content and leaves no temp file behind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindos-atomic-'));
    const target = join(dir, 'config.json');
    writeFileAtomically(target, '{"a":1}\n');
    expect(readFileSync(target, 'utf-8')).toBe('{"a":1}\n');
    expect(leftovers(dir)).toEqual([]);
  });

  it('replaces existing content in one step', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindos-atomic-'));
    const target = join(dir, 'config.json');
    writeFileSync(target, 'old');
    writeFileAtomically(target, 'new');
    expect(readFileSync(target, 'utf-8')).toBe('new');
    expect(leftovers(dir)).toEqual([]);
  });

  it('throws and leaves nothing behind when the directory does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mindos-atomic-'));
    expect(() => writeFileAtomically(join(dir, 'missing', 'config.json'), 'x')).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('MCP install writes third-party agent configs atomically', () => {
  it('round-trips JSON, TOML and YAML configs without leaving .tmp-* files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-home-'));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'other' } }, theme: 'dark' }, null, 2));

    const res = await handleMcpInstallPost({
      agents: [
        { key: 'claude-code', scope: 'global' },
        { key: 'codex', scope: 'global' },
        { key: 'hermes', scope: 'global' },
      ],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.status).toBe(200);
    const results = (res.body as { results: Array<Record<string, unknown>> }).results;
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(results.every((r) => r.warnings === undefined)).toBe(true);

    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf-8'));
    expect(claude.theme).toBe('dark');
    expect(claude.mcpServers.other).toEqual({ command: 'other' });
    expect(claude.mcpServers.mindos).toMatchObject({ type: 'stdio', command: 'mindos' });
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf-8')).toContain('[mcp_servers.mindos]');
    expect(readFileSync(join(home, '.hermes', 'config.yaml'), 'utf-8')).toMatch(/^\s{2}mindos:/m);

    expect(leftovers(home)).toEqual([]);
    expect(leftovers(join(home, '.codex'))).toEqual([]);
    expect(leftovers(join(home, '.hermes'))).toEqual([]);
    expect(existsSync(join(home, '.claude.json.bak'))).toBe(false);
  });

  it('backs up a commented JSONC file to .bak and reports a warning', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-jsonc-'));
    const kiloDir = join(home, '.config', 'kilo');
    mkdirSync(kiloDir, { recursive: true });
    const kiloPath = join(kiloDir, 'kilo.jsonc');
    writeFileSync(kiloPath, COMMENTED_JSONC);

    const res = await handleMcpInstallPost({
      agents: [{ key: 'kilo-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.body).toMatchObject({
      results: [{
        agent: 'kilo-code',
        status: 'ok',
        warnings: [expect.stringMatching(/comments were removed from .*kilo\.jsonc; .*kilo\.jsonc\.bak/i)],
      }],
    });
    expect(readFileSync(`${kiloPath}.bak`, 'utf-8')).toBe(COMMENTED_JSONC);
    const rewritten = JSON.parse(readFileSync(kiloPath, 'utf-8'));
    expect(rewritten.theme).toBe('dark');
    expect(rewritten.mcp.other).toEqual({ type: 'remote', url: 'https://example.com/mcp' });
    expect(rewritten.mcp.mindos).toMatchObject({ type: 'local', command: ['mindos', 'mcp'] });
    expect(leftovers(kiloDir)).toEqual([]);
  });

  it('does not create a .bak for plain JSON that merely contains URLs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-plain-'));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { other: { url: 'https://example.com/mcp' } } }));

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect((res.body as { results: Array<{ warnings?: string[] }> }).results[0]?.warnings).toBeUndefined();
    expect(existsSync(join(home, '.claude.json.bak'))).toBe(false);
  });

  it('backs up commented JSONC on uninstall and on server copy as well', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-uninstall-'));
    const claudePath = join(home, '.claude.json');
    writeFileSync(claudePath, `{\n  // my servers\n  "mcpServers": { "mindos": { "command": "mindos" }, "other": { "command": "other" } }\n}\n`);

    const uninstall = handleMcpUninstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
    }, { agents, homeDir: home });
    expect(uninstall.body).toMatchObject({
      results: [{ agent: 'claude-code', status: 'ok', warnings: [expect.stringContaining('.claude.json.bak')] }],
    });
    expect(readFileSync(`${claudePath}.bak`, 'utf-8')).toContain('// my servers');
    expect(JSON.parse(readFileSync(claudePath, 'utf-8')).mcpServers).toEqual({ other: { command: 'other' } });
    expect(leftovers(home)).toEqual([]);

    const kiloDir = join(home, '.config', 'kilo');
    mkdirSync(kiloDir, { recursive: true });
    writeFileSync(join(kiloDir, 'kilo.jsonc'), `{ /* kilo */ "mcp": {} }\n`);
    const copy = await handleMcpServerCopyPost({
      serverName: 'other',
      sourceAgentKey: 'claude-code',
      sourceScope: 'global',
      targets: [{ key: 'kilo-code', scope: 'global' }],
    }, { agents, homeDir: home });
    expect(copy.body).toMatchObject({
      results: [{ agent: 'kilo-code', status: 'ok', warnings: [expect.stringContaining('kilo.jsonc.bak')] }],
    });
    expect(readFileSync(join(kiloDir, 'kilo.jsonc.bak'), 'utf-8')).toBe(`{ /* kilo */ "mcp": {} }\n`);
    expect(JSON.parse(readFileSync(join(kiloDir, 'kilo.jsonc'), 'utf-8')).mcp.other).toEqual({ command: 'other' });
    expect(leftovers(kiloDir)).toEqual([]);
  });
});
