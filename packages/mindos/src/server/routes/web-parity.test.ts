import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMindosApp } from '../app.js';
import { KNOWLEDGE_WRITE_MAX_BODY_BYTES } from '../body.js';
import { listContentChangesFromLog } from '../handlers/change-log-store.js';
import { createDefaultMindosHttpServices, type MindosHttpServices } from '../services.js';
import type { MindosRuntimeSettings } from '../runtime.js';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

function makeRoot(prefix = 'mindos-web-parity-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function makeServices(root: string, extra: Partial<MindosHttpServices> = {}, settings: Partial<MindosRuntimeSettings> = {}): MindosHttpServices {
  const services = createDefaultMindosHttpServices({
    homeDir: root,
    readSettings: () => ({ mindRoot: root, ...settings }),
  });
  cleanups.push(() => services.dispose?.());
  return { ...services, ...extra };
}

function hostApp(services: MindosHttpServices) {
  return createMindosApp({ services, auth: 'host', staticFallback: false });
}

function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('route table: knowledge write parity with the Next host', () => {
  it('accepts /api/file bodies above the 1 MB default up to the shared 25 MB knowledge limit', async () => {
    const root = makeRoot();
    const app = hostApp(makeServices(root));
    const content = 'x'.repeat(1_100_000);
    const res = await app.fetch(jsonRequest('http://localhost/api/file', 'POST', { op: 'save_file', path: 'big.md', content }));
    expect(res.status).toBe(200);
    expect(readFileSync(join(root, 'big.md'), 'utf-8')).toHaveLength(content.length);
  });

  it('rejects /api/file and /api/inbox bodies whose declared size exceeds 25 MB with 413 before reading them', async () => {
    const root = makeRoot();
    const app = hostApp(makeServices(root));
    const headers = { 'content-length': String(KNOWLEDGE_WRITE_MAX_BODY_BYTES + 1) };
    for (const [url, method] of [['/api/file', 'POST'], ['/api/inbox', 'POST'], ['/api/inbox', 'DELETE']] as const) {
      const res = await app.fetch(jsonRequest(`http://localhost${url}`, method, { files: [] }, headers));
      expect(res.status, `${method} ${url}`).toBe(413);
      expect((await res.json()).error).toMatch(/too large/i);
    }
  });

  it('records content changes and notifies the host after a file write, with tree/content distinction', async () => {
    const root = makeRoot();
    const onChanged = vi.fn();
    const app = hostApp(makeServices(root, { knowledgeWrites: { onChanged } }));

    const save = await app.fetch(jsonRequest('http://localhost/api/file', 'POST', { op: 'save_file', path: 'notes/a.md', content: 'hello' }, {
      'x-mindos-agent': 'codex',
    }));
    expect(save.status).toBe(200);
    // save_file is a content write even for a new path: the host refreshes that one path incrementally.
    expect(onChanged).toHaveBeenLastCalledWith({ treeChanged: false, paths: ['notes/a.md'] });

    const edit = await app.fetch(jsonRequest('http://localhost/api/file', 'POST', { op: 'save_file', path: 'notes/a.md', content: 'hello again' }));
    expect(edit.status).toBe(200);
    expect(onChanged).toHaveBeenLastCalledWith({ treeChanged: false, paths: ['notes/a.md'] });

    const del = await app.fetch(jsonRequest('http://localhost/api/file', 'POST', { op: 'delete_file', path: 'notes/a.md' }));
    expect(del.status).toBe(200);
    expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ treeChanged: true }));

    const changes = listContentChangesFromLog(root, { limit: 10 });
    expect(changes.length).toBeGreaterThanOrEqual(3);
    // Control characters are stripped from the agent header before it lands in the log.
    expect(changes.find((change) => change.source === 'agent')).toMatchObject({ agentName: 'codex' });
  });

  it('does not notify the host or log a change when the write is rejected', async () => {
    const root = makeRoot();
    const onChanged = vi.fn();
    const app = hostApp(makeServices(root, { knowledgeWrites: { onChanged, protectedRootFiles: ['README.md'] } }));
    const res = await app.fetch(jsonRequest('http://localhost/api/file', 'POST', { op: 'save_file', path: 'README.md', content: 'x' }, {
      'x-mindos-agent': 'claude-code',
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/protected/i);
    expect(onChanged).not.toHaveBeenCalled();
    expect(listContentChangesFromLog(root, { limit: 10 })).toEqual([]);
  });

  it('expands inbox captures through the host hook and reports saved paths as a tree change', async () => {
    const root = makeRoot();
    const onChanged = vi.fn();
    const expandInboxFiles = vi.fn(async (files: Array<{ name: string; content: string }>) => (
      files.length === 0 ? files : [...files, { name: 'paper.md', content: '# extracted' }]
    ));
    const app = hostApp(makeServices(root, { knowledgeWrites: { onChanged, expandInboxFiles } }));

    const res = await app.fetch(jsonRequest('http://localhost/api/inbox', 'POST', { files: [{ name: 'paper.pdf', content: 'JVBERi0=', encoding: 'base64' }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved.map((entry: { original: string }) => entry.original).sort()).toEqual(['paper.md', 'paper.pdf']);
    expect(expandInboxFiles).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith({ treeChanged: true, paths: body.saved.map((entry: { path: string }) => entry.path) });

    onChanged.mockClear();
    const empty = await app.fetch(jsonRequest('http://localhost/api/inbox', 'POST', { files: [] }));
    expect(empty.status).toBe(200);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('route table: A2A JSON-RPC error shape', () => {
  it('answers oversized, unparsable and valid requests in JSON-RPC form using the host task store', async () => {
    const root = makeRoot();
    const handleGetTask = vi.fn(() => ({ id: 'task-1', status: { state: 'TASK_STATE_COMPLETED', timestamp: 'now' } }));
    const app = hostApp(makeServices(root, { a2a: { handleGetTask, getDiscoveredAgents: () => [{ id: 'remote' }] } }));

    const big = await app.fetch(jsonRequest('http://localhost/api/a2a', 'POST', '{}', { 'content-length': '200000' }));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32600 } });

    const broken = await app.fetch(jsonRequest('http://localhost/api/a2a', 'POST', '{not json'));
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32700 } });

    const ok = await app.fetch(jsonRequest('http://localhost/api/a2a', 'POST', { jsonrpc: '2.0', id: 7, method: 'GetTask', params: { id: 'task-1' } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ jsonrpc: '2.0', id: 7, result: { id: 'task-1' } });
    expect(handleGetTask).toHaveBeenCalledWith({ id: 'task-1' });

    const agents = await app.fetch(new Request('http://localhost/api/a2a/agents'));
    expect(await agents.json()).toEqual({ agents: [{ id: 'remote' }] });
  });

  it('applies the host discovery policy before contacting a remote agent', async () => {
    const root = makeRoot();
    const discoverAgent = vi.fn(async () => ({ id: 'agent-1' }));
    const app = hostApp(makeServices(root, {
      a2a: {
        discoverAgent,
        validateDiscoveryUrl: (url) => (url.includes('127.0.0.1') ? { ok: false, message: 'private network blocked' } : { ok: true, url: url.replace(/\/+$/, '') }),
      },
    }));

    const blocked = await app.fetch(jsonRequest('http://localhost/api/a2a/discover', 'POST', { url: 'http://127.0.0.1:3456' }));
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toEqual({ error: 'private network blocked', agent: null });
    expect(discoverAgent).not.toHaveBeenCalled();

    const allowed = await app.fetch(jsonRequest('http://localhost/api/a2a/discover', 'POST', { url: 'https://agent.example///' }));
    expect(allowed.status).toBe(200);
    expect(discoverAgent).toHaveBeenCalledWith('https://agent.example');
  });
});

describe('route table: setup and connectivity parity', () => {
  it('treats the port the request arrived on as this server for /api/setup/check-port', async () => {
    const root = makeRoot();
    const app = hostApp(makeServices(root));
    const self = await app.fetch(jsonRequest('http://localhost:3013/api/setup/check-port', 'POST', { port: 3013 }));
    expect(await self.json()).toEqual({ available: true, isSelf: true });

    const invalid = await app.fetch(jsonRequest('http://localhost:3013/api/setup/check-port', 'POST', { port: 80 }));
    expect(invalid.status).toBe(400);
  });

  it('lets the host supply template installers and provider presets for /api/setup', async () => {
    const root = makeRoot();
    const mindRoot = join(root, 'mind');
    const applyTemplate = vi.fn((_template: string, dest: string) => {
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, 'README.md'), '# hello');
      return { ok: true as const };
    });
    let written: Record<string, unknown> | null = null;
    const app = hostApp(makeServices(root, {
      writeSettings: (settings) => { written = settings; },
      setup: { applyTemplate },
    }, { setupPending: true }));

    const res = await app.fetch(jsonRequest('http://localhost/api/setup', 'POST', {
      mindRoot,
      template: 'en',
      port: 3456,
      mcpPort: 8781,
    }));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(applyTemplate).toHaveBeenCalledWith('en', mindRoot);
    expect(existsSync(join(mindRoot, 'README.md'))).toBe(true);
    expect(written).toMatchObject({ mindRoot, setupPending: false });
  });

  it('falls back to product provider presets when the host injects none', async () => {
    const root = makeRoot();
    const app = hostApp(makeServices(root));
    const res = await app.fetch(new Request('http://localhost/api/setup'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ port: 3456, mcpPort: 8781 });
  });
});

