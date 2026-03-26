import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempHome: string;
let origHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-test-'));
  origHome = process.env.HOME ?? '';
  // Override HOME so expandHome('~/...') resolves to our temp dir
  process.env.HOME = tempHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

async function importInstallRoute() {
  return await import('../../app/api/mcp/install/route');
}

async function importAgentsRoute() {
  return await import('../../app/api/mcp/agents/route');
}

describe('POST /api/mcp/install', () => {
  it('returns error for unknown agent key', async () => {
    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'fake-agent', scope: 'global' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('error');
    expect(body.results[0].message).toMatch(/Unknown agent/);
  });

  it('installs stdio entry to claude-code global config', async () => {
    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'claude-code', scope: 'global' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('ok');

    // Verify config file was written
    const configPath = path.join(tempHome, '.claude.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.mindos).toBeDefined();
    expect(config.mcpServers.mindos.type).toBe('stdio');
    expect(config.mcpServers.mindos.command).toBe('mindos');
  });

  it('installs http entry with URL and token', async () => {
    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'claude-code', scope: 'global' }],
        transport: 'http',
        url: 'http://example.com/mcp',
        token: 'secret123',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('ok');

    const configPath = path.join(tempHome, '.claude.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.mcpServers.mindos.url).toBe('http://example.com/mcp');
    expect(config.mcpServers.mindos.headers.Authorization).toBe('Bearer secret123');
  });

  it('preserves existing config entries when installing', async () => {
    // Pre-seed a config file with another MCP server
    const configPath = path.join(tempHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { 'other-server': { url: 'http://other.com/mcp' } },
    }, null, 2), 'utf-8');

    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'claude-code', scope: 'global' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(req);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Original server preserved
    expect(config.mcpServers['other-server'].url).toBe('http://other.com/mcp');
    // New server added
    expect(config.mcpServers.mindos).toBeDefined();
  });

  it('returns error for agent without project scope', async () => {
    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'windsurf', scope: 'project' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('error');
    expect(body.results[0].message).toMatch(/does not support/);
  });

  it('installs codex agent in TOML format', async () => {
    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'codex', scope: 'global' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('ok');

    const configPath = path.join(tempHome, '.codex', 'config.toml');
    expect(fs.existsSync(configPath)).toBe(true);
    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[mcp_servers.mindos]');
    expect(content).toContain('type = "stdio"');
    expect(content).toContain('command = "mindos"');
    expect(content).toContain('MCP_TRANSPORT = "stdio"');
  });

  it('preserves existing TOML content when installing codex', async () => {
    const configDir = path.join(tempHome, '.codex');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.toml');
    fs.writeFileSync(configPath, '[other_section]\nkey = "value"\n', 'utf-8');

    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'codex', scope: 'global' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(req);

    const content = fs.readFileSync(configPath, 'utf-8');
    expect(content).toContain('[other_section]');
    expect(content).toContain('key = "value"');
    expect(content).toContain('[mcp_servers.mindos]');
  });

  it('installs vscode agent with correct nested key for global scope', async () => {
    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'vscode', scope: 'global' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('ok');

    const configPath = body.results[0].path;
    const absPath = configPath.replace('~', tempHome);
    expect(fs.existsSync(absPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    // VS Code global config must nest under mcp.servers, not just servers
    expect(config.mcp).toBeDefined();
    expect(config.mcp.servers).toBeDefined();
    expect(config.mcp.servers.mindos).toBeDefined();
    expect(config.mcp.servers.mindos.type).toBe('stdio');
  });

  it('installs vscode project scope with flat key', async () => {
    // Create the .vscode directory first
    fs.mkdirSync(path.join(process.cwd(), '.vscode'), { recursive: true });

    const { POST } = await importInstallRoute();
    const req = new NextRequest('http://localhost/api/mcp/install', {
      method: 'POST',
      body: JSON.stringify({
        agents: [{ key: 'vscode', scope: 'project' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('ok');

    const absPath = path.join(process.cwd(), '.vscode', 'mcp.json');
    if (fs.existsSync(absPath)) {
      const config = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
      // Project scope uses flat key 'servers', not nested mcp.servers
      expect(config.servers).toBeDefined();
      expect(config.servers.mindos).toBeDefined();
      expect(config.servers.mindos.type).toBe('stdio');
      // Clean up
      fs.rmSync(absPath);
    }
  });
});

describe('GET /api/mcp/agents', () => {
  it('returns all 19 agents', async () => {
    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toHaveLength(20);
    const keys = body.agents.map((a: { key: string }) => a.key);
    expect(keys).toContain('mindos');
    expect(keys).toContain('claude-code');
    expect(keys).toContain('cursor');
    expect(keys).toContain('codebuddy');
    expect(keys).toContain('iflow-cli');
    expect(keys).toContain('kimi-cli');
    expect(keys).toContain('opencode');
    expect(keys).toContain('pi');
    expect(keys).toContain('augment');
    expect(keys).toContain('qwen-code');
    expect(keys).toContain('qoder');
    expect(keys).toContain('trae-cn');
    expect(keys).toContain('roo');
    expect(keys).toContain('vscode');
    expect(keys).toContain('codex');
  });

  it('detects installed agent from config file', async () => {
    // Pre-seed a claude-code config
    const configPath = path.join(tempHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        mindos: { type: 'stdio', command: 'mindos', args: ['mcp'] },
        github: { url: 'https://api.githubcopilot.com/mcp' },
      },
    }), 'utf-8');
    fs.mkdirSync(path.join(tempHome, '.claude', 'skills', 'mindos'), { recursive: true });
    fs.mkdirSync(path.join(tempHome, '.claude', 'skills', 'project-wiki'), { recursive: true });

    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    const claude = body.agents.find((a: { key: string }) => a.key === 'claude-code');
    expect(claude.installed).toBe(true);
    expect(claude.scope).toBe('global');
    expect(claude.transport).toBe('stdio');
    expect(claude.skillMode).toBeDefined();
    expect(typeof claude.hiddenRootPresent).toBe('boolean');
    expect(typeof claude.runtimeConversationSignal).toBe('boolean');
    expect(typeof claude.runtimeUsageSignal).toBe('boolean');
    expect(Array.isArray(claude.configuredMcpServers)).toBe(true);
    expect(claude.configuredMcpServers).toContain('mindos');
    expect(claude.configuredMcpServers).toContain('github');
    expect(claude.configuredMcpServerCount).toBe(2);
    expect(Array.isArray(claude.installedSkillNames)).toBe(true);
    expect(claude.installedSkillNames).toContain('mindos');
    expect(claude.installedSkillNames).toContain('project-wiki');
    expect(claude.installedSkillCount).toBe(2);
  });

  it('reports not installed when no config exists', async () => {
    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    const cursor = body.agents.find((a: { key: string }) => a.key === 'cursor');
    expect(cursor.installed).toBe(false);
  });

  it('sorts agents: installed first, then detected, then not found', async () => {
    // Pre-seed claude-code as installed
    const configPath = path.join(tempHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { mindos: { type: 'stdio', command: 'mindos', args: ['mcp'] } },
    }), 'utf-8');

    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    const agents = body.agents as { key: string; installed: boolean; present: boolean }[];

    // mindos is always first (builtin)
    expect(agents[0].key).toBe('mindos');
    expect(agents[0].installed).toBe(true);

    // claude-code should be second (installed via config)
    expect(agents[1].key).toBe('claude-code');
    expect(agents[1].installed).toBe(true);

    // Verify ordering invariant: after mindos, no non-installed agent appears before an installed one
    for (let i = 2; i < agents.length; i++) {
      const prev = agents[i - 1];
      const curr = agents[i];
      const rankOf = (a: typeof prev) => a.installed ? 0 : a.present ? 1 : 2;
      expect(rankOf(prev)).toBeLessThanOrEqual(rankOf(curr));
    }
  });
});
