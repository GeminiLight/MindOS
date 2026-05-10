import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORS_HEADERS,
  createDefaultMindosHttpServices,
  createMindosHttpServer,
  handleA2aAgentsGet,
  handleA2aDelegationsGet,
  handleA2aDiscoverPost,
  handleA2aOptions,
  handleA2aPost,
  handleAcpConfigDelete,
  handleAcpConfigGet,
  handleAcpConfigPost,
  handleAcpDetectGet,
  handleAcpInstallPost,
  handleAcpRegistryGet,
  handleAcpSessionDelete,
  handleAcpSessionGet,
  handleAcpSessionPost,
  resolveNpmInvocation,
  handleAskSessionsDelete,
  handleAskSessionsGet,
  handleAskSessionsPost,
  handleFiles,
  handleFileGet,
  handleFilePost,
  handleBacklinks,
  handleBootstrapGet,
  handleChannelsVerifyPost,
  handleConnectGet,
  handleGit,
  handleGraph,
  handleAskStream,
  handleAgentActivity,
  handleAgentCopySkillPost,
  handleCustomAgentDetectPost,
  handleCustomAgentsDelete,
  handleCustomAgentsPost,
  handleCustomAgentsPut,
  handleEmbeddingGet,
  handleEmbeddingPost,
  handleInboxDelete,
  handleImActivityGet,
  handleImConfigDelete,
  handleImConfigGet,
  handleImConfigPut,
  handleImFeishuLongConnectionDelete,
  handleImFeishuLongConnectionGet,
  handleImFeishuLongConnectionPost,
  handleImStatusGet,
  handleImTestPost,
  handleImWebhookStatusGet,
  handleInboxGet,
  handleInboxPost,
  handleInitPost,
  handleChangesGet,
  handleChangesPost,
  handleStaticArtifact,
  handleMcpStatus,
  handleMcpAgentsGet,
  handleMcpInstallPost,
  handleMcpInstallSkillPost,
  resolveNpxInvocation,
  findMcpProcessIdsByPort,
  handleMcpRestartPost,
  handleMcpUninstallPost,
  parseNetstatListeningPids,
  handleMcpDirectToolsPost,
  handleMcpToolsGet,
  handleRawFile,
  handleRecentFiles,
  handleSettingsGet,
  handleSettingsListModelsPost,
  handleSettingsPost,
  handleSettingsResetTokenPost,
  handleSettingsTestKeyPost,
  handleSkillsGet,
  handleSkillsPost,
  handleSpaceOverviewGet,
  handleSyncGet,
  handleSyncPost,
  handleSearch,
  handleSearchPrewarm,
  handleSetupCheckPath,
  handleSetupCheckPort,
  handleSetupGenerateToken,
  handleSetupListDirectories,
  handleMonitoringGet,
  handleRestartPost,
  handleUninstallPost,
  handleUpdateCheckGet,
  handleUpdatePost,
  handleUpdateStatusGet,
  handleWorkflowsGet,
  handleWorkflowsPost,
  createMindosHealth,
  collectAllFilesFromMindRoot,
  getDefaultMindRoot,
  getMindosServerContract,
  getRecentlyModifiedFromMindRoot,
  getTreeVersionFromMindRoot,
  handleTreeVersion,
  searchMindRoot,
  readMindosProductVersion,
  type MindosSkillsSettings,
  type CustomAgentSettings,
  type MindosCustomMcpAgentDef,
  type MindosMcpAgentDef,
  type MindosMcpAgentRegistryDef,
} from './server.js';