describe('route table: agent runtime host extensions', () => {
  it('labels the Claude bridge and compacts failures in core so the picker, projections and readiness agree', async () => {
    const root = makeRoot();
    const app = hostApp(makeServices(root, {
      agentRuntimes: {
        detectLocalAcpAgents: async () => ({ installed: [], notInstalled: [] }),
        resolveRuntimeCommand: async (command: string) => (command === 'claude' || command === 'codex' ? `/usr/local/bin/${command}` : null),
        resolveRuntimeCommandCandidates: async () => [],
        // A host health check that only describes the bridge in prose: the typed field must still come out of core.
        checkNativeRuntimeHealth: async ({ runtime }) => (runtime === 'claude'
          ? {
            status: 'available' as const,
            diagnosticHints: ['Claude Code CLI is available; Claude Agent SDK bridge is unavailable, so MindOS will use CLI fallback. SDK missing'],
          }
          : { status: 'error' as const, reason: ['Error: codex exploded', 'at findCodexExecutable (file:///opt/codex.js:1:1)', 'Node.js v22.0.0'].join('\n') }),
      },
    }));

    const picker = await (await app.fetch(new Request('http://localhost/api/agent-runtimes?runtime=claude'))).json();
    const list = await (await app.fetch(new Request('http://localhost/api/agent-runtimes'))).json();
    const adapter = await (await app.fetch(new Request('http://localhost/api/agent-runtimes/adapter-projections?runtime=claude'))).json();
    const readiness = await (await app.fetch(new Request('http://localhost/api/agent-runtimes/readiness?runtime=claude'))).json();

    const expectedBridge = { kind: 'claude-cli', label: 'CLI fallback active', fallback: true, reason: 'SDK missing' };
    expect(picker.runtime).toMatchObject({ adapter: 'claude-cli', runtimeBridge: expectedBridge });
    expect(picker.runtime.adapterContract.connection.kind).toBe('cli');
    const listed = list.runtimes.find((runtime: { id: string }) => runtime.id === 'claude');
    expect(listed).toMatchObject({ adapter: 'claude-cli', runtimeBridge: expectedBridge });
    expect(adapter.projections[0]).toMatchObject({ runtimeId: 'claude', connection: { kind: 'cli' } });
    expect(readiness.projections[0].useCases.find((useCase: { id: string }) => useCase.id === 'adapter-contract').details.connection.kind).toBe('cli');

    // The Codex failure is the same compact sentence everywhere, never a stack.
    const codex = list.runtimes.find((runtime: { id: string }) => runtime.id === 'codex');
    expect(codex.availability.reason).toBe('codex exploded');
    expect(JSON.stringify(list)).not.toContain('file:///opt');
    expect(JSON.stringify(readiness)).not.toContain('file:///opt');
  });

  it('probes ACP handshakes through the host session factory when handshake=1 and reads the cache otherwise', async () => {
    const root = makeRoot();
    const createSession = vi.fn(async (agentId: string) => ({ id: `ses-${agentId}`, agentId, initialized: true }));
    const closeSession = vi.fn(async () => undefined);
    const app = hostApp(makeServices(root, {
      acp: { createSession, closeSession },
      agentRuntimes: {
        detectLocalAcpAgents: async () => ({
          installed: [{ id: 'gemini', name: 'Gemini CLI', binaryPath: '/usr/local/bin/gemini', status: 'available' }],
          notInstalled: [],
        }),
        resolveRuntimeCommand: async () => null,
        resolveRuntimeCommandCandidates: async () => [],
      },
    }));

    const cached = await app.fetch(new Request('http://localhost/api/agent-runtimes/adapter-projections'));
    expect(cached.status).toBe(200);
    expect(createSession).not.toHaveBeenCalled();

    const probed = await app.fetch(new Request('http://localhost/api/agent-runtimes/adapter-projections?handshake=1&force=1'));
    expect(probed.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith('gemini', expect.objectContaining({ cwd: expect.any(String) }));
    expect(closeSession).toHaveBeenCalledWith('ses-gemini');
  });

  it('defaults Codex thread listing and forks to the mind root and rejects malformed fork bodies', async () => {
    const root = makeRoot();
    const listThreads = vi.fn(async () => ({ data: [{ id: 'thr-1' }], nextCursor: null, backwardsCursor: null }));
    const forkThread = vi.fn(async () => ({ thread: { id: 'thr-forked' } }));
    const app = hostApp(makeServices(root, {
      createCodexClient: () => ({
        initialize: async () => undefined,
        listThreads,
        forkThread,
        close: async () => undefined,
      }) as unknown as NonNullable<MindosHttpServices['createCodexClient']> extends () => infer R ? Awaited<R> : never,
    }));

    const list = await app.fetch(new Request('http://localhost/api/agent-runtimes/codex/threads?limit=20'));
    expect(list.status).toBe(200);
    expect(listThreads).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, cwd: root }));

    const explicit = await app.fetch(new Request('http://localhost/api/agent-runtimes/codex/threads?cwd=/elsewhere'));
    expect(explicit.status).toBe(200);
    expect(listThreads).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: '/elsewhere' }));

    const fork = await app.fetch(new Request('http://localhost/api/agent-runtimes/codex/threads/thr-1/fork', { method: 'POST' }));
    expect(fork.status).toBe(200);
    expect(forkThread).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thr-1', cwd: root }));

    const malformed = await app.fetch(new Request('http://localhost/api/agent-runtimes/codex/threads/thr-1/fork', { method: 'POST', body: '{not-json' }));
    expect(malformed.status).toBe(400);
    expect(forkThread).toHaveBeenCalledTimes(1);
  });

  it('prefers the host capability registry and falls back to the product one', async () => {
    const root = makeRoot();
    const hostApp1 = hostApp(makeServices(root, {
      agentCapabilities: {
        kb: () => [{ id: 'kb:read', kind: 'kb-tool', name: 'Read', description: 'Read notes', source: 'mindos', status: 'available', permissionRequired: 'read' }],
      },
    }));
    const hosted = await hostApp1.fetch(new Request('http://localhost/api/agent-capabilities?include=kb'));
    expect(await hosted.json()).toMatchObject({ capabilities: [{ id: 'kb:read' }], sources: [{ id: 'kb', count: 1 }] });

    const product = await hostApp(makeServices(root)).fetch(new Request('http://localhost/api/agent-capabilities?include=kb'));
    expect(await product.json()).toMatchObject({ capabilities: [], sources: [{ id: 'kb', count: 0 }] });
  });
});

