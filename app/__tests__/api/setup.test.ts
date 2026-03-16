import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

// We need to mock settings + template modules for the setup API
const mockSettings = {
  ai: {
    provider: 'skip' as const,
    providers: {
      anthropic: { apiKey: '', model: 'claude-sonnet-4-6' },
      openai: { apiKey: '', model: 'gpt-5.4', baseUrl: '' },
    },
  },
  mindRoot: '',
  port: 3000,
  mcpPort: 8787,
  authToken: '',
  webPassword: '',
  setupPending: true,
};

let writtenConfig: Record<string, unknown> | null = null;
let tempDir: string;

vi.mock('@/lib/settings', () => ({
  readSettings: () => ({ ...mockSettings }),
  writeSettings: vi.fn((cfg: Record<string, unknown>) => { writtenConfig = cfg; }),
  effectiveSopRoot: () => tempDir,
}));

vi.mock('@/lib/template', () => ({
  applyTemplate: vi.fn((_tpl: string, root: string) => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), '# Hello', 'utf-8');
  }),
}));

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-setup-test-'));
  writtenConfig = null;
  // Reset mockSettings for each test
  mockSettings.mindRoot = '';
  mockSettings.port = 3000;
  mockSettings.mcpPort = 8787;
  mockSettings.authToken = '';
  mockSettings.webPassword = '';
  mockSettings.setupPending = true;
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function importSetupRoute() {
  return await import('../../app/api/setup/route');
}

/* ── GET /api/setup ─────────────────────────────────────────────── */

describe('GET /api/setup', () => {
  it('returns default setup state', async () => {
    const { GET } = await importSetupRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('mindRoot');
    expect(body).toHaveProperty('homeDir');
    expect(body).toHaveProperty('platform');
    expect(body).toHaveProperty('port');
    expect(body).toHaveProperty('mcpPort');
    expect(body.port).toBe(3000);
    expect(body.mcpPort).toBe(8787);
  });

  it('masks API keys', async () => {
    mockSettings.ai.providers.anthropic.apiKey = 'sk-ant-1234567890abcdef';
    const { GET } = await importSetupRoute();
    const res = await GET();
    const body = await res.json();
    expect(body.anthropicApiKey).toBe('sk-ant***');
    mockSettings.ai.providers.anthropic.apiKey = '';
  });
});

/* ── POST /api/setup — Validation ───────────────────────────────── */

describe('POST /api/setup — validation', () => {
  it('rejects missing mindRoot', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ template: 'en' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mindRoot/i);
  });

  it('rejects port below 1024', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: tempDir, port: 80 }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/port/i);
  });

  it('rejects port above 65535', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: tempDir, port: 70000 }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects invalid MCP port', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: tempDir, port: 3000, mcpPort: 500 }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/MCP port/i);
  });
});

/* ── POST /api/setup — Config writing ───────────────────────────── */

describe('POST /api/setup — config writing', () => {
  it('writes correct config for en template', async () => {
    const { POST } = await importSetupRoute();
    const mindRoot = path.join(tempDir, 'mind');
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        mindRoot,
        template: 'en',
        port: 3001,
        mcpPort: 8788,
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify written config
    expect(writtenConfig).not.toBeNull();
    expect((writtenConfig as Record<string, unknown>).mindRoot).toBe(mindRoot);
    expect((writtenConfig as Record<string, unknown>).port).toBe(3001);
    expect((writtenConfig as Record<string, unknown>).mcpPort).toBe(8788);
    expect((writtenConfig as Record<string, unknown>).setupPending).toBe(false);
  });

  it('sets disabledSkills=["mindos-zh"] for en template', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: path.join(tempDir, 'en'), template: 'en' }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(req);
    expect(writtenConfig).not.toBeNull();
    expect((writtenConfig as Record<string, unknown>).disabledSkills).toEqual(['mindos-zh']);
  });

  it('sets disabledSkills=["mindos"] for zh template', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: path.join(tempDir, 'zh'), template: 'zh' }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(req);
    expect(writtenConfig).not.toBeNull();
    expect((writtenConfig as Record<string, unknown>).disabledSkills).toEqual(['mindos']);
  });

  it('defaults to disabledSkills=["mindos-zh"] for empty template', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: path.join(tempDir, 'empty'), template: 'empty' }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(req);
    expect(writtenConfig).not.toBeNull();
    expect((writtenConfig as Record<string, unknown>).disabledSkills).toEqual(['mindos-zh']);
  });

  it('detects needsRestart on first-time setup', async () => {
    mockSettings.setupPending = true;
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: path.join(tempDir, 'first') }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.needsRestart).toBe(true);
  });

  it('detects needsRestart when port changes on re-setup', async () => {
    const existingRoot = path.join(tempDir, 'existing');
    fs.mkdirSync(existingRoot, { recursive: true });
    fs.writeFileSync(path.join(existingRoot, 'dummy.md'), 'x');
    mockSettings.setupPending = false;
    mockSettings.mindRoot = existingRoot;
    mockSettings.port = 3000;
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({ mindRoot: existingRoot, port: 3001 }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.needsRestart).toBe(true);
    expect(body.portChanged).toBe(true);
  });

  it('skips restart when nothing changed on re-setup', async () => {
    mockSettings.setupPending = false;
    mockSettings.mindRoot = path.join(tempDir, 'stable');
    mockSettings.port = 3000;
    mockSettings.mcpPort = 8787;
    mockSettings.authToken = '';
    mockSettings.webPassword = '';
    // Pre-create dir so template is not applied
    fs.mkdirSync(path.join(tempDir, 'stable'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'stable', 'dummy.md'), 'x');

    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        mindRoot: path.join(tempDir, 'stable'),
        port: 3000,
        mcpPort: 8787,
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.needsRestart).toBe(false);
    expect(body.portChanged).toBe(false);
  });
});

/* ── POST /api/setup — LLM skip mode ───────────────────────────── */

describe('POST /api/setup — LLM skip', () => {
  it('accepts ai: undefined (skip mode)', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        mindRoot: path.join(tempDir, 'skip'),
        template: 'en',
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Should fallback to current ai config
    expect(writtenConfig).not.toBeNull();
    expect((writtenConfig as Record<string, unknown>).ai).toBeDefined();
  });

  it('accepts explicit ai config', async () => {
    const { POST } = await importSetupRoute();
    const req = new NextRequest('http://localhost/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        mindRoot: path.join(tempDir, 'ai'),
        ai: {
          provider: 'openai',
          providers: {
            openai: { apiKey: 'sk-test', model: 'gpt-5.4', baseUrl: '' },
          },
        },
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const config = writtenConfig as Record<string, unknown>;
    const ai = config.ai as Record<string, unknown>;
    expect(ai.provider).toBe('openai');
  });
});
