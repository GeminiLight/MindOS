import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJsonc, parseJsoncDocument } from '../../foundation/shared/utils/jsonc.js';
import {
  handleMcpInstallPost,
  handleMcpServerCopyPost,
  handleMcpUninstallPost,
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
  copaw: {
    name: 'CoPaw',
    project: null,
    global: '~/.copaw/config.json',
    key: 'mcpServers',
    globalNestedKey: 'mcp.clients',
    preferredTransport: 'stdio',
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

function backups(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.endsWith('.bak'));
}

const COMMENTED_JSONC = `{
  // Kilo user settings
  "theme": "dark", /* keep */
  "mcp": {
    "other": { "type": "remote", "url": "https://example.com/mcp" } // trailing
  }
}
`;

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
    expect(backups(home)).toEqual([]);
  });

  it('creates a fresh JSON document when the config file does not exist yet', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-fresh-'));

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }, { key: 'copaw', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    const results = (res.body as { results: Array<Record<string, unknown>> }).results;
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
    const claude = readFileSync(join(home, '.claude.json'), 'utf-8');
    expect(claude.endsWith('\n')).toBe(true);
    expect(parseJsonc(claude)).toEqual({
      mcpServers: { mindos: { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } } },
    });
    // globalNestedKey agents get their nested container created on the way down
    expect(parseJsonc(readFileSync(join(home, '.copaw', 'config.json'), 'utf-8'))).toEqual({
      mcp: { clients: { mindos: { type: 'stdio', command: 'mindos', args: ['mcp'], env: { MCP_TRANSPORT: 'stdio' } } } },
    });
    expect(leftovers(home)).toEqual([]);
  });

  it('edits a commented JSONC file in place and keeps comments and formatting', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-jsonc-'));
    const kiloDir = join(home, '.config', 'kilo');
    mkdirSync(kiloDir, { recursive: true });
    const kiloPath = join(kiloDir, 'kilo.jsonc');
    writeFileSync(kiloPath, COMMENTED_JSONC);

    const res = await handleMcpInstallPost({
      agents: [{ key: 'kilo-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.body).toEqual({
      results: [{ agent: 'kilo-code', status: 'ok', path: '~/.config/kilo/kilo.jsonc', transport: 'stdio' }],
    });
    expect(backups(kiloDir)).toEqual([]);

    const rewritten = readFileSync(kiloPath, 'utf-8');
    expect(rewritten).toContain('// Kilo user settings');
    expect(rewritten).toContain('/* keep */');
    expect(rewritten).toContain('// trailing');
    expect(rewritten.endsWith('\n')).toBe(true);
    expect(parseJsonc(rewritten)).toEqual({
      theme: 'dark',
      mcp: {
        other: { type: 'remote', url: 'https://example.com/mcp' },
        mindos: { type: 'local', command: ['mindos', 'mcp'], environment: { MCP_TRANSPORT: 'stdio' }, enabled: true },
      },
    });
    expect(leftovers(kiloDir)).toEqual([]);
  });

  it('reports no warnings for plain JSON that merely contains URLs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-plain-'));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { other: { url: 'https://example.com/mcp' } } }));

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect((res.body as { results: Array<{ warnings?: string[] }> }).results[0]?.warnings).toBeUndefined();
    expect(backups(home)).toEqual([]);
  });

  it('keeps comments on uninstall and on server copy as well', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-uninstall-'));
    const claudePath = join(home, '.claude.json');
    writeFileSync(claudePath, `{\n  // my servers\n  "mcpServers": { "mindos": { "command": "mindos" }, "other": { "command": "other" } }\n}\n`);

    const uninstall = handleMcpUninstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
    }, { agents, homeDir: home });
    expect(uninstall.body).toEqual({
      results: [{ agent: 'claude-code', status: 'ok', path: '~/.claude.json' }],
    });
    const afterUninstall = readFileSync(claudePath, 'utf-8');
    expect(afterUninstall).toContain('// my servers');
    expect(parseJsonc(afterUninstall)).toEqual({ mcpServers: { other: { command: 'other' } } });
    expect(backups(home)).toEqual([]);
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
    expect(copy.body).toEqual({
      results: [{ agent: 'kilo-code', status: 'ok', path: '~/.config/kilo/kilo.jsonc' }],
    });
    const afterCopy = readFileSync(join(kiloDir, 'kilo.jsonc'), 'utf-8');
    expect(afterCopy).toContain('/* kilo */');
    expect(parseJsonc(afterCopy)).toEqual({ mcp: { other: { command: 'other' } } });
    expect(backups(kiloDir)).toEqual([]);
    expect(leftovers(kiloDir)).toEqual([]);
  });

  it('leaves the file untouched when uninstalling a server that is not configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-noop-'));
    const claudePath = join(home, '.claude.json');
    const original = `{\n  // untouched\n  "mcpServers": { "other": { "command": "other" } }\n}\n`;
    writeFileSync(claudePath, original);

    const res = handleMcpUninstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
    }, { agents, homeDir: home });

    expect(res.body).toEqual({ results: [{ agent: 'claude-code', status: 'ok', path: '~/.claude.json' }] });
    expect(readFileSync(claudePath, 'utf-8')).toBe(original);
  });

  it('edits a file with recoverable JSONC syntax issues in place and reports a warning', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-broken-'));
    const claudePath = join(home, '.claude.json');
    // Missing closing brace: jsonc-parser still recovers the object shape.
    writeFileSync(claudePath, `{ "mcpServers": { "other": {} }`);

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.body).toMatchObject({
      results: [{
        agent: 'claude-code',
        status: 'ok',
        warnings: [expect.stringContaining('JSONC syntax issues')],
      }],
    });
    const warning = (res.body as { results: Array<{ warnings: string[] }> }).results[0]!.warnings[0]!;
    expect(warning).toContain(claudePath);
    expect(warning).toContain('CloseBraceExpected');

    const rewritten = readFileSync(claudePath, 'utf-8');
    const { value } = parseJsoncDocument(rewritten);
    expect(value).toMatchObject({ mcpServers: { other: {}, mindos: { type: 'stdio', command: 'mindos' } } });
    expect(backups(home)).toEqual([]);
    expect(leftovers(home)).toEqual([]);
  });

  it('refuses to edit a config whose root is not an object and leaves it untouched', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-array-'));
    const claudePath = join(home, '.claude.json');
    writeFileSync(claudePath, '[1,2]');

    const install = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });
    expect(install.body).toMatchObject({
      results: [{ agent: 'claude-code', status: 'error', message: expect.stringContaining('object') }],
    });
    expect(readFileSync(claudePath, 'utf-8')).toBe('[1,2]');

    const uninstall = handleMcpUninstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
    }, { agents, homeDir: home });
    expect(uninstall.body).toMatchObject({
      results: [{ agent: 'claude-code', status: 'error' }],
    });
    expect(readFileSync(claudePath, 'utf-8')).toBe('[1,2]');
    expect(backups(home)).toEqual([]);
    expect(leftovers(home)).toEqual([]);
  });

  it('reports an error for garbage that cannot be parsed as JSONC at all', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-garbage-'));
    const claudePath = join(home, '.claude.json');
    writeFileSync(claudePath, '}}} not json');

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.body).toMatchObject({ results: [{ agent: 'claude-code', status: 'error' }] });
    expect(readFileSync(claudePath, 'utf-8')).toBe('}}} not json');
  });

  it('treats a comment-only config as empty and keeps the comment', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-atomic-comment-only-'));
    const claudePath = join(home, '.claude.json');
    writeFileSync(claudePath, '// nothing here yet\n');

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.body).toEqual({
      results: [{ agent: 'claude-code', status: 'ok', path: '~/.claude.json', transport: 'stdio' }],
    });
    const rewritten = readFileSync(claudePath, 'utf-8');
    expect(rewritten).toContain('// nothing here yet');
    expect(parseJsonc(rewritten)).toMatchObject({ mcpServers: { mindos: { command: 'mindos' } } });
  });
});