describe('route table: MCP, skills and assistants host extensions', () => {
  it('uses host presence probes for agent profiles and blocks installs into absent agents when required', async () => {
    const root = makeRoot();
    const detectAgentPresence = vi.fn((key: string) => key === 'cursor');
    const app = hostApp(makeServices(root, {
      mcpAgents: {
        cursor: { name: 'Cursor', project: null, global: join(root, 'cursor-mcp.json'), key: 'mcpServers' },
        windsurf: { name: 'Windsurf', project: null, global: join(root, 'windsurf-mcp.json'), key: 'mcpServers' },
      },
      mcpAgentServices: { detectAgentPresence, requireAgentPresence: true },
    }));

    const agents = await app.fetch(new Request('http://localhost/api/mcp/agents'));
    expect(agents.status).toBe(200);
    const profiles = (await agents.json()).agents as Array<{ key: string; present: boolean }>;
    expect(profiles.find((agent) => agent.key === 'cursor')?.present).toBe(true);
    expect(profiles.find((agent) => agent.key === 'windsurf')?.present).toBe(false);

    const install = await app.fetch(jsonRequest('http://localhost/api/mcp/install', 'POST', {
      agents: [{ key: 'windsurf', scope: 'global' }],
      transport: 'stdio',
    }));
    const results = (await install.json()).results as Array<{ status: string; message?: string }>;
    expect(results[0]?.status).toBe('error');
    expect(existsSync(join(root, 'windsurf-mcp.json'))).toBe(false);
  });

  it('lets the host decide which agents are eligible for skill linking', async () => {
    const root = makeRoot();
    const listLinkAgents = vi.fn(() => [{ key: 'cursor', name: 'Cursor', mode: 'universal' as const, skillDir: join(root, '.cursor', 'skills') }]);
    const app = hostApp(makeServices(root, { skills: { listLinkAgents } }));
    const res = await app.fetch(new Request('http://localhost/api/skills/matrix'));
    expect(res.status).toBe(200);
    expect(listLinkAgents).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain('cursor');
  });

  it('scaffolds mind-system defaults before listing assistants and tolerates a failing scaffold', async () => {
    const root = makeRoot();
    const ensureMindSystemDefaults = vi.fn((mindRoot: string) => {
      mkdirSync(join(mindRoot, '.mindos', 'assistants'), { recursive: true });
      writeFileSync(join(mindRoot, '.mindos', 'assistants', 'scaffolded.md'), '---\nname: Scaffolded\ndescription: from host\n---\n# Scaffolded\n');
    });
    const ok = await hostApp(makeServices(root, { ensureMindSystemDefaults })).fetch(new Request('http://localhost/api/assistants'));
    expect(ok.status).toBe(200);
    expect(ensureMindSystemDefaults).toHaveBeenCalledWith(root);
    expect(JSON.stringify(await ok.json())).toContain('Scaffolded');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = await hostApp(makeServices(root, { ensureMindSystemDefaults: () => { throw new Error('disk full'); } })).fetch(new Request('http://localhost/api/assistants'));
    expect(failing.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('default assistant upgrade skipped'), 'disk full');
  });
});