describe('MindOS product server contract', () => {
  it('exposes stable route metadata owned by the product runtime', () => {
    const contract = getMindosServerContract();

    expect(contract.service).toBe('mindos');
    expect(contract.routes).toContainEqual({
      id: 'health',
      method: 'GET',
      path: '/api/health',
      auth: 'public',
    });
    expect(contract.routes).toContainEqual({
      id: 'files',
      method: 'GET',
      path: '/api/files',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'recent-files',
      method: 'GET',
      path: '/api/recent-files',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'tree-version',
      method: 'GET',
      path: '/api/tree-version',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'file.read',
      method: 'GET',
      path: '/api/file',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'file.write',
      method: 'POST',
      path: '/api/file',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'file.raw',
      method: 'GET',
      path: '/api/file/raw',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'search',
      method: 'GET',
      path: '/api/search',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'search.prewarm',
      method: 'GET',
      path: '/api/search/prewarm',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'ask.stream',
      method: 'POST',
      path: '/api/ask',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'ask-sessions',
      method: 'GET',
      path: '/api/ask-sessions',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'ask-sessions.save',
      method: 'POST',
      path: '/api/ask-sessions',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'ask-sessions.delete',
      method: 'DELETE',
      path: '/api/ask-sessions',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'space-overview',
      method: 'GET',
      path: '/api/space-overview',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'git',
      method: 'GET',
      path: '/api/git',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'inbox',
      method: 'GET',
      path: '/api/inbox',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'inbox.save',
      method: 'POST',
      path: '/api/inbox',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'inbox.archive',
      method: 'DELETE',
      path: '/api/inbox',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'setup.check-path',
      method: 'POST',
      path: '/api/setup/check-path',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'setup.ls',
      method: 'POST',
      path: '/api/setup/ls',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'settings.update',
      method: 'POST',
      path: '/api/settings',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'settings.reset-token',
      method: 'POST',
      path: '/api/settings/reset-token',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.status',
      method: 'GET',
      path: '/api/mcp/status',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.tools',
      method: 'GET',
      path: '/api/mcp/tools',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.direct-tools',
      method: 'POST',
      path: '/api/mcp/direct-tools',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.install',
      method: 'POST',
      path: '/api/mcp/install',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.install-skill',
      method: 'POST',
      path: '/api/mcp/install-skill',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.restart',
      method: 'POST',
      path: '/api/mcp/restart',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.uninstall',
      method: 'POST',
      path: '/api/mcp/uninstall',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'skills',
      method: 'GET',
      path: '/api/skills',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'skills.action',
      method: 'POST',
      path: '/api/skills',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'changes',
      method: 'GET',
      path: '/api/changes',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'changes.mark-seen',
      method: 'POST',
      path: '/api/changes',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'backlinks',
      method: 'GET',
      path: '/api/backlinks',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'graph',
      method: 'GET',
      path: '/api/graph',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-activity',
      method: 'GET',
      path: '/api/agent-activity',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'bootstrap',
      method: 'GET',
      path: '/api/bootstrap',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'connect',
      method: 'GET',
      path: '/api/connect',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'monitoring',
      method: 'GET',
      path: '/api/monitoring',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'update-status',
      method: 'GET',
      path: '/api/update-status',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'update-check',
      method: 'GET',
      path: '/api/update-check',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'setup.check-port',
      method: 'POST',
      path: '/api/setup/check-port',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'setup.generate-token',
      method: 'POST',
      path: '/api/setup/generate-token',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'workflows',
      method: 'GET',
      path: '/api/workflows',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'workflows.create',
      method: 'POST',
      path: '/api/workflows',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agents.custom.create',
      method: 'POST',
      path: '/api/agents/custom',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agents.custom.detect',
      method: 'POST',
      path: '/api/agents/custom/detect',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agents.copy-skill',
      method: 'POST',
      path: '/api/agents/copy-skill',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'mcp.agents',
      method: 'GET',
      path: '/api/mcp/agents',
      auth: 'required',
    });
  });

  it('creates a health payload with runtime metadata', () => {
    const health = createMindosHealth({
      version: '1.2.3',
      authRequired: true,
      runtimeRoot: '/tmp/mindos-runtime',
    });

    expect(health).toMatchObject({
      ok: true,
      service: 'mindos',
      version: '1.2.3',
      authRequired: true,
      runtime: {
        platform: process.platform,
        arch: process.arch,
        root: '/tmp/mindos-runtime',
      },
    });
  });

  it('resolves product version from explicit env, repo root, or installed package root', () => {
    expect(readMindosProductVersion({ env: { npm_package_version: '9.9.9' } })).toBe('9.9.9');

    const root = mkdtempSync(join(tmpdir(), 'mindos-server-contract-'));
    mkdirSync(join(root, 'packages', 'mindos'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'mindos', 'package.json'),
      JSON.stringify({ name: '@geminilight/mindos', version: '2.0.0' }),
    );
    expect(readMindosProductVersion({ projectRoot: root, env: {} })).toBe('2.0.0');

    const installed = mkdtempSync(join(tmpdir(), 'mindos-installed-contract-'));
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({ name: '@geminilight/mindos', version: '3.0.0' }),
    );
    expect(readMindosProductVersion({ cwd: installed, env: {} })).toBe('3.0.0');
  });

  it('keeps CORS public for health discovery', () => {
    expect(CORS_HEADERS).toEqual({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    });
  });

  it('handles files route pagination and cache headers without Web dependencies', () => {
    const res = handleFiles(new URLSearchParams('limit=2&offset=1'), {
      collectAllFiles: () => ['a.md', 'b.md', 'c.csv'],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      files: ['b.md', 'c.csv'],
      total: 3,
      offset: 1,
      limit: 2,
    });
    expect(res.headers?.['Cache-Control']).toBe('public, max-age=60');
    expect(res.headers?.ETag).toMatch(/^"[a-f0-9]{40}"$/);
  });

  it('collects files and recently modified files from a mind root without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-runtime-files-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, 'a.md'), 'a');
    writeFileSync(join(root, 'Space', 'b.csv'), 'b');
    writeFileSync(join(root, '.git', 'ignored.md'), 'ignored');
    writeFileSync(join(root, 'ignored.txt'), 'ignored');

    expect(collectAllFilesFromMindRoot(root)).toEqual(['a.md', 'Space/b.csv']);
    expect(getRecentlyModifiedFromMindRoot(root, 1)).toHaveLength(1);
    expect(getTreeVersionFromMindRoot(root)).toBeGreaterThan(0);
    expect(getTreeVersionFromMindRoot(join(root, 'missing'))).toBe(0);
  });

  it('resolves mind root from product config before env fallback', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-runtime-home-'));
    const configuredRoot = join(home, 'ConfiguredMind');
    mkdirSync(join(home, '.mindos'), { recursive: true });
    writeFileSync(join(home, '.mindos', 'config.json'), JSON.stringify({ mindRoot: configuredRoot }));

    expect(getDefaultMindRoot({
      homeDir: home,
      env: { MIND_ROOT: join(home, 'EnvMind') } as NodeJS.ProcessEnv,
    })).toBe(configuredRoot);
  });

  it('searches text files from a mind root without Web dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-runtime-search-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'Space', 'note.md'), 'Alpha project\nBeta detail');
    writeFileSync(join(root, 'data.csv'), 'name,value\nalpha,1');
    writeFileSync(join(root, 'image.png'), Buffer.from('alpha'));

    const results = await searchMindRoot(root, 'alpha', { limit: 10 });

    expect(results.map((item) => item.path)).toEqual(['Space/note.md', 'data.csv']);
    expect(results[0]).toMatchObject({
      path: 'Space/note.md',
      score: expect.any(Number),
      snippet: expect.stringContaining('Alpha project'),
    });
  });

  it('handles recent files and file read operations from product handlers', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-handler-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'Space', 'note.md'), 'one\ntwo');

    const services = createDefaultMindosHttpServices({
      readSettings: () => ({ mindRoot: root }),
    });

    expect(handleRecentFiles(new URLSearchParams('limit=3'), services).status).toBe(200);
    expect(handleFileGet(new URLSearchParams('op=list_spaces'), services).body).toEqual({
      spaces: [expect.objectContaining({ name: 'Space', path: 'Space', fileCount: 1 })],
    });
    expect(handleFileGet(new URLSearchParams('op=read_file&path=Space/note.md'), services).body).toEqual({ content: 'one\ntwo' });
    expect(handleFileGet(new URLSearchParams('op=read_lines&path=Space/note.md'), services).body).toEqual({ lines: ['one', 'two'] });
    expect(handleFileGet(new URLSearchParams('op=read_file&path=../secret.md'), services)).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('serves detailed spaces from the Product Server file handler when mindRoot is available', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-spaces-detail-'));
    mkdirSync(join(root, 'SpaceA'), { recursive: true });
    writeFileSync(join(root, 'SpaceA', 'README.md'), '# Space A\n\nReadable description.\n', 'utf-8');
    writeFileSync(join(root, 'SpaceA', 'note.md'), 'hello', 'utf-8');

    const res = handleFileGet(new URLSearchParams('op=list_spaces'), {
      mindRoot: root,
      readTextFile: () => '',
      readLines: () => [],
      listSpaces: () => [],
      listDirectories: () => [],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      spaces: [expect.objectContaining({
        name: 'SpaceA',
        path: 'SpaceA',
        fileCount: 2,
        description: 'Readable description.',
      })],
    });
  });

  it('checks upload filename conflicts in the Product Server file handler', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-conflicts-'));
    mkdirSync(join(root, 'Inbox'), { recursive: true });
    writeFileSync(join(root, 'Inbox', 'hello.md'), 'existing', 'utf-8');

    const res = handleFileGet(new URLSearchParams('op=check_conflicts&space=Inbox&names=hello.md,other.txt'), {
      mindRoot: root,
      readTextFile: () => '',
      readLines: () => [],
      listSpaces: () => [],
      listDirectories: () => [],
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conflicts: ['hello.md'] });
  });

  it('runs Product Server file write operations through knowledge operation guardrails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-ops-'));
    writeFileSync(join(root, 'note.md'), 'a\nb\nc', 'utf-8');

    const denied = await handleFilePost(
      { op: 'save_file', path: 'INSTRUCTION.md', content: 'nope' },
      { mindRoot: root },
      { agentHeader: 'codex', protectedRootFiles: ['INSTRUCTION.md'] },
    );
    expect(denied.status).toBe(403);

    const updated = await handleFilePost({ op: 'update_lines', path: 'note.md', start: 1, end: 1, lines: ['B'] }, { mindRoot: root });
    expect(updated.status).toBe(200);
    expect(readFileSync(join(root, 'note.md'), 'utf-8')).toBe('a\nB\nc');

    const deleted = await handleFilePost({ op: 'delete_file', path: 'note.md' }, { mindRoot: root });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ ok: true, trashId: expect.any(String) });
    expect(existsSync(join(root, 'note.md'))).toBe(false);
    expect(existsSync(join(root, '..', '.trash', (deleted.body as { trashId: string }).trashId))).toBe(true);
  });

  it('rejects unsafe rename leaf names in Product Server file operations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-rename-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'note.md'), 'content', 'utf-8');

    const fileRename = await handleFilePost({ op: 'rename_file', path: 'note.md', new_name: '..' }, { mindRoot: root });
    expect(fileRename.status).toBe(400);
    expect(existsSync(join(root, 'note.md'))).toBe(true);

    const spaceRename = await handleFilePost({ op: 'rename_space', path: 'Space', new_name: '.' }, { mindRoot: root });
    expect(spaceRename.status).toBe(400);
    expect(existsSync(join(root, 'Space'))).toBe(true);
  });

  it('serves foundational APIs through the product HTTP server', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-server-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'Space', 'note.md'), 'hello');
    writeFileSync(join(root, 'image.png'), Buffer.from('png'));

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtimeRoot: '/runtime',
      services: createDefaultMindosHttpServices({
        runtimeRoot: '/runtime',
        homeDir: root,
        readSettings: () => ({ mindRoot: root }),
      }),
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, service: 'mindos' });
      expect(await (await fetch(`${base}/api/files?limit=10`)).json()).toMatchObject({ files: ['image.png', 'Space/note.md'] });
      expect(await (await fetch(`${base}/api/search?q=hello`)).json()).toMatchObject([{ path: 'Space/note.md' }]);
      expect(await (await fetch(`${base}/api/search/prewarm`)).json()).toMatchObject({
        warmed: true,
        documentCount: 2,
        core: { fileCount: 2 },
      });
      expect(await (await fetch(`${base}/api/recent-files?limit=1`)).json()).toHaveLength(1);
      expect(await (await fetch(`${base}/api/tree-version`)).json()).toMatchObject({ v: expect.any(Number) });
      expect(await (await fetch(`${base}/api/skills`)).json()).toMatchObject({ skills: expect.any(Array) });
      expect(await (await fetch(`${base}/api/mcp/tools`)).json()).toEqual({ servers: [] });
      expect(await (await fetch(`${base}/api/changes?op=summary`)).json()).toMatchObject({ unreadCount: 0 });
      expect(await (await fetch(`${base}/api/backlinks?path=Space/note.md`)).json()).toEqual([]);
      expect(await (await fetch(`${base}/api/graph`)).json()).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) });
      expect(await (await fetch(`${base}/api/agent-activity`)).json()).toMatchObject({ events: expect.any(Array) });
      expect(await (await fetch(`${base}/api/bootstrap`)).json()).toMatchObject({
        file_index: expect.stringContaining('Space/'),
      });
      expect(await (await fetch(`${base}/api/connect`)).json()).toMatchObject({
        url: expect.any(String),
        ip: expect.any(String),
        port: expect.any(Number),
        hostname: expect.any(String),
      });
      expect(await (await fetch(`${base}/api/monitoring`)).json()).toMatchObject({
        system: { nodeVersion: expect.any(String) },
        knowledgeBase: { root, fileCount: expect.any(Number) },
      });
      expect(await (await fetch(`${base}/api/update-status`)).json()).toMatchObject({ stage: 'idle' });
      expect(await (await fetch(`${base}/api/setup/generate-token`, {
        method: 'POST',
        body: JSON.stringify({ seed: 'abc' }),
      })).json()).toEqual({ token: 'ba78-16bf-8f01-cfea-4141-40de' });
      expect(await (await fetch(`${base}/api/workflows`)).json()).toEqual({ workflows: [] });
      expect(await (await fetch(`${base}/api/ask-sessions`)).json()).toEqual([]);
      expect(await (await fetch(`${base}/api/space-overview?space=Space`)).json()).toEqual({ fileCount: 1 });
      expect(await (await fetch(`${base}/api/git?op=is_repo`)).json()).toEqual({ isRepo: false });
      expect(await (await fetch(`${base}/api/inbox`)).json()).toMatchObject({ files: expect.any(Array) });
      expect(await (await fetch(`${base}/api/setup/check-path`, {
        method: 'POST',
        body: JSON.stringify({ path: root }),
      })).json()).toMatchObject({ exists: true, unsafe: false });
      expect(await (await fetch(`${base}/api/setup/ls`, {
        method: 'POST',
        body: JSON.stringify({ path: root }),
      })).json()).toMatchObject({ dirs: ['Inbox', 'Space'] });
      expect(await (await fetch(`${base}/api/file?path=Space/note.md`)).json()).toEqual({ content: 'hello' });
      expect(await (await fetch(`${base}/api/file/raw?path=image.png`)).arrayBuffer()).toHaveProperty('byteLength', 3);
      expect((await fetch(`${base}/missing`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('protects external Product Server API requests with the configured bearer token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-auth-'));
    writeFileSync(join(root, 'note.md'), 'hello');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtime: { readSettings: () => ({ mindRoot: root, authToken: 'secret-token' }) },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
      expect((await fetch(`${base}/api/files`)).status).toBe(401);
      expect((await fetch(`${base}/api/files`, {
        headers: { authorization: 'Bearer wrong' },
      })).status).toBe(401);
      expect((await fetch(`${base}/api/files`, {
        headers: { authorization: 'Bearer secret-token' },
      })).status).toBe(200);
      expect((await fetch(`${base}/api/files`, {
        headers: { 'sec-fetch-site': 'same-origin' },
      })).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves every Product Server route declared in the runtime contract', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-contract-routes-'));
    writeFileSync(join(root, 'note.md'), 'hello');
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      services: createDefaultMindosHttpServices({
        readSettings: () => ({
          mindRoot: root,
          ai: { activeProvider: '', providers: [] },
          authToken: 'secret-token',
        }),
      }),
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(`${base}/api/settings`, {
        headers: { authorization: 'Bearer secret-token' },
      })).status).toBe(200);
      expect((await fetch(`${base}/api/mcp/status`, {
        headers: { authorization: 'Bearer secret-token' },
      })).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('supports Product Server file writes in the static Web runtime path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-file-write-'));
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtime: { readSettings: () => ({ mindRoot: root }) },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const created = await fetch(`${base}/api/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ op: 'create_file', path: 'Space/note.md', content: 'hello' }),
      });
      expect(created.status).toBe(200);
      expect(await created.json()).toMatchObject({ ok: true });
      expect(readFileSync(join(root, 'Space', 'note.md'), 'utf-8')).toBe('hello');

      const saved = await fetch(`${base}/api/file`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ op: 'save_file', path: 'Space/note.md', content: 'updated' }),
      });
      expect(saved.status).toBe(200);
      expect(readFileSync(join(root, 'Space', 'note.md'), 'utf-8')).toBe('updated');
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves raw files with MIME headers and range support', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-raw-file-'));
    writeFileSync(join(root, 'clip.mp3'), Buffer.from('abcdef'));

    const full = handleRawFile(new URLSearchParams('path=clip.mp3'), { mindRoot: root });
    expect(full.status).toBe(200);
    expect(Buffer.isBuffer(full.body)).toBe(true);
    expect(full.body?.toString()).toBe('abcdef');
    expect(full.headers).toMatchObject({
      'Content-Type': 'audio/mpeg',
      'Content-Length': '6',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=60',
    });

    const partial = handleRawFile(new URLSearchParams('path=clip.mp3'), { mindRoot: root }, { range: 'bytes=1-3' });
    expect(partial.status).toBe(206);
    expect(partial.body?.toString()).toBe('bcd');
    expect(partial.headers).toMatchObject({
      'Content-Range': 'bytes 1-3/6',
      'Content-Length': '3',
    });
  });

  it('rejects raw file traversal and unsupported types', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-raw-file-errors-'));
    expect(handleRawFile(new URLSearchParams(), { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'Missing path parameter' },
    });
    expect(handleRawFile(new URLSearchParams('path=note.md'), { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'Unsupported binary file type: .md' },
    });
    expect(handleRawFile(new URLSearchParams('path=../secret.pdf'), { mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('handles search empty query and delegates non-empty query to injected services', async () => {
    const empty = await handleSearch(new URLSearchParams('q='), {
      search: async () => {
        throw new Error('should not search empty query');
      },
    });
    expect(empty).toEqual({ status: 200, body: [] });

    const found = await handleSearch(new URLSearchParams('q=hello'), {
      search: async (query, options) => [{ path: 'hello.md', query, limit: options.limit }],
    });
    expect(found.status).toBe(200);
    expect(found.body).toEqual([{ path: 'hello.md', query: 'hello', limit: 20 }]);
    expect(found.headers?.['Cache-Control']).toBe('private, max-age=300');
  });

  it('handles search prewarm from product file collection services', () => {
    const res = handleSearchPrewarm({
      collectAllFiles: () => ['note.md', 'data.csv', 'image.png'],
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      warmed: true,
      cacheState: 'built',
      documentCount: 3,
      core: {
        cacheState: 'built',
        fileCount: 3,
      },
    });
    const injected = handleSearchPrewarm({
      collectAllFiles: () => {
        throw new Error('should use injected prewarm payload');
      },
      prewarmSearch: () => ({
        warmed: true,
        cacheState: 'hit',
        documentCount: 2,
        core: { cacheState: 'built', fileCount: 2 },
      }),
    });
    expect(injected.body).toMatchObject({
      cacheState: 'hit',
      core: { cacheState: 'built', fileCount: 2 },
    });
  });

  it('lists skills from product-owned skill directories without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-skills-'));
    const builtinRoot = join(root, 'skills');
    const userRoot = join(root, 'mind', '.skills');
    mkdirSync(join(builtinRoot, 'mindos'), { recursive: true });
    mkdirSync(join(userRoot, 'custom-skill'), { recursive: true });
    writeFileSync(join(builtinRoot, 'mindos', 'SKILL.md'), '---\nname: mindos\ndescription: Builtin skill\n---\n');
    writeFileSync(join(userRoot, 'custom-skill', 'SKILL.md'), '---\nname: custom-skill\ndescription: User skill\n---\n');

    const res = handleSkillsGet({
      disabledSkills: ['mindos'],
      skillRoots: [
        { path: builtinRoot, source: 'builtin', origin: 'project-builtin', editable: false },
        { path: userRoot, source: 'user', origin: 'mindos-user', editable: true },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([
      expect.objectContaining({ name: 'custom-skill', description: 'User skill', source: 'user', enabled: true, editable: true }),
      expect.objectContaining({ name: 'mindos', description: 'Builtin skill', source: 'builtin', enabled: false, editable: false }),
    ]);
  });

  it('handles skill writes and reads from the product runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-skill-post-'));
    const mindRoot = join(root, 'mind');
    const builtinRoot = join(root, 'skills');
    const userRoot = join(mindRoot, '.skills');
    mkdirSync(join(builtinRoot, 'builtin-skill'), { recursive: true });
    writeFileSync(join(builtinRoot, 'builtin-skill', 'SKILL.md'), '---\nname: builtin-skill\ndescription: Builtin\n---\n');

    let settings: MindosSkillsSettings = { disabledSkills: [] };
    const services = {
      mindRoot,
      skillRoots: [
        { path: builtinRoot, source: 'builtin' as const, origin: 'project-builtin' as const, editable: false },
        { path: userRoot, source: 'user' as const, origin: 'mindos-user' as const, editable: true },
      ],
      readSettings: () => settings,
      writeSettings: (next: typeof settings) => { settings = next; },
    };

    expect(handleSkillsPost({ action: 'create', name: '../../../etc/passwd' }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringMatching(/Invalid skill name/) },
    });
    expect(handleSkillsPost({ action: 'create', name: 'builtin-skill' }, services)).toMatchObject({
      status: 409,
      body: { error: 'A built-in skill with this name already exists' },
    });
    expect(handleSkillsPost({ action: 'create', name: 'user-skill', description: 'User skill' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(readFileSync(join(userRoot, 'user-skill', 'SKILL.md'), 'utf-8')).toContain('description: User skill');

    expect(handleSkillsPost({
      action: 'update',
      name: 'user-skill',
      content: '---\nname: user-skill\ndescription: Updated\n---\n\nBody',
    }, services)).toMatchObject({ status: 200, body: { ok: true } });
    expect(handleSkillsPost({ action: 'read', name: 'user-skill' }, services)).toMatchObject({
      status: 200,
      body: { content: expect.stringContaining('Updated') },
    });

    expect(handleSkillsPost({ action: 'toggle', name: 'user-skill', enabled: false }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(settings.disabledSkills).toContain('user-skill');

    expect(handleSkillsPost({ action: 'record-install', name: 'user-skill', agentKey: 'codex', installPath: '/tmp/skill' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(settings.installedSkillAgents).toEqual([{ agent: 'codex', skill: 'user-skill', path: '/tmp/skill' }]);

    expect(handleSkillsPost({ action: 'delete', name: 'user-skill' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });

  it('resets auth tokens from the product runtime', () => {
    let settings = { ai: {}, authToken: 'old-token' };
    const response = handleSettingsResetTokenPost({
      readSettings: () => settings,
      writeSettings: (next) => { settings = next; },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, token: expect.stringMatching(/^[a-f0-9]{4}(-[a-f0-9]{4}){5}$/) });
    expect(settings.authToken).toBe(response.body.token);
  });

  it('handles custom agent create, update, and delete from the product runtime', () => {
    let settings: CustomAgentSettings = { customAgents: [] };
    const services = {
      readSettings: () => settings,
      writeSettings: (next: CustomAgentSettings) => { settings = next; },
      builtInAgentKeys: ['mindos', 'codex'],
    };

    expect(handleCustomAgentsPost({ name: '', baseDir: '~/.qclaw/' }, services)).toMatchObject({
      status: 400,
      body: { error: 'name and baseDir are required' },
    });
    expect(handleCustomAgentsPost({ name: 'Codex', baseDir: '~/.codex/', key: 'codex' }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('Conflicts with built-in agent') },
    });

    const created = handleCustomAgentsPost({ name: 'QClaw Local', baseDir: '~/.qclaw/' }, services);
    expect(created).toMatchObject({
      status: 201,
      body: {
        agent: {
          key: 'qclaw-local',
          global: '~/.qclaw/mcp.json',
          skillDir: '~/.qclaw/skills/',
        },
      },
    });
    expect(settings.customAgents).toEqual([expect.objectContaining({ key: 'qclaw-local' })]);

    expect(handleCustomAgentsPut({
      key: 'qclaw-local',
      baseDir: '~/.qclaw-next/',
      preferredTransport: 'http',
      presenceCli: '',
    }, services)).toMatchObject({
      status: 200,
      body: {
        agent: {
          baseDir: '~/.qclaw-next/',
          preferredTransport: 'http',
          presenceDirs: ['~/.qclaw-next/'],
          skillDir: '~/.qclaw-next/skills/',
        },
      },
    });

    expect(handleCustomAgentsDelete({ key: 'qclaw-local' }, services)).toMatchObject({
      status: 200,
      body: { removed: 'qclaw-local' },
    });
    expect(settings.customAgents).toEqual([]);
  });

  it('detects custom agent configs and copies skills from product handlers', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-agent-home-'));
    const agentRoot = join(home, '.qclaw');
    mkdirSync(join(agentRoot, 'skills', 'agent-skill'), { recursive: true });
    writeFileSync(join(agentRoot, 'mcp.json'), JSON.stringify({
      mcpServers: {
        mindos: { command: 'mindos' },
      },
    }));

    expect(handleCustomAgentDetectPost({ baseDir: '~/.qclaw/' }, { homeDir: home })).toMatchObject({
      status: 200,
      body: {
        exists: true,
        detectedConfig: '~/.qclaw/mcp.json',
        detectedConfigKey: 'mcpServers',
        mcpServers: ['mindos'],
        skillNames: ['agent-skill'],
      },
    });
    expect(handleCustomAgentDetectPost({ baseDir: '/tmp/qclaw' }, { homeDir: home })).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('baseDir must start with ~/') },
    });

    const skillRoot = join(home, 'mindos-skills');
    mkdirSync(join(skillRoot, 'mindos'), { recursive: true });
    writeFileSync(join(skillRoot, 'mindos', 'SKILL.md'), '# MindOS');
    const targetRoot = join(home, 'target-skills');

    await expect(handleAgentCopySkillPost({
      skillName: '../mindos',
      targetPath: targetRoot,
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid skill name' },
    });

    await expect(handleAgentCopySkillPost({
      skillName: 'mindos',
      targetPath: targetRoot,
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 200,
      body: { success: true, skillName: 'mindos', targetPath: join(targetRoot, 'mindos') },
    });
    expect(existsSync(join(targetRoot, 'mindos', 'SKILL.md'))).toBe(true);
  });

  it('installs and uninstalls MCP config entries from the product runtime', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-install-'));
    const agents: Record<string, MindosMcpAgentDef> = {
      codex: {
        name: 'Codex',
        project: null,
        global: '~/.codex/config.toml',
        key: 'mcp_servers',
        format: 'toml',
        preferredTransport: 'stdio',
      },
      copaw: {
        name: 'CoPaw',
        project: null,
        global: '~/.copaw/config.json',
        key: 'mcp',
        globalNestedKey: 'mcp.clients',
        preferredTransport: 'stdio',
      },
    };

    await expect(handleMcpInstallPost({
      agents: [{ key: 'missing', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home })).resolves.toMatchObject({
      status: 200,
      body: { results: [{ agent: 'missing', status: 'error', message: 'Unknown agent: missing' }] },
    });

    await expect(handleMcpInstallPost({
      agents: [{ key: 'codex', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home })).resolves.toMatchObject({
      status: 200,
      body: { results: [{ agent: 'codex', status: 'ok', path: '~/.codex/config.toml', transport: 'stdio' }] },
    });
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf-8')).toContain('[mcp_servers.mindos]');

    await expect(handleMcpInstallPost({
      agents: [{ key: 'copaw', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home })).resolves.toMatchObject({
      status: 200,
      body: { results: [{ agent: 'copaw', status: 'ok' }] },
    });
    const copawConfig = JSON.parse(readFileSync(join(home, '.copaw', 'config.json'), 'utf-8'));
    expect(copawConfig.mcp.clients.mindos).toMatchObject({ type: 'stdio', command: 'mindos' });

    expect(handleMcpUninstallPost({
      agents: [{ key: 'copaw', scope: 'global' }],
    }, { agents, homeDir: home })).toMatchObject({
      status: 200,
      body: { results: [{ agent: 'copaw', status: 'ok', path: '~/.copaw/config.json' }] },
    });
    const afterUninstall = JSON.parse(readFileSync(join(home, '.copaw', 'config.json'), 'utf-8'));
    expect(afterUninstall.mcp.clients.mindos).toBeUndefined();
  });

  it('lists MCP tools and updates direct tool exposure from product handlers', () => {
    let directTools: boolean | string[] = false;
    const tools = handleMcpToolsGet({
      readMcpConfig: () => ({
        mcpServers: {
          github: { lifecycle: 'keep-alive', directTools },
          docs: {},
        },
      }),
      readMcpToolCache: () => ({
        github: {
          tools: [
            { name: 'search', description: 'Search issues' },
            { name: 'read' },
          ],
        },
      }),
    });

    expect(tools).toMatchObject({
      status: 200,
      body: {
        servers: [
          {
            name: 'github',
            toolCount: 2,
            directTools: false,
            lifecycle: 'keep-alive',
            cached: true,
          },
          {
            name: 'docs',
            toolCount: 0,
            directTools: false,
            lifecycle: 'lazy',
            cached: false,
          },
        ],
      },
    });

    expect(handleMcpDirectToolsPost({ directTools: true }, {
      updateServerDirectTools: () => {
        throw new Error('should not update invalid request');
      },
    })).toMatchObject({
      status: 400,
      body: { error: 'Missing or invalid "server" field' },
    });

    expect(handleMcpDirectToolsPost({ server: 'github', directTools: ['search'] }, {
      updateServerDirectTools: (_server, next) => { directTools = next; },
    })).toMatchObject({
      status: 200,
      body: { ok: true, server: 'github', directTools: ['search'] },
    });
    expect(directTools).toEqual(['search']);
  });

  it('aggregates MCP agent discovery through the product runtime handler', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-agents-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-agents-root-'));
    mkdirSync(join(home, '.mindos'), { recursive: true });
    mkdirSync(join(home, '.custom', 'skills', 'mindos'), { recursive: true });
    writeFileSync(join(home, '.mindos', 'mcp.json'), JSON.stringify({
      mcpServers: { filesystem: {}, github: {} },
    }));
    writeFileSync(join(home, '.custom', 'mcp.json'), JSON.stringify({
      mcpServers: { mindos: {}, search: {} },
    }));

    const agents: Record<string, MindosMcpAgentRegistryDef> = {
      mindos: {
        name: 'MindOS',
        project: null,
        global: '~/.mindos/mcp.json',
        key: 'mcpServers',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.mindos/'],
      },
      'claude-code': {
        name: 'Claude Code',
        project: '.mcp.json',
        global: '~/.claude.json',
        key: 'mcpServers',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.claude/'],
      },
      'custom-one': {
        name: 'Custom One',
        project: null,
        global: '~/.custom/mcp.json',
        key: 'mcpServers',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.custom/'],
      },
    };
    const customAgents: MindosCustomMcpAgentDef[] = [{
      name: 'Custom One',
      key: 'custom-one',
      baseDir: '~/.custom/',
      global: '~/.custom/mcp.json',
      configKey: 'mcpServers',
      format: 'json',
      preferredTransport: 'stdio',
      presenceDirs: ['~/.custom/'],
    }];

    const response = await handleMcpAgentsGet({
      agents,
      builtInAgents: {
        mindos: agents.mindos,
        'claude-code': agents['claude-code'],
      },
      customAgents,
      readSettings: () => ({ mcpPort: 7777 }),
      env: {} as NodeJS.ProcessEnv,
      homeDir: home,
      mindRoot: join(home, '.mindos'),
      projectRoot: root,
      now: () => new Date('2026-04-30T00:00:00.000Z'),
      detectAgentPresence: (key) => key === 'claude-code',
      detectInstalled: (key) => key === 'claude-code'
        ? { installed: true, scope: 'global', transport: 'http', url: 'http://127.0.0.1:8567/mcp' }
        : { installed: false },
      resolveSkillWorkspaceProfile: () => ({
        mode: 'additional',
        workspacePath: join(home, '.claude', 'skills'),
      }),
      detectAgentRuntimeSignals: () => ({
        hiddenRootPath: join(home, '.claude'),
        hiddenRootPresent: false,
        conversationSignal: false,
        usageSignal: false,
      }),
      detectAgentConfiguredMcpServers: () => ({ servers: ['mindos'], sources: ['global:~/.claude.json'] }),
      detectAgentInstalledSkills: () => ({ skills: [], sourcePath: join(home, '.claude', 'skills') }),
      loadMindosSkills: () => ({
        names: ['mindos'],
        sourcePath: join(root, 'skills'),
        workspacePath: join(home, '.agents', 'skills'),
      }),
      fetchHead: async () => ({ status: 200 }),
    });

    expect(response.status).toBe(200);
    const profiles = response.body.agents;
    expect(profiles.map((agent) => agent.key)).toEqual(['mindos', 'claude-code', 'custom-one']);
    expect(profiles[0]).toMatchObject({
      key: 'mindos',
      present: true,
      installed: true,
      scope: 'builtin',
      transport: 'http :7777',
      configuredMcpServers: ['filesystem', 'github'],
      installedSkillNames: ['mindos'],
      hiddenRootPresent: true,
      runtimeLastActivityAt: '2026-04-30T00:00:00.000Z',
    });
    expect(profiles[2]).toMatchObject({
      key: 'custom-one',
      present: true,
      installed: true,
      scope: 'global',
      isCustom: true,
      customBaseDir: '~/.custom/',
      configuredMcpServers: ['mindos', 'search'],
      installedSkillNames: ['mindos'],
    });
  });

  it('marks installed HTTP MCP agents inactive when endpoint verification fails', async () => {
    const response = await handleMcpAgentsGet({
      agents: {
        'claude-code': {
          name: 'Claude Code',
          project: null,
          global: '~/.claude.json',
          key: 'mcpServers',
          preferredTransport: 'stdio',
        },
      },
      detectInstalled: () => ({
        installed: true,
        scope: 'global',
        transport: 'http',
        url: 'http://127.0.0.1:1/mcp',
      }),
      fetchHead: async () => ({ status: 503 }),
    });

    expect(response.status).toBe(200);
    expect(response.body.agents[0]).toMatchObject({
      key: 'claude-code',
      installed: false,
    });
  });

  it('installs MindOS skills through the product runtime installer handler', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-install-skill-'));
    const localSkills = join(root, 'skills');
    mkdirSync(localSkills, { recursive: true });
    const commands: Array<{ command: string; args: string[] }> = [];

    expect(handleMcpInstallSkillPost({ agents: [] }, {
      runCommand: () => {
        throw new Error('should not run invalid request');
      },
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid skill name' },
    });

    expect(handleMcpInstallSkillPost({
      skill: 'mindos-zh',
      agents: ['cursor', 'claude-code', 'unknown-agent'],
    }, {
      projectRoot: root,
      pathExists: (path) => path === localSkills,
      skillAgentRegistry: {
        cursor: { mode: 'universal' },
        'claude-code': { mode: 'additional', skillAgentName: 'claude-code' },
      },
      runCommand: (command, args) => {
        commands.push({ command, args });
        if (commands.length === 1) {
          const error = new Error('network down') as Error & { stdout: string; stderr: string };
          error.stdout = '';
          error.stderr = 'network down';
          throw error;
        }
        return 'Done!\n';
      },
    })).toMatchObject({
      status: 200,
      body: {
        ok: true,
        skill: 'mindos-zh',
        agents: ['claude-code', 'unknown-agent'],
        stdout: 'Done!',
      },
    });

    expect(commands).toEqual([
      {
        command: 'npx',
        args: ['skills', 'add', 'GeminiLight/MindOS', '--skill', 'mindos-zh', '-a', 'claude-code', '-a', 'unknown-agent', '-g', '-y'],
      },
      {
        command: 'npx',
        args: ['skills', 'add', localSkills, '--skill', 'mindos-zh', '-a', 'claude-code', '-a', 'unknown-agent', '-g', '-y'],
      },
    ]);

    expect(handleMcpInstallSkillPost({ skill: 'mindos', agents: ['cursor'] }, {
      skillAgentRegistry: { cursor: { mode: 'universal' } },
      pathExists: () => false,
      runCommand: () => 'Done!\n',
    })).toMatchObject({
      status: 200,
      body: {
        ok: true,
        agents: [],
        cmd: 'npx skills add "GeminiLight/MindOS" --skill mindos -a universal -g -y',
      },
    });
  });

  it('runs MindOS skill installation through argv-safe subprocess args', () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    expect(handleMcpInstallSkillPost({ skill: 'mindos', agents: ['claude-code'] }, {
      skillAgentRegistry: { 'claude-code': { mode: 'additional', skillAgentName: 'claude-code' } },
      pathExists: () => false,
      runCommand: (command, args) => {
        calls.push({ command, args });
        return 'Done!\n';
      },
    })).toMatchObject({
      status: 200,
      body: {
        ok: true,
        cmd: 'npx skills add "GeminiLight/MindOS" --skill mindos -a claude-code -g -y',
      },
    });

    expect(calls).toEqual([{
      command: 'npx',
      args: ['skills', 'add', 'GeminiLight/MindOS', '--skill', 'mindos', '-a', 'claude-code', '-g', '-y'],
    }]);

    const source = readFileSync(join(__dirname, 'server', 'handlers', 'mcp-install-skill.ts'), 'utf-8');
    expect(source).not.toContain('execSync(cmd');
    expect(source).toContain('execFileSync(invocation.command, invocation.args');
  });

  it('resolves npx through the npm CLI on Windows without shell shims', () => {
    const npxCliPath = '/node/node_modules/npm/bin/npx-cli.js';

    expect(resolveNpxInvocation(['skills', 'add', 'GeminiLight/MindOS'], {
      platform: 'win32',
      nodeExecPath: '/node/node.exe',
      pathExists: (path) => path === npxCliPath,
      env: {},
    })).toEqual({
      command: '/node/node.exe',
      args: [npxCliPath, 'skills', 'add', 'GeminiLight/MindOS'],
    });
  });

  it('restarts MCP through the product process-control handler', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-mcp-restart-'));
    const bundlePath = join(root, 'packages', 'mindos', 'dist', 'protocols', 'mcp-server', 'index.cjs');
    const packageRoot = join(root, 'packages', 'mindos');
    const killedPorts: number[] = [];
    const spawned: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];

    await expect(handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9991, authToken: 'from-settings' }),
      env: { MINDOS_MANAGED: '1' } as NodeJS.ProcessEnv,
      projectRoot: root,
      killByPort: (port) => { killedPorts.push(port); },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, port: 9991, note: 'ProcessManager will respawn' },
    });
    expect(killedPorts).toEqual([9991]);

    await expect(handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9992 }),
      env: {} as NodeJS.ProcessEnv,
      projectRoot: root,
      killByPort: () => {},
      waitForPortFree: async () => false,
    })).resolves.toMatchObject({
      status: 500,
      body: { error: 'MCP port 9992 still in use after kill' },
    });

    await expect(handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9993 }),
      env: {} as NodeJS.ProcessEnv,
      projectRoot: root,
      killByPort: () => {},
      waitForPortFree: async () => true,
      pathExists: () => false,
    })).resolves.toMatchObject({
      status: 500,
      body: { error: 'MCP bundle not found — reinstall @geminilight/mindos' },
    });

    await expect(handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9994, authToken: 'from-settings' }),
      env: { MINDOS_WEB_PORT: '4567', MCP_HOST: '127.0.0.1' } as NodeJS.ProcessEnv,
      projectRoot: root,
      execPath: '/node',
      killByPort: (port) => { killedPorts.push(port); },
      waitForPortFree: async () => true,
      pathExists: (path) => path === bundlePath,
      spawnDetached: (command, args, options) => {
        spawned.push({ command, args, cwd: options.cwd, env: options.env });
        return { pid: 12345, unref: () => {} };
      },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, pid: 12345, port: 9994 },
    });

    await expect(handleMcpRestartPost({
      readSettings: () => ({ mcpPort: 9995 }),
      env: { MINDOS_WEB_PORT: '5678' } as NodeJS.ProcessEnv,
      projectRoot: packageRoot,
      execPath: '/node',
      killByPort: (port) => { killedPorts.push(port); },
      waitForPortFree: async () => true,
      pathExists: (path) => path === bundlePath,
      spawnDetached: (command, args, options) => {
        spawned.push({ command, args, cwd: options.cwd, env: options.env });
        return { pid: 12346, unref: () => {} };
      },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, pid: 12346, port: 9995 },
    });

    expect(spawned).toEqual([{
      command: '/node',
      args: [bundlePath],
      cwd: packageRoot,
      env: expect.objectContaining({
        MCP_TRANSPORT: 'http',
        MCP_PORT: '9994',
        MCP_HOST: '127.0.0.1',
        MINDOS_URL: 'http://127.0.0.1:4567',
        AUTH_TOKEN: 'from-settings',
      }),
    }, {
      command: '/node',
      args: [bundlePath],
      cwd: packageRoot,
      env: expect.objectContaining({
        MCP_TRANSPORT: 'http',
        MCP_PORT: '9995',
        MCP_HOST: '0.0.0.0',
        MINDOS_URL: 'http://127.0.0.1:5678',
      }),
    }]);
  });

  it('finds MCP restart port owners without shell-interpolated process lookup', () => {
    expect(parseNetstatListeningPids(8781, [
      '  TCP    0.0.0.0:8781       0.0.0.0:0       LISTENING       111',
      '  TCP    [::]:8781          [::]:0          LISTENING       222',
      '  TCP    127.0.0.1:87810    0.0.0.0:0       LISTENING       333',
      '  TCP    127.0.0.1:8781     0.0.0.0:0       ESTABLISHED     444',
    ].join('\r\n'))).toEqual([111, 222]);

    const winCalls: Array<{ command: string; args: string[] }> = [];
    const winPids = findMcpProcessIdsByPort(8781, {
      platform: 'win32',
      execFile: (command, args) => {
        winCalls.push({ command, args });
        if (command === 'netstat') {
          return [
            '  TCP    0.0.0.0:8781       0.0.0.0:0       LISTENING       1234',
            '  TCP    127.0.0.1:87810    0.0.0.0:0       LISTENING       5678',
          ].join('\r\n');
        }
        return '';
      },
    });
    expect(winPids).toEqual([1234]);
    expect(winCalls).toEqual([{ command: 'netstat', args: ['-ano'] }]);

    const unixCalls: Array<{ command: string; args: string[] }> = [];
    const unixPids = findMcpProcessIdsByPort(8781, {
      platform: 'linux',
      execFile: (command, args) => {
        unixCalls.push({ command, args });
        if (command === 'lsof') throw new Error('lsof unavailable');
        if (command === 'ss') {
          return [
            'LISTEN 0 4096 0.0.0.0:8781 0.0.0.0:* users:(("node",pid=2468,fd=20))',
            'LISTEN 0 4096 0.0.0.0:87810 0.0.0.0:* users:(("node",pid=1357,fd=20))',
          ].join('\n');
        }
        return '';
      },
    });
    expect(unixPids).toEqual([2468]);
    expect(unixCalls).toEqual([
      { command: 'lsof', args: ['-ti', ':8781'] },
      { command: 'ss', args: ['-tlnp'] },
    ]);

    const source = readFileSync(join(__dirname, 'server', 'handlers', 'mcp-restart.ts'), 'utf-8');
    expect(source).not.toContain('execSync(');
    expect(source).not.toContain('lsof -ti :${port}');
    expect(source).not.toContain('| xargs kill');
  });

  it('handles content changes summary, list, and mark_seen from product runtime', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-changes-'));
    const summary = await handleChangesGet(new URLSearchParams('op=summary'), { mindRoot: root });
    expect(summary).toMatchObject({ status: 200, body: { unreadCount: 0, totalCount: 0 } });

    const list = await handleChangesGet(new URLSearchParams('op=list&limit=10'), { mindRoot: root });
    expect(list).toMatchObject({ status: 200, body: { events: [] } });

    const marked = await handleChangesPost({ op: 'mark_seen' }, { mindRoot: root });
    expect(marked).toEqual({ status: 200, body: { ok: true } });
  });

  it('handles backlinks and graph data from markdown links', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-graph-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'source.md'), 'See [[target]] and [Target](Space/target.md).');
    writeFileSync(join(root, 'Space', 'target.md'), '# Target');

    const backlinks = handleBacklinks(new URLSearchParams('path=Space/target.md'), { mindRoot: root });
    expect(backlinks.status).toBe(200);
    expect(backlinks.body).toEqual([
      expect.objectContaining({ filePath: 'source.md', snippets: [expect.stringContaining('Target')] }),
    ]);

    const graph = handleGraph({ mindRoot: root });
    expect(graph.status).toBe(200);
    expect(graph.body.nodes).toEqual(expect.arrayContaining([
      { id: 'source.md', label: 'source', folder: '.' },
      { id: 'Space/target.md', label: 'target', folder: 'Space' },
    ]));
    expect(graph.body.edges).toEqual(expect.arrayContaining([
      { source: 'source.md', target: 'Space/target.md' },
    ]));
  });

  it('lists agent activity from the product audit log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-agent-activity-'));
    mkdirSync(join(root, '.mindos'), { recursive: true });
    writeFileSync(join(root, '.mindos', 'agent-audit-log.json'), JSON.stringify({
      version: 1,
      events: [
        { id: '1', ts: '2026-01-01T00:00:00.000Z', tool: 'write_file', params: {}, result: 'ok' },
        { id: '2', ts: '2026-01-02T00:00:00.000Z', tool: 'read_file', params: {}, result: 'ok' },
      ],
    }));

    const response = await handleAgentActivity(new URLSearchParams('limit=1'), { mindRoot: root });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      events: [
        { id: '1', ts: '2026-01-01T00:00:00.000Z', tool: 'write_file', params: {}, result: 'ok' },
      ],
    });
  });

  it('persists ask sessions in the product runtime store', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-ask-sessions-'));
    const storePath = join(root, 'sessions.json');
    const session = {
      id: 's1',
      title: 'Session 1',
      updatedAt: 1,
      messages: [{ role: 'user', content: 'hello' }],
    };

    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
    expect(handleAskSessionsPost({ session }, { storePath })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(JSON.parse(readFileSync(storePath, 'utf-8'))).toEqual([session]);
    expect(handleAskSessionsGet({ storePath }).body).toEqual([session]);
    expect(handleAskSessionsDelete({ id: 's1' }, { storePath })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(handleAskSessionsGet({ storePath }).body).toEqual([]);
  });

  it('returns lightweight space overview stats without Web compile dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-space-overview-'));
    mkdirSync(join(root, 'Space', 'Nested'), { recursive: true });
    writeFileSync(join(root, 'Space', 'a.md'), 'a');
    writeFileSync(join(root, 'Space', 'Nested', 'b.md'), 'b');
    writeFileSync(join(root, 'Other.md'), 'other');

    expect(handleSpaceOverviewGet(new URLSearchParams('space=Space'), { mindRoot: root })).toMatchObject({
      status: 200,
      body: { fileCount: 2 },
    });
    expect(handleSpaceOverviewGet(new URLSearchParams(), { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'space parameter required' },
    });
    expect(handleSpaceOverviewGet(new URLSearchParams('space=../outside'), { mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('handles git status, history, and show through injectable product services', async () => {
    const services = {
      isGitRepo: async () => true,
      gitLog: async (_path: string, limit: number) => [
        { hash: 'abc', date: '2026-01-01T00:00:00.000Z', message: `limit ${limit}`, author: 'MindOS' },
      ],
      gitShowFile: async (path: string, commit: string) => `${commit}:${path}`,
    };

    await expect(handleGit(new URLSearchParams('op=is_repo'), services)).resolves.toMatchObject({
      status: 200,
      body: { isRepo: true },
    });
    await expect(handleGit(new URLSearchParams('op=history&path=note.md&limit=5'), services)).resolves.toMatchObject({
      status: 200,
      body: { entries: [{ hash: 'abc', message: 'limit 5' }] },
    });
    await expect(handleGit(new URLSearchParams('op=show&path=note.md&commit=abc'), services)).resolves.toMatchObject({
      status: 200,
      body: { content: 'abc:note.md' },
    });
    await expect(handleGit(new URLSearchParams('op=history'), services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'missing path' },
    });
  });

  it('handles inbox list, save, and archive without Web dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-'));

    const empty = handleInboxGet({ mindRoot: root });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ files: [] });

    const saved = handleInboxPost({
      files: [{ name: 'todo.txt', content: 'Buy milk' }],
      source: 'test',
    }, { mindRoot: root });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      saved: [{ original: 'todo.txt', path: 'Inbox/todo.md' }],
      skipped: [],
      source: 'test',
    });
    expect(readFileSync(join(root, 'Inbox', 'todo.md'), 'utf-8')).toContain('# Todo');

    const listed = handleInboxGet({ mindRoot: root });
    expect(listed.body.files).toEqual([
      expect.objectContaining({ name: 'todo.md', path: 'Inbox/todo.md' }),
    ]);

    const archived = handleInboxDelete({ names: ['todo.md'] }, { mindRoot: root });
    expect(archived.status).toBe(200);
    expect(archived.body.archived[0]).toMatchObject({
      original: 'todo.md',
    });
    expect(archived.body.archived[0].archivedPath).toMatch(/^Inbox\/\.processed\/\d{8}-\d{6}_todo\.md$/);
    expect(handleInboxDelete({}, { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'Request body must contain a non-empty names array' },
    });
  });

  it('handles setup path checks and directory listing without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-setup-path-'));
    mkdirSync(join(root, 'Documents'), { recursive: true });
    mkdirSync(join(root, 'Projects'), { recursive: true });
    writeFileSync(join(root, '.hidden'), 'secret');

    expect(handleSetupCheckPath({ path: root })).toMatchObject({
      status: 200,
      body: { exists: true, empty: false, count: 2, unsafe: false },
    });
    expect(handleSetupListDirectories({ path: root })).toMatchObject({
      status: 200,
      body: { dirs: ['Documents', 'Projects'] },
    });
    expect(handleSetupCheckPath({ path: join(root, '.mindos') }, { homeDir: root })).toMatchObject({
      status: 200,
      body: {
        exists: false,
        empty: true,
        count: 0,
        unsafe: true,
        reason: expect.stringContaining('system directory'),
      },
    });
    expect(handleSetupCheckPath({ path: '' })).toMatchObject({
      status: 400,
      body: { error: 'Invalid path' },
    });
    expect(handleSetupListDirectories({ path: '' })).toMatchObject({
      status: 200,
      body: { dirs: [] },
    });
  });

  it('handles bootstrap context without Web tree dependencies', () => {
    const files = new Map([
      ['INSTRUCTION.md', '# Instructions'],
      ['README.md', '# Index'],
      ['CONFIG.json', '{"key":"value"}'],
      ['.mindos/user-preferences.md', 'Prefer concise answers'],
      ['Workflows/README.md', '# Workflows'],
      ['Workflows/INSTRUCTION.md', '# Workflow Instructions'],
      ['Projects/roadmap.md', '# Roadmap'],
      ['Projects/pricing.md', '# Pricing'],
      ['notes.md', 'Notes'],
    ]);
    const services = {
      collectAllFiles: () => [...files.keys()].filter((filePath) => !filePath.startsWith('.mindos/')),
      readTextFile: (filePath: string) => {
        const content = files.get(filePath);
        if (content == null) throw new Error('missing');
        return content;
      },
    };

    const result = handleBootstrapGet(new URLSearchParams('target_dir=Workflows'), services);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      instruction: '# Instructions',
      index: '# Index',
      config_json: '{"key":"value"}',
      user_skill_rules: 'Prefer concise answers',
      target_readme: '# Workflows',
      target_instruction: '# Workflow Instructions',
    });
    expect(result.body.file_index).toContain('Projects/ (2 files)');
    expect(result.body.file_index).toContain('notes.md');
    expect(handleBootstrapGet(new URLSearchParams('target_dir=../secret'), services)).toMatchObject({
      status: 400,
      body: { error: 'invalid target_dir' },
    });
  });

  it('handles local connection metadata without Web dependencies', () => {
    expect(handleConnectGet({
      port: '4567',
      hostname: () => 'test-host',
      networkInterfaces: () => ({
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        docker0: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
        en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
      }),
    })).toMatchObject({
      status: 200,
      body: {
        url: 'http://192.168.1.20:4567',
        ip: '192.168.1.20',
        port: 4567,
        hostname: 'test-host',
      },
    });
  });

  it('handles update status and update checks without Web dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-update-'));
    const statusPath = join(root, 'update-status.json');
    writeFileSync(statusPath, JSON.stringify({ stage: 'done', version: '1.2.3' }));

    expect(handleUpdateStatusGet({ statusPath })).toMatchObject({
      status: 200,
      body: { stage: 'done', version: '1.2.3' },
    });
    expect(handleUpdateStatusGet({ statusPath: join(root, 'missing.json') })).toMatchObject({
      status: 200,
      body: { stage: 'idle', stages: [], error: null, version: null, startedAt: null },
    });

    await expect(handleUpdateCheckGet({
      currentVersion: '1.0.0',
      registries: ['https://registry.example/latest'],
      fetcher: async () => ({
        ok: true,
        json: async () => ({ version: '1.0.1' }),
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: { current: '1.0.0', latest: '1.0.1', hasUpdate: true },
    });
  });

  it('runs restart and update process controls with sanitized child environments', () => {
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown>; unrefCalled: boolean }> = [];
    const spawn = (command: string, args: string[], options: Record<string, unknown>) => {
      const record = { command, args, options, unrefCalled: false };
      spawned.push(record);
      return { unref: () => { record.unrefCalled = true; } };
    };
    const env = {
      PATH: '/usr/bin',
      MINDOS_WEB_PORT: '3011',
      MINDOS_MCP_PORT: '8787',
      MINDOS_PROJECT_ROOT: '/old',
      MIND_ROOT: '/old/mind',
      AUTH_TOKEN: 'secret-token',
      WEB_PASSWORD: 'secret-password',
      NODE_OPTIONS: '--inspect',
    };
    const scheduledExit: number[] = [];

    const restart = handleRestartPost({
      cliPath: '/opt/mindos/bin/cli.js',
      nodeBin: '/usr/local/bin/node',
      env,
      spawn,
      scheduleExit: (delayMs) => { scheduledExit.push(delayMs); },
    });
    expect(restart.status).toBe(200);
    expect(spawned[0]).toMatchObject({
      command: '/usr/local/bin/node',
      args: ['/opt/mindos/bin/cli.js', 'restart'],
      unrefCalled: true,
    });
    expect(spawned[0].options).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(spawned[0].options.env).toMatchObject({
      PATH: '/usr/bin',
      MINDOS_OLD_WEB_PORT: '3011',
      MINDOS_OLD_MCP_PORT: '8787',
    });
    expect((spawned[0].options.env as Record<string, string | undefined>).MINDOS_WEB_PORT).toBeUndefined();
    expect((spawned[0].options.env as Record<string, string | undefined>).MIND_ROOT).toBeUndefined();
    expect((spawned[0].options.env as Record<string, string | undefined>).AUTH_TOKEN).toBeUndefined();
    expect((spawned[0].options.env as Record<string, string | undefined>).NODE_OPTIONS).toBeUndefined();
    expect(scheduledExit).toEqual([1500]);

    const update = handleUpdatePost({
      cliPath: '/opt/mindos/bin/cli.js',
      nodeBin: '/usr/local/bin/node',
      env,
      spawn,
    });
    expect(update.status).toBe(200);
    expect(spawned[1]).toMatchObject({
      command: '/usr/local/bin/node',
      args: ['/opt/mindos/bin/cli.js', 'update'],
      unrefCalled: true,
    });
    expect((spawned[1].options.env as Record<string, string | undefined>).MINDOS_OLD_WEB_PORT).toBeUndefined();
    expect((spawned[1].options.env as Record<string, string | undefined>).MINDOS_PROJECT_ROOT).toBeUndefined();
    expect((spawned[1].options.env as Record<string, string | undefined>).WEB_PASSWORD).toBeUndefined();
    expect(scheduledExit).toEqual([1500]);
  });

  it('runs uninstall through the product process control without deleting knowledge data', () => {
    const writes: string[] = [];
    const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown>; unrefCalled: boolean; stdinEnded: boolean }> = [];
    const spawn = (command: string, args: string[], options: Record<string, unknown>) => {
      const record = { command, args, options, unrefCalled: false, stdinEnded: false };
      spawned.push(record);
      return {
        stdin: {
          write: (value: string) => { writes.push(value); },
          end: () => { record.stdinEnded = true; },
        },
        unref: () => { record.unrefCalled = true; },
      };
    };

    const response = handleUninstallPost({ removeConfig: false }, {
      cliPath: '/opt/mindos/bin/cli.js',
      nodeBin: '/usr/local/bin/node',
      env: { PATH: '/usr/bin', MIND_ROOT: '/private/mind', AUTH_TOKEN: 'secret' },
      spawn,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(spawned[0]).toMatchObject({
      command: '/usr/local/bin/node',
      args: ['/opt/mindos/bin/cli.js', 'uninstall'],
      unrefCalled: true,
      stdinEnded: true,
    });
    expect(spawned[0].options).toMatchObject({ detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
    expect(writes).toEqual(['Y\nN\nN\n']);

    const childEnv = spawned[0].options.env as Record<string, string | undefined>;
    expect(childEnv.PATH).toBe('/usr/bin');
    expect(childEnv.MIND_ROOT).toBeUndefined();
    expect(childEnv.AUTH_TOKEN).toBeUndefined();
  });

  it('applies init templates idempotently from the product runtime', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-init-'));
    const templateRoot = join(root, 'templates');
    const mindRoot = join(root, 'mind');
    mkdirSync(join(templateRoot, 'en', 'Space'), { recursive: true });
    writeFileSync(join(templateRoot, 'en', 'README.md'), 'template readme');
    writeFileSync(join(templateRoot, 'en', 'Space', 'note.md'), 'template note');
    mkdirSync(mindRoot, { recursive: true });
    writeFileSync(join(mindRoot, 'README.md'), 'existing readme');

    expect(handleInitPost({ template: 'en' }, {
      mindRoot,
      templateRoots: [templateRoot],
    })).toMatchObject({
      status: 200,
      body: { ok: true, template: 'en' },
    });
    expect(readFileSync(join(mindRoot, 'README.md'), 'utf-8')).toBe('existing readme');
    expect(readFileSync(join(mindRoot, 'Space', 'note.md'), 'utf-8')).toBe('template note');

    expect(handleInitPost({ template: '../bad' }, {
      mindRoot,
      templateRoots: [templateRoot],
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid template: ../bad' },
    });
    expect(handleInitPost({ template: 'zh' }, {
      mindRoot,
      templateRoots: [templateRoot],
    })).toMatchObject({
      status: 404,
      body: { error: expect.stringContaining('Template "zh" not found') },
    });
  });

  it('handles sync status and actions through product-owned operations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-sync-'));
    const mindRoot = join(root, 'mind');
    mkdirSync(join(mindRoot, '.git'), { recursive: true });
    writeFileSync(join(mindRoot, 'note.md'), 'local');
    writeFileSync(join(mindRoot, 'note.md.sync-conflict'), 'remote');

    let config: Record<string, any> = {
      mindRoot,
      sync: { enabled: true, provider: 'git', autoCommitInterval: 45, autoPullInterval: 600 },
    };
    let state: Record<string, any> = {
      lastSync: '2026-05-09T10:00:00Z',
      conflicts: [{ file: 'note.md' }],
    };
    const cliCalls: Array<{ args: string[]; timeoutMs?: number }> = [];
    const services = {
      readConfig: () => config,
      writeConfig: (next: Record<string, any>) => { config = next; },
      readState: () => state,
      writeState: (next: Record<string, any>) => { state = next; },
      isGitRepo: () => true,
      getRemoteUrl: () => 'git@example.com:mind/repo.git',
      getBranch: () => 'main',
      getUnpushedCount: () => '2',
      runCli: async (args: string[], timeoutMs?: number) => { cliCalls.push({ args, timeoutMs }); },
    };

    await expect(handleSyncGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        enabled: true,
        remote: 'git@example.com:mind/repo.git',
        branch: 'main',
        unpushed: '2',
        conflicts: [{ file: 'note.md' }],
      },
    });

    await expect(handleSyncPost({ action: 'init', remote: 'https://example.com/repo.git', branch: 'dev', token: 'tok' }, services)).resolves.toMatchObject({
      status: 200,
      body: { success: true, message: 'Sync initialized' },
    });
    expect(cliCalls[0]).toEqual({
      args: ['sync', 'init', '--non-interactive', '--remote', 'https://example.com/repo.git', '--branch', 'dev', '--token', 'tok'],
      timeoutMs: 120000,
    });

    expect(await handleSyncPost({ action: 'off' }, services)).toMatchObject({
      status: 200,
      body: { ok: true, enabled: false },
    });
    expect(config.sync.enabled).toBe(false);

    expect(await handleSyncPost({ action: 'gitignore-save', content: 'node_modules\n' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(readFileSync(join(mindRoot, '.gitignore'), 'utf-8')).toBe('node_modules\n');

    expect(await handleSyncPost({ action: 'conflict-preview', remote: 'note.md' }, services)).toMatchObject({
      status: 200,
      body: { local: 'local', remote: 'remote' },
    });
    expect(await handleSyncPost({ action: 'resolve-conflict', remote: '../outside.md' }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid file path' },
    });
    expect(await handleSyncPost({ action: 'update-intervals', autoCommitInterval: 1 }, services)).toMatchObject({
      status: 400,
      body: { error: 'autoCommitInterval must be an integer between 10 and 300 seconds' },
    });
  });

  it('reads sync git metadata through argv-safe git commands', () => {
    const source = readFileSync(join(__dirname, 'server', 'handlers', 'sync.ts'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("execFileSync('git', args");
    expect(source).toContain("runGit(cwd, ['remote', 'get-url', 'origin'])");
    expect(source).toContain("runGit(cwd, ['rev-list', '--count', '@{u}..HEAD'])");
  });

  it('verifies channel credentials through product validation and injected verifier', async () => {
    const verified = await handleChannelsVerifyPost({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    }, {
      verifyCredentials: async (platform, credentials) => ({
        ok: true,
        botName: `${platform}-bot`,
        botId: (credentials as { bot_token: string }).bot_token.slice(0, 3),
      }),
    });

    expect(verified).toMatchObject({
      status: 200,
      body: { ok: true, botName: 'telegram-bot', botId: '123' },
    });

    await expect(handleChannelsVerifyPost({ platform: 'unknown', credentials: {} })).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Invalid platform' },
    });
    await expect(handleChannelsVerifyPost({ platform: 'telegram' })).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Missing credentials' },
    });
    await expect(handleChannelsVerifyPost({ platform: 'telegram', credentials: { bot_token: 'bad' } })).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Missing required fields: bot_token' },
    });
    await expect(handleChannelsVerifyPost({
      platform: 'telegram',
      credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    }, {
      verifyCredentials: async () => ({ ok: false, error: 'Unauthorized: check bot_token' }),
    })).resolves.toMatchObject({
      status: 401,
      body: { ok: false, error: 'Unauthorized: check bot_token' },
    });
  });

  it('lists IM activity with platform validation and clamped limit', () => {
    expect(handleImActivityGet(new URLSearchParams('platform=bad'), {
      getActivities: () => [],
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid or missing platform parameter' },
    });

    expect(handleImActivityGet(new URLSearchParams('platform=feishu&limit=500'), {
      getActivities: (platform, limit) => [{ id: '1', platform, limit }],
    })).toMatchObject({
      status: 200,
      body: { activities: [{ id: '1', platform: 'feishu', limit: 100 }] },
    });
  });

  it('manages IM config through product-owned masking, validation, and deletes', () => {
    let config: any = {
      providers: {
        telegram: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
        feishu: { app_id: 'cli_app', app_secret: 'secret123' },
      },
    };
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
    };

    expect(handleImConfigGet(services)).toMatchObject({
      status: 200,
      body: {
        providers: {
          telegram: { bot_token: '1234••••YZ' },
          feishu: { app_id: 'cli_••••pp', app_secret: 'secr••••23' },
        },
      },
    });

    expect(handleImConfigPut({ platform: 'telegram', credentials: { bot_token: 'bad' } }, services)).toMatchObject({
      status: 422,
      body: { error: 'Invalid config: missing bot_token', missing: ['bot_token'] },
    });

    expect(handleImConfigPut({
      platform: 'feishu',
      conversation: { enabled: true, transport: 'long_connection', allow_group_mentions: false },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'feishu' },
    });
    expect(config.providers.feishu.conversation).toMatchObject({
      enabled: true,
      transport: 'long_connection',
      allow_group_mentions: false,
    });

    expect(handleImConfigDelete(new URLSearchParams('platform=telegram'), services)).toMatchObject({
      status: 200,
      body: { ok: true, platform: 'telegram' },
    });
    expect(config.providers.telegram).toBeUndefined();
  });

  it('reports IM status and Feishu webhook diagnostics through injected product services', async () => {
    const feishuConfig = {
      app_id: 'cli_app',
      app_secret: 'secret',
      conversation: {
        enabled: true,
        transport: 'webhook',
        public_base_url: 'https://mindos.example/',
        encrypt_key: 'encrypt',
      },
    };
    const services = {
      hasAnyIMConfig: () => true,
      listConfiguredIM: async () => [
        { platform: 'feishu', connected: true, botName: 'MindOS', capabilities: ['text'] },
        { platform: 'telegram', connected: false, capabilities: ['text'] },
      ],
      getPlatformConfig: (platform: string) => platform === 'feishu' ? feishuConfig : undefined,
      buildFeishuWebhookStatus: (config: unknown) => ({
        platform: 'feishu',
        state: config === feishuConfig ? 'ready' : 'disabled',
        transport: 'webhook',
        publicBaseUrl: 'https://mindos.example',
        webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
      }),
    };

    await expect(handleImStatusGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        platforms: [
          {
            platform: 'feishu',
            connected: true,
            webhook: {
              state: 'ready',
              webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
            },
          },
          { platform: 'telegram', connected: false },
        ],
      },
    });

    expect(handleImWebhookStatusGet(new URLSearchParams('platform=feishu'), services)).toMatchObject({
      status: 200,
      body: {
        status: {
          platform: 'feishu',
          state: 'ready',
          webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
        },
      },
    });

    expect(handleImWebhookStatusGet(new URLSearchParams('platform=telegram'), services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid or unsupported platform parameter' },
    });
  });

  it('sends IM test messages with product validation and normalized errors', async () => {
    const calls: any[] = [];
    const services = {
      sendIMMessage: async (message: any, signal: AbortSignal | undefined, options: { activityType?: string } | undefined) => {
        calls.push({ message, signal, options });
        return { ok: true, messageId: 'msg_1', timestamp: '2026-05-09T00:00:00.000Z' };
      },
    };

    await expect(handleImTestPost({
      platform: 'feishu',
      recipient_id: 'ou_123',
      message: 'hello',
    }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, messageId: 'msg_1', timestamp: '2026-05-09T00:00:00.000Z' },
    });
    expect(calls).toEqual([{
      message: {
        platform: 'feishu',
        recipientId: 'ou_123',
        text: 'hello',
        format: 'text',
      },
      signal: undefined,
      options: { activityType: 'test' },
    }]);

    await expect(handleImTestPost({ platform: 'feishu', recipient_id: 'ou_123' }, services)).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Missing required fields: platform, recipient_id, message' },
    });
    await expect(handleImTestPost({
      platform: 'feishu',
      recipient_id: 'ou_123',
      message: 'hello',
    }, {
      sendIMMessage: async () => ({ ok: false, error: 'invalid recipient', timestamp: '2026-05-09T00:00:00.000Z' }),
    })).resolves.toMatchObject({
      status: 422,
      body: { ok: false, error: 'invalid recipient' },
    });
  });

  it('controls Feishu long connection lifecycle and persists transport state', async () => {
    let config: any = {
      providers: {
        feishu: {
          app_id: 'cli_app',
          app_secret: 'secret',
          conversation: { enabled: false, transport: 'webhook' },
        },
      },
    };
    let running = false;
    const services = {
      readConfig: () => config,
      writeConfig: (next: any) => { config = next; },
      getFeishuWSClientStatus: () => ({ running, startedAt: running ? '2026-05-09T00:00:00.000Z' : undefined }),
      startFeishuWSClient: async (feishuConfig: any) => {
        expect(feishuConfig.app_id).toBe('cli_app');
        running = true;
      },
      stopFeishuWSClient: () => { running = false; },
    };

    expect(handleImFeishuLongConnectionGet(services)).toMatchObject({
      status: 200,
      body: { ok: true, running: false },
    });

    await expect(handleImFeishuLongConnectionPost(services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, running: true, startedAt: '2026-05-09T00:00:00.000Z' },
    });
    expect(config.providers.feishu.conversation).toMatchObject({
      enabled: true,
      transport: 'long_connection',
    });

    expect(handleImFeishuLongConnectionDelete(services)).toMatchObject({
      status: 200,
      body: { ok: true, running: false },
    });
    expect(config.providers.feishu.conversation.transport).toBe('webhook');

    config = { providers: {} };
    await expect(handleImFeishuLongConnectionPost(services)).resolves.toMatchObject({
      status: 422,
      body: { ok: false, error: 'Feishu is not configured. Save App ID and App Secret first.' },
    });
  });

  it('handles monitoring snapshots without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-monitoring-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'Space', 'note.md'), 'hello');
    writeFileSync(join(root, '.DS_Store'), 'ignored');

    expect(handleMonitoringGet({
      mindRoot: root,
      metricsSnapshot: () => ({
        processStartTime: Date.now() - 100,
        agentRequests: 2,
        toolExecutions: 3,
        totalTokens: { input: 5, output: 8 },
        avgResponseTimeMs: 42,
        errors: 1,
      }),
      memoryUsage: () => ({ heapUsed: 1, heapTotal: 2, rss: 3 }),
      nodeVersion: 'v-test',
      mcpPort: 9999,
    })).toMatchObject({
      status: 200,
      body: {
        system: { memory: { heapUsed: 1, heapTotal: 2, rss: 3 }, nodeVersion: 'v-test' },
        application: { agentRequests: 2, toolExecutions: 3, errors: 1 },
        knowledgeBase: { root, fileCount: 1, totalSizeBytes: 5 },
        mcp: { running: true, port: 9999 },
      },
    });
  });

  it('handles setup port checks and token generation without Web dependencies', async () => {
    await expect(handleSetupCheckPort(
      { port: 4567 },
      { myWebPort: 4567, myMcpPort: 8567 },
    )).resolves.toMatchObject({
      status: 200,
      body: { available: true, isSelf: true },
    });
    await expect(handleSetupCheckPort(
      { port: 4568 },
      {
        isPortInUse: async () => true,
        isSelfPort: async () => false,
        findFreePort: async () => 4570,
      },
    )).resolves.toMatchObject({
      status: 200,
      body: { available: false, isSelf: false, suggestion: 4570 },
    });
    await expect(handleSetupCheckPort({ port: 80 })).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid port' },
    });

    expect(handleSetupGenerateToken({ seed: 'abc' })).toMatchObject({
      status: 200,
      body: { token: 'ba78-16bf-8f01-cfea-4141-40de' },
    });
    expect(handleSetupGenerateToken({}, { randomBytes: () => Buffer.from('123456789012') })).toMatchObject({
      status: 200,
      body: { token: '3132-3334-3536-3738-3930-3132' },
    });
  });

  it('handles workflow listing and creation without Web dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-workflows-'));
    mkdirSync(join(root, '.mindos', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.mindos', 'workflows', 'existing.flow.yaml'), [
      'title: Existing Flow',
      'description: Test flow',
      'steps:',
      '  - id: one',
      '  - id: two',
      '',
    ].join('\n'));

    expect(handleWorkflowsGet({ mindRoot: root })).toMatchObject({
      status: 200,
      body: {
        workflows: [
          expect.objectContaining({
            path: '.mindos/workflows/existing.flow.yaml',
            title: 'Existing Flow',
            description: 'Test flow',
            stepCount: 2,
          }),
        ],
      },
    });

    const created = handleWorkflowsPost({ name: 'New Flow' }, { mindRoot: root });
    expect(created).toMatchObject({
      status: 200,
      body: { path: '.mindos/workflows/New Flow.flow.yaml' },
    });
    expect(readFileSync(join(root, '.mindos', 'workflows', 'New Flow.flow.yaml'), 'utf-8')).toContain('title: New Flow');
    expect(handleWorkflowsPost({}, { mindRoot: root })).toMatchObject({
      status: 400,
      body: { error: 'name is required' },
    });
    expect(handleWorkflowsPost({ name: 'New Flow' }, { mindRoot: root })).toMatchObject({
      status: 409,
      body: { error: 'Workflow already exists' },
    });
  });

  it('handles tree version through an injectable product service', () => {
    const res = handleTreeVersion({ getTreeVersion: () => 123 });
    expect(res).toMatchObject({ status: 200, body: { v: 123 } });
    expect(res.headers?.['Cache-Control']).toBe('private, max-age=0');
  });

  it('validates ask stream requests and returns a product-owned SSE stream', async () => {
    const invalid = handleAskStream({}, {
      askStream: async function* () {
        throw new Error('should not stream invalid ask requests');
      },
    });
    expect(invalid).toMatchObject({
      ok: false,
      status: 400,
      body: { error: 'messages must be an array' },
    });

    const valid = handleAskStream({
      messages: [{ role: 'user', content: 'hello' }],
      mode: 'chat',
      attachedFiles: ['note.md', 123],
    }, {
      askStream: async function* (input) {
        yield { type: 'status', message: `mode=${input.mode}` };
        yield { type: 'text_delta', delta: String(input.messages[0]?.content ?? '') };
        yield { type: 'done' };
      },
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error('expected ask stream');
    const events = [];
    for await (const event of valid.body) events.push(event);
    expect(events).toEqual([
      { type: 'status', message: 'mode=chat' },
      { type: 'text_delta', delta: 'hello' },
      { type: 'done' },
    ]);
  });

  it('serves ask SSE through the product HTTP server with injected runtime', async () => {
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      services: {
        ...createDefaultMindosHttpServices({
          readSettings: () => ({ mindRoot: mkdtempSync(join(tmpdir(), 'mindos-http-ask-')) }),
        }),
        askStream: async function* (input) {
          const request = input as { messages?: Array<{ content?: string }> };
          yield { type: 'status', message: 'started' };
          yield { type: 'text_delta', delta: request.messages?.[0]?.content ?? '' };
          yield { type: 'done' };
        },
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(await response.text()).toContain('data:{"type":"text_delta","delta":"hello"}');
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves static Web artifacts without a Next server', async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'mindos-static-web-'));
    mkdirSync(join(staticRoot, '_next', 'static'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main>MindOS</main>');
    writeFileSync(join(staticRoot, '_next', 'static', 'app.js'), 'console.log("mindos")');

    const index = handleStaticArtifact({ staticRoot, path: '/' });
    expect(index?.status).toBe(200);
    expect(index?.headers?.['Content-Type']).toBe('text/html; charset=utf-8');
    expect(index?.body?.toString()).toContain('MindOS');

    const asset = handleStaticArtifact({ staticRoot, path: '/_next/static/app.js' });
    expect(asset?.status).toBe(200);
    expect(asset?.headers?.['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(asset?.headers?.['Cache-Control']).toContain('immutable');

    expect(handleStaticArtifact({ staticRoot, path: '/../secret.js' })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('serves static Web artifact fallback through the product HTTP server', async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), 'mindos-http-static-'));
    mkdirSync(join(staticRoot, 'assets'), { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<main>MindOS shell</main>');
    writeFileSync(join(staticRoot, 'assets', 'app.12345678.js'), 'window.__mindos=1');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      staticRoot,
      services: createDefaultMindosHttpServices({
        staticRoot,
        readSettings: () => ({ mindRoot: mkdtempSync(join(tmpdir(), 'mindos-http-static-root-')) }),
      }),
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const shell = await fetch(`${base}/wiki`);
      expect(shell.status).toBe(200);
      expect(await shell.text()).toContain('MindOS shell');

      const asset = await fetch(`${base}/assets/app.12345678.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('cache-control')).toContain('immutable');
      expect(await asset.text()).toContain('__mindos');
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('handles settings read with masked secrets and provider env overrides', () => {
    const res = handleSettingsGet({
      env: { AI_PROVIDER: 'openai', MIND_ROOT: '/mind', MINDOS_WEB_PORT: '4567' },
      readSettings: () => ({
        ai: { activeProvider: 'openai', providers: { openai: { apiKey: 'secret' } } },
        authToken: 'mindos-secret-token',
        mcpPort: 8567,
      }),
      writeSettings: () => undefined,
      readWebSearchConfig: () => ({ provider: 'exa', exaApiKey: 'exa-key' }),
      writeWebSearchConfig: () => undefined,
      parseProviders: (providers) => providers,
      getEmbeddingStatus: () => ({ ready: true }),
      invalidateCache: () => undefined,
      providerEnv: {
        ids: ['openai'],
        getApiKeyEnvVar: () => 'OPENAI_API_KEY',
        getApiKeyFromEnv: () => 'env-secret',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authToken: 'mindos-••••-token',
      allowNetworkAccess: false,
      port: 4567,
      mcpPort: 8567,
      webSearch: { provider: 'exa', exaApiKey: '••••••' },
      envOverrides: { AI_PROVIDER: true, MIND_ROOT: true, OPENAI_API_KEY: true },
      envValues: { AI_PROVIDER: 'openai', MIND_ROOT: '/mind', OPENAI_API_KEY: '***set***' },
    });
  });

  it('handles settings write without accepting incoming auth token replacement', () => {
    let settings = {
      ai: { activeProvider: 'openai', providers: { openai: {} } },
      authToken: 'keep-me',
      allowNetworkAccess: false,
      mindRoot: '/old',
      baseUrlCompat: { openai: { streaming: false } },
    };
    let webSearch = { provider: 'exa', exaApiKey: 'old-key' };
    let invalidated = false;

    const res = handleSettingsPost({
      ai: { activeProvider: 'anthropic', providers: { anthropic: {} } },
      authToken: 'replace-me',
      allowNetworkAccess: true,
      mindRoot: '/new',
      webSearch: { provider: 'perplexity', exaApiKey: '••••••' },
      connectionMode: { cli: false, mcp: true },
    }, {
      readSettings: () => settings,
      writeSettings: (next) => {
        settings = next as typeof settings;
      },
      readWebSearchConfig: () => webSearch,
      writeWebSearchConfig: (next) => {
        webSearch = next as typeof webSearch;
      },
      parseProviders: (providers) => ({ parsed: providers }),
      getEmbeddingStatus: () => ({}),
      invalidateCache: () => {
        invalidated = true;
      },
      providerEnv: {
        ids: [],
        getApiKeyEnvVar: () => undefined,
        getApiKeyFromEnv: () => undefined,
      },
    });

    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(settings.authToken).toBe('keep-me');
    expect(settings.allowNetworkAccess).toBe(true);
    expect(settings.mindRoot).toBe('/new');
    expect(settings.connectionMode).toEqual({ cli: false, mcp: true });
    expect(settings.baseUrlCompat).toEqual({});
    expect(webSearch).toEqual({ provider: 'perplexity', exaApiKey: 'old-key' });
    expect(invalidated).toBe(true);
  });

  it('tests AI provider keys with product-owned validation and error classification', async () => {
    const services = {
      isProviderId: (value: string) => ['anthropic', 'openai', 'google'].includes(value),
      isProviderEntryId: (value: string) => value.startsWith('p_'),
      readSettings: () => ({ ai: { providers: [{ id: 'p_saved', protocol: 'openai', apiKey: 'saved-key', model: 'gpt-5.4', baseUrl: 'https://api.example/v1' }] } }),
      findProvider: (providers: any[], id: string) => providers.find((provider) => provider.id === id),
      effectiveAiConfig: (provider: string) => ({ provider, apiKey: provider === 'anthropic' ? '' : 'env-key', model: 'default-model', baseUrl: '' }),
      testModel: async () => undefined,
      clearCompatCacheForBaseUrl: () => undefined,
    };

    await expect(handleSettingsTestKeyPost({ provider: 'invalid', apiKey: 'test' }, services)).resolves.toMatchObject({
      status: 400,
      body: { ok: false, code: 'unknown', error: 'Invalid provider' },
    });
    await expect(handleSettingsTestKeyPost({ provider: 'anthropic' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: false, code: 'auth_error', error: 'No API key configured' },
    });
    await expect(handleSettingsTestKeyPost({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-4-6' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });
    await expect(handleSettingsTestKeyPost({ provider: 'p_saved' }, {
      ...services,
      testModel: async ({ provider, apiKey, model, baseUrl }: any) => {
        expect({ provider, apiKey, model, baseUrl }).toEqual({
          provider: 'openai',
          apiKey: 'saved-key',
          model: 'gpt-5.4',
          baseUrl: 'https://api.example/v1',
        });
      },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });
    await expect(handleSettingsTestKeyPost({ provider: 'google', apiKey: 'AI-key-test' }, {
      ...services,
      testModel: async () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: false, code: 'network_error', error: 'Request timed out' },
    });
    await expect(handleSettingsTestKeyPost({ provider: 'anthropic', apiKey: 'sk-test', model: 'missing' }, {
      ...services,
      testModel: async () => {
        throw new Error('404 Model not found: missing does not exist');
      },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: false, code: 'model_not_found' },
    });
  });

  it('lists AI provider models through product-owned provider resolution', async () => {
    const services = {
      isProviderId: (value: string) => ['anthropic', 'openai', 'ollama'].includes(value),
      isProviderEntryId: (value: string) => value.startsWith('p_'),
      readSettings: () => ({ ai: { providers: [{ id: 'p_saved', protocol: 'openai', apiKey: 'saved-key', baseUrl: 'https://api.example/v1' }] } }),
      findProvider: (providers: any[], id: string) => providers.find((provider) => provider.id === id),
      effectiveAiConfig: (provider: string) => ({ provider, apiKey: provider === 'openai' ? 'env-key' : '', baseUrl: '' }),
      supportsListModels: (provider: string) => provider !== 'anthropic',
      getRegistryModels: (provider: string) => [`${provider}-static`],
      getProviderApiType: () => 'openai-completions',
      getDefaultBaseUrl: (provider: string) => provider === 'openai' ? 'https://api.openai.test/v1' : '',
      buildEndpointCandidates: (baseUrl: string, path: string) => [`${baseUrl}${path}`],
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.3' }] }),
      }),
    };

    await expect(handleSettingsListModelsPost({ provider: 'invalid' }, services)).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Invalid provider' },
    });
    await expect(handleSettingsListModelsPost({ provider: 'anthropic' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, models: ['anthropic-static'] },
    });
    await expect(handleSettingsListModelsPost({ provider: 'openai' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, models: ['gpt-5.3', 'gpt-5.4'] },
    });
    await expect(handleSettingsListModelsPost({ provider: 'p_saved' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, models: ['gpt-5.3', 'gpt-5.4'] },
    });
    await expect(handleSettingsListModelsPost({ provider: 'ollama' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: false, error: 'No API key configured' },
    });
  });

  it('handles embedding status and download state through injected services', async () => {
    let resolveDownload!: (ok: boolean) => void;
    const downloadPromise = new Promise<boolean>((resolve) => { resolveDownload = resolve; });
    const services = {
      isLocalModelDownloaded: async (model?: string) => model === 'custom-model',
      downloadLocalModel: async () => downloadPromise,
      getEmbeddingStatus: () => ({ ready: false, building: true, docCount: 2 }),
      defaultLocalModel: 'default-model',
      localModelOptions: [{ id: 'default-model', label: 'Default' }],
    };

    await expect(handleEmbeddingGet(services)).resolves.toMatchObject({
      status: 200,
      body: {
        downloaded: false,
        defaultModel: 'default-model',
        models: [{ id: 'default-model', label: 'Default' }],
        ready: false,
        building: true,
        docCount: 2,
      },
    });

    await expect(handleEmbeddingPost({ action: 'download', model: 'custom-model' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, message: 'Downloading custom-model...' },
    });
    await expect(handleEmbeddingPost({ action: 'download', model: 'custom-model' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: false, error: 'Download already in progress' },
    });
    await expect(handleEmbeddingPost({ action: 'status', model: 'custom-model' }, services)).resolves.toMatchObject({
      status: 200,
      body: { downloading: true, downloaded: true, error: null },
    });

    resolveDownload(false);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(handleEmbeddingPost({ action: 'status', model: 'custom-model' }, services)).resolves.toMatchObject({
      status: 200,
      body: {
        downloading: false,
        downloaded: true,
        error: 'Download failed. Check your network connection and try again.',
      },
    });

    await expect(handleEmbeddingPost({ action: 'unknown' }, services)).resolves.toMatchObject({
      status: 400,
      body: { ok: false, error: 'Unknown action' },
    });
  });

  it('handles A2A JSON-RPC and discovery facades through injected protocol services', async () => {
    const task = { id: 'task-1', status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-05-09T00:00:00.000Z' } };
    const services = {
      handleSendMessage: async (params: any) => ({ ...task, history: [params.message] }),
      handleGetTask: (params: any) => params.id === 'task-1' ? task : null,
      handleCancelTask: (params: any) => params.id === 'task-1'
        ? { task: { ...task, status: { state: 'TASK_STATE_CANCELED', timestamp: '2026-05-09T00:00:00.000Z' } }, reason: 'canceled' as const }
        : { task: null, reason: 'not_found' as const },
      getDiscoveredAgents: () => [{ id: 'agent-1', endpoint: 'http://agent/api/a2a' }],
      getDelegationHistory: () => [{ id: 'delegation-1', agentId: 'agent-1' }],
      discoverAgent: async (url: string) => url === 'http://agent'
        ? { id: 'agent-1', endpoint: 'http://agent/api/a2a' }
        : null,
    };

    await expect(handleA2aPost({
      contentLength: 100_001,
      body: {},
    }, services)).resolves.toMatchObject({
      status: 413,
      body: { jsonrpc: '2.0', id: null, error: { code: -32600 } },
    });

    await expect(handleA2aPost({
      body: { jsonrpc: '2.0', id: '1', method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] } } },
    }, services)).resolves.toMatchObject({
      status: 200,
      body: { jsonrpc: '2.0', id: '1', result: { id: 'task-1' } },
    });

    await expect(handleA2aPost({
      body: { jsonrpc: '2.0', id: '2', method: 'GetTask', params: { id: 'missing' } },
    }, services)).resolves.toMatchObject({
      status: 200,
      body: { jsonrpc: '2.0', id: '2', error: { code: -32001, message: 'Task not found' } },
    });

    expect(handleA2aAgentsGet(services)).toMatchObject({
      status: 200,
      body: { agents: [{ id: 'agent-1' }] },
    });
    expect(handleA2aDelegationsGet(services)).toMatchObject({
      status: 200,
      body: { delegations: [{ id: 'delegation-1' }] },
    });
    await expect(handleA2aDiscoverPost({ url: '' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'URL is required' },
    });
    await expect(handleA2aDiscoverPost({ url: 'http://agent' }, services)).resolves.toMatchObject({
      status: 200,
      body: { agent: { id: 'agent-1' } },
    });
    expect(handleA2aOptions()).toMatchObject({
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });

  it('handles ACP control-plane routes through injected protocol services', async () => {
    let settings: { acpAgents?: Record<string, any> } = {
      acpAgents: { gemini: { command: 'gemini', args: ['--experimental-acp'] } },
    };
    let detectCalls = 0;
    const activeSession = { id: 'ses-1', agentId: 'gemini', state: 'idle' };
    const services = {
      readSettings: () => settings,
      writeSettings: (next: typeof settings) => {
        settings = next;
      },
      detectLocalAcpAgents: async (options?: any) => {
        detectCalls += 1;
        return {
          installed: [{ id: 'gemini', name: 'Gemini', binaryPath: '/usr/bin/gemini', overrides: options?.overrides }],
          notInstalled: [],
        };
      },
      installPackage: async (agentId: string, packageName: string) => ({ status: 'installing', agentId, packageName }),
      fetchAcpRegistry: async () => ({ version: 'test', agents: [{ id: 'gemini', name: 'Gemini' }], fetchedAt: '2026-05-09T00:00:00.000Z' }),
      findAcpAgent: async (agentId: string) => agentId === 'gemini' ? { id: 'gemini', name: 'Gemini' } : null,
      getActiveSessions: () => [activeSession],
      getSession: (sessionId: string) => sessionId === 'ses-1' ? activeSession : null,
      createSession: async (agentId: string, options?: any) => ({ ...activeSession, agentId, cwd: options?.cwd }),
      loadSession: async (agentId: string, sessionId: string) => ({ id: sessionId, agentId, state: 'idle' }),
      prompt: async (sessionId: string, text: string) => ({ sessionId, text: `echo:${text}`, done: true }),
      cancelPrompt: async () => {},
      closeSession: async () => {},
      setMode: async () => {},
      setConfigOption: async () => [{ id: 'tone', value: 'direct' }],
      listSessions: async () => ({ sessions: [{ sessionId: 'remote-1', title: 'Prior' }] }),
    };

    expect(handleAcpConfigGet(services)).toMatchObject({
      status: 200,
      body: { agents: { gemini: { command: 'gemini' } } },
    });
    expect(handleAcpConfigPost({
      agentId: 'claude',
      config: { command: ' claude ', args: ['--acp', 1], env: { GOOD: 'yes', BAD: 1 }, enabled: false },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, agents: { claude: { command: 'claude', args: ['--acp'], env: { GOOD: 'yes' }, enabled: false } } },
    });
    expect(handleAcpConfigDelete({ agentId: 'claude' }, services)).toMatchObject({
      status: 200,
      body: { ok: true },
    });

    await expect(handleAcpDetectGet(new URLSearchParams(), services)).resolves.toMatchObject({
      status: 200,
      body: { installed: [{ id: 'gemini' }] },
    });
    await expect(handleAcpDetectGet(new URLSearchParams(), services)).resolves.toMatchObject({
      status: 200,
      body: { installed: [{ id: 'gemini' }] },
    });
    expect(detectCalls).toBe(1);
    await handleAcpDetectGet(new URLSearchParams('force=1'), services);
    expect(detectCalls).toBe(2);

    await expect(handleAcpInstallPost({ agentId: 'claude', packageName: '../bad' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid package name' },
    });
    await expect(handleAcpInstallPost({ agentId: 'claude', packageName: '@anthropic-ai/claude-code' }, services)).resolves.toMatchObject({
      status: 200,
      body: { status: 'installing', agentId: 'claude' },
    });

    await expect(handleAcpRegistryGet(new URLSearchParams('agent=gemini'), services)).resolves.toMatchObject({
      status: 200,
      body: { agent: { id: 'gemini' } },
    });
    await expect(handleAcpRegistryGet(new URLSearchParams('agent=missing'), services)).resolves.toMatchObject({
      status: 404,
      body: { error: 'Agent not found', agent: null },
    });
    await expect(handleAcpRegistryGet(new URLSearchParams(), services)).resolves.toMatchObject({
      status: 200,
      body: { registry: { agents: [{ id: 'gemini' }] } },
    });

    expect(handleAcpSessionGet(services)).toMatchObject({
      status: 200,
      body: { sessions: [activeSession] },
    });
    await expect(handleAcpSessionPost({ agentId: 'gemini', cwd: '/tmp' }, services)).resolves.toMatchObject({
      status: 200,
      body: { session: { id: 'ses-1', cwd: '/tmp' } },
    });
    await expect(handleAcpSessionPost({ action: 'prompt', sessionId: 'ses-1', text: 'hi' }, services)).resolves.toMatchObject({
      status: 200,
      body: { response: { text: 'echo:hi' } },
    });
    await expect(handleAcpSessionPost({ action: 'set_config', sessionId: 'ses-1', configId: 'tone', value: 'direct' }, services)).resolves.toMatchObject({
      status: 200,
      body: { configOptions: [{ id: 'tone', value: 'direct' }] },
    });
    await expect(handleAcpSessionPost({ action: 'unknown' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'Unknown action: unknown' },
    });
    await expect(handleAcpSessionDelete({ sessionId: 'ses-1' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });

  it('resolves ACP npm installs through node on Windows instead of npm.cmd', () => {
    const invocation = resolveNpmInvocation(['install', '-g', '@agent/package'], {
      platform: 'win32',
      nodeExecPath: 'C:\\Program Files\\MindOS\\node.exe',
      env: { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
      pathExists: (filePath) => filePath.endsWith('npm-cli.js'),
    });

    expect(invocation).toEqual({
      command: 'C:\\Program Files\\MindOS\\node.exe',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'install', '-g', '@agent/package'],
    });
  });

  it('keeps ACP npm installs on PATH lookup outside Windows', () => {
    expect(resolveNpmInvocation(['install', '-g', '@agent/package'], { platform: 'darwin' })).toEqual({
      command: 'npm',
      args: ['install', '-g', '@agent/package'],
    });
  });

  it('handles MCP status with endpoint derivation and self-health check', async () => {
    const res = await handleMcpStatus({
      env: { MINDOS_MCP_PORT: '8567' },
      readSettings: () => ({
        authToken: 'token-secret',
        connectionMode: { cli: false, mcp: true },
      }),
      fetchHealth: async (url, timeoutMs) => {
        expect(url).toBe('http://127.0.0.1:8567/api/health');
        expect(timeoutMs).toBe(2000);
        return { ok: true, body: { ok: true, service: 'mindos' } };
      },
      getLocalIP: () => '192.168.1.2',
      maskToken: (token) => `masked:${token}`,
    }, {
      host: 'mindos.local:4567',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      running: true,
      transport: 'http',
      endpoint: 'http://mindos.local:8567/mcp',
      port: 8567,
      toolCount: 24,
      authConfigured: true,
      maskedToken: 'masked:token-secret',
      authToken: 'token-secret',
      localIP: '192.168.1.2',
      connectionMode: { cli: false, mcp: true },
    });
  });

  it('treats MCP health failures as not running', async () => {
    const res = await handleMcpStatus({
      readSettings: () => ({}),
      fetchHealth: async () => {
        throw new Error('connection refused');
      },
      getLocalIP: () => null,
      maskToken: (token) => token,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      running: false,
      endpoint: 'http://127.0.0.1:8781/mcp',
      toolCount: 0,
      authConfigured: false,
      connectionMode: { cli: true, mcp: false },
    });
  });
});