describe('project-scoped installs resolve against an explicit project root, never the server cwd', () => {
  const cwdProjectFile = join(process.cwd(), '.mcp.json');

  it('writes the project config under services.projectRoot', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-root-'));
    const cwdHadFile = existsSync(cwdProjectFile);

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'project' }],
      transport: 'stdio',
    }, { agents, homeDir: home, projectRoot: root });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ results: [{ agent: 'claude-code', status: 'ok', path: '.mcp.json' }] });
    expect(parseJsonc(readFileSync(join(root, '.mcp.json'), 'utf-8'))).toMatchObject({ mcpServers: { mindos: { command: 'mindos' } } });
    expect(existsSync(cwdProjectFile)).toBe(cwdHadFile);
    expect(existsSync(join(home, '.mcp.json'))).toBe(false);
  });

  it('lets the request name an absolute projectRoot that overrides the service default', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-home-'));
    const serviceRoot = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-service-root-'));
    const requestRoot = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-request-root-'));

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'project' }],
      transport: 'stdio',
      projectRoot: requestRoot,
    }, { agents, homeDir: home, projectRoot: serviceRoot });

    expect(res.status).toBe(200);
    expect(existsSync(join(requestRoot, '.mcp.json'))).toBe(true);
    expect(existsSync(join(serviceRoot, '.mcp.json'))).toBe(false);
  });

  it('rejects a project-scoped install with 400 when no project root is known', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-home-'));
    const cwdHadFile = existsSync(cwdProjectFile);

    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'project' }],
      transport: 'stdio',
    }, { agents, homeDir: home });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/project root/i);
    expect(existsSync(cwdProjectFile)).toBe(cwdHadFile);
  });

  it('rejects a relative or non-string request projectRoot with 400', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-root-'));

    const relative = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'project' }],
      projectRoot: 'relative/dir',
    }, { agents, homeDir: home, projectRoot: root });
    expect(relative.status).toBe(400);

    const wrongType = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'project' }],
      projectRoot: 42 as unknown as string,
    }, { agents, homeDir: home, projectRoot: root });
    expect(wrongType.status).toBe(400);
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
  });

  it('still installs global scope without any project root', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-home-'));
    const res = await handleMcpInstallPost({
      agents: [{ key: 'claude-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home });
    expect(res.status).toBe(200);
    expect(existsSync(join(home, '.claude.json'))).toBe(true);
  });

  it('uninstalls and copies through the same project root', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-project-root-'));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { other: { command: 'other' } } }));

    const copied = await handleMcpServerCopyPost({
      serverName: 'other',
      sourceAgentKey: 'claude-code',
      sourceScope: 'global',
      targets: [{ key: 'claude-code', scope: 'project' }],
    }, { agents, homeDir: home, projectRoot: root });
    expect(copied.body).toMatchObject({ results: [{ agent: 'claude-code', status: 'ok', path: '.mcp.json' }] });
    expect(parseJsonc(readFileSync(join(root, '.mcp.json'), 'utf-8'))).toEqual({ mcpServers: { other: { command: 'other' } } });

    const removed = handleMcpUninstallPost({
      agents: [{ key: 'claude-code', scope: 'project', serverName: 'other' }],
    }, { agents, homeDir: home, projectRoot: root });
    expect(removed.body).toMatchObject({ results: [{ agent: 'claude-code', status: 'ok' }] });
    expect(parseJsonc(readFileSync(join(root, '.mcp.json'), 'utf-8'))).toEqual({ mcpServers: {} });

    const noRoot = handleMcpUninstallPost({
      agents: [{ key: 'claude-code', scope: 'project', serverName: 'other' }],
    }, { agents, homeDir: home });
    expect(noRoot.status).toBe(400);
  });
});