describe('route table: settings, embedding, channels, monitoring and automations host extensions', () => {
  it('overrides settings services and provider env from the host', async () => {
    const root = makeRoot();
    const app = hostApp(makeServices(root, {
      settings: {
        readSettings: () => ({ mindRoot: root, ai: { activeProvider: 'p_host01', providers: [{ id: 'p_host01', name: 'Host', protocol: 'openai', apiKey: '', model: 'm', baseUrl: '' }] } }),
        providerEnv: { ids: ['openai'], getApiKeyEnvVar: () => 'HOST_KEY', getApiKeyFromEnv: () => undefined },
        getEmbeddingStatus: () => ({ enabled: true, ready: true, building: false, docCount: 42 }),
      },
      embedding: { defaultLocalModel: 'host/model', localModelOptions: [{ id: 'host/model' }], isLocalModelDownloaded: async () => true },
    }));

    const settings = await app.fetch(new Request('http://localhost/api/settings'));
    expect(settings.status).toBe(200);
    const body = await settings.json();
    expect(body.ai.providers[0]).toMatchObject({ id: 'p_host01', name: 'Host' });
    // Host provider env is keyed by the env var the host declared for each provider.
    expect(body.envOverrides).toHaveProperty('HOST_KEY');

    const embedding = await app.fetch(new Request('http://localhost/api/embedding'));
    expect(await embedding.json()).toMatchObject({ downloaded: true, defaultModel: 'host/model', models: [{ id: 'host/model' }] });
  });

  it('serves IM status, activity, OAuth and long-connection routes through host channel services', async () => {
    const root = makeRoot();
    const feishu = {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: { enabled: true, encrypt_key: 'k', public_base_url: 'https://mindos.example.com/' },
    };
    const startFeishuWSClient = vi.fn(async () => undefined);
    const app = hostApp(makeServices(root, {
      channels: {
        hasAnyIMConfig: () => true,
        listConfiguredIM: async () => [{ platform: 'feishu', connected: false, capabilities: ['text'] }],
        getPlatformConfig: () => feishu,
        readConfig: () => ({ providers: { feishu } }),
        writeConfig: () => undefined,
        getActivities: () => [{ id: '1', platform: 'feishu', type: 'test', status: 'success', recipient: 'ou_1', messageSummary: 'hi', timestamp: 'now' }],
        startFeishuWSClient,
        getFeishuWSClientStatus: () => ({ running: false }),
      },
    }));

    const status = await app.fetch(new Request('http://localhost/api/im/status'));
    expect(await status.json()).toMatchObject({ platforms: [{ platform: 'feishu', webhook: { state: 'ready', webhookUrl: 'https://mindos.example.com/api/im/webhook/feishu' } }] });

    const activity = await app.fetch(new Request('http://localhost/api/im/activity?platform=feishu&limit=500'));
    expect(await activity.json()).toEqual({ activities: [expect.objectContaining({ id: '1' })] });

    const oauth = await app.fetch(new Request('http://127.0.0.1:4599/api/im/feishu/oauth'));
    expect(oauth.status).toBe(200);
    expect(await oauth.json()).toMatchObject({ ok: true, redirectUri: 'http://127.0.0.1:4599/api/im/feishu/oauth/callback' });

    const start = await app.fetch(new Request('http://localhost/api/im/feishu/long-connection', { method: 'POST' }));
    expect(start.status).toBe(200);
    expect(startFeishuWSClient).toHaveBeenCalledTimes(1);

    const invalid = await app.fetch(new Request('http://localhost/api/im/activity?platform=bad'));
    expect(invalid.status).toBe(400);
  });

  it('uses host metrics for monitoring and honours the studio automation home override', async () => {
    const root = makeRoot();
    const metricsSnapshot = vi.fn(() => ({
      processStartTime: Date.now() - 1000,
      agentRequests: 7,
      toolExecutions: 2,
      totalTokens: { input: 10, output: 5 },
      avgResponseTimeMs: 1,
      errors: 0,
    }));
    const app = hostApp(makeServices(root, { monitoring: { metricsSnapshot } }));
    const res = await app.fetch(new Request('http://localhost/api/monitoring'));
    expect(res.status).toBe(200);
    expect(metricsSnapshot).toHaveBeenCalledTimes(1);
    expect((await res.json()).application).toMatchObject({ agentRequests: 7, toolExecutions: 2 });

    const legacyHome = makeRoot('mindos-automation-home-');
    mkdirSync(join(legacyHome, '.mindos'), { recursive: true });
    writeFileSync(join(legacyHome, '.mindos', 'schedule-prompts.json'), JSON.stringify({ jobs: [] }));
    const prev = process.env.MINDOS_STUDIO_AUTOMATION_HOME;
    process.env.MINDOS_STUDIO_AUTOMATION_HOME = legacyHome;
    cleanups.push(() => {
      if (prev === undefined) delete process.env.MINDOS_STUDIO_AUTOMATION_HOME;
      else process.env.MINDOS_STUDIO_AUTOMATION_HOME = prev;
    });
    const automations = await app.fetch(new Request('http://localhost/api/studio/automations'));
    expect(automations.status).toBe(200);
  });
});
