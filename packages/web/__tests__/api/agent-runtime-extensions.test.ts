import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import os from 'os';
import path from 'path';

let mindRoot: string;
const testState = vi.hoisted(() => ({
  settings: { mindRoot: '' } as Record<string, unknown>,
}));

vi.mock('@/lib/settings', () => ({
  readSettings: () => testState.settings,
  writeSettings: (next: Record<string, unknown>) => {
    testState.settings = next;
  },
}));

function manifest() {
  return {
    id: 'aion-style-pack',
    name: 'Aion Style Pack',
    version: '0.1.0',
    contributes: {
      acpAdapters: [
        {
          id: 'ext-buddy',
          name: 'External Buddy',
          cliCommand: 'codebuddy',
          acpArgs: ['--acp'],
          supportsStreaming: true,
          apiKeyFields: [{ key: 'BUDDY_TOKEN', type: 'password' }],
        },
      ],
      commands: [{ id: 'explain', title: 'Explain Selection', slash: '/explain' }],
    },
  };
}

async function importListRoute() {
  return import('../../app/api/agent-runtimes/extensions/route');
}

async function importPreflightRoute() {
  return import('../../app/api/agent-runtimes/extensions/preflight/route');
}

async function importInstallRoute() {
  return import('../../app/api/agent-runtimes/extensions/install/route');
}

function postRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/agent-runtimes/extensions', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-agent-runtime-extension-api-'));
    testState.settings = { mindRoot };
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('preflights runtime extension manifests without writing settings or local files', async () => {
    const { POST } = await importPreflightRoute();
    const res = await POST(postRequest('http://localhost/api/agent-runtimes/extensions/preflight', {
      manifest: manifest(),
      extensionRoot: '/tmp/source-extension',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      readOnly: true,
      installable: true,
      extension: {
        id: 'aion-style-pack',
        contributionCounts: {
          acpAdapters: 1,
          commands: 1,
        },
      },
      acpAgentIds: ['ext-buddy'],
    });
    expect(JSON.stringify(json)).not.toContain('BUDDY_TOKEN');
    expect(JSON.stringify(json)).not.toContain('resolvedPath');
    expect(testState.settings).toEqual({ mindRoot });
    expect(fs.existsSync(path.join(mindRoot, '.mindos'))).toBe(false);
  });

  it('installs manifests and lists installed runtime extensions through thin Next adapters', async () => {
    const installRoute = await importInstallRoute();
    const installRes = await installRoute.POST(postRequest('http://localhost/api/agent-runtimes/extensions/install', {
      manifest: manifest(),
      confirm: true,
    }));
    const installJson = await installRes.json();

    expect(installRes.status).toBe(201);
    expect(installJson).toMatchObject({
      ok: true,
      installed: {
        id: 'aion-style-pack',
        manifestPath: '.mindos/runtime-extensions/aion-style-pack/manifest.json',
      },
      acpAgents: {
        'ext-buddy': expect.objectContaining({
          command: 'codebuddy',
          args: ['--acp'],
        }),
      },
    });
    expect(testState.settings.acpAgents).toMatchObject({
      'ext-buddy': expect.objectContaining({
        command: 'codebuddy',
        args: ['--acp'],
      }),
    });

    const listRoute = await importListRoute();
    const listRes = await listRoute.GET();
    const listJson = await listRes.json();

    expect(listRes.status).toBe(200);
    expect(listJson.extensions).toEqual([
      expect.objectContaining({
        id: 'aion-style-pack',
        manifest: expect.objectContaining({
          contributes: expect.objectContaining({
            acpAdapters: [expect.objectContaining({ id: 'ext-buddy' })],
          }),
        }),
      }),
    ]);
  });

  it('requires explicit confirmation for install route writes', async () => {
    const { POST } = await importInstallRoute();
    const res = await POST(postRequest('http://localhost/api/agent-runtimes/extensions/install', {
      manifest: manifest(),
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ error: 'Runtime extension install requires explicit confirmation.' });
    expect(testState.settings.acpAgents).toBeUndefined();
  });
});
