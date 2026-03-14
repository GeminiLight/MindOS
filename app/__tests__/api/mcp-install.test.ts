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
        agents: [{ key: 'claude-desktop', scope: 'project' }],
        transport: 'stdio',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.results[0].status).toBe('error');
    expect(body.results[0].message).toMatch(/does not support/);
  });
});

describe('GET /api/mcp/agents', () => {
  it('returns all 9 agents', async () => {
    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    expect(body.agents).toHaveLength(9);
    const keys = body.agents.map((a: { key: string }) => a.key);
    expect(keys).toContain('claude-code');
    expect(keys).toContain('cursor');
    expect(keys).toContain('codebuddy');
  });

  it('detects installed agent from config file', async () => {
    // Pre-seed a claude-code config
    const configPath = path.join(tempHome, '.claude.json');
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: { mindos: { type: 'stdio', command: 'mindos', args: ['mcp'] } },
    }), 'utf-8');

    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    const claude = body.agents.find((a: { key: string }) => a.key === 'claude-code');
    expect(claude.installed).toBe(true);
    expect(claude.scope).toBe('global');
    expect(claude.transport).toBe('stdio');
  });

  it('reports not installed when no config exists', async () => {
    const { GET } = await importAgentsRoute();
    const res = await GET();
    const body = await res.json();
    const cursor = body.agents.find((a: { key: string }) => a.key === 'cursor');
    expect(cursor.installed).toBe(false);
  });
});
