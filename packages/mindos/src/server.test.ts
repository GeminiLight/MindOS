import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer as createNodeServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CORS_HEADERS,
  createDefaultSkillAgentRegistry,
  createDefaultMindosHttpServices,
  createMindosHttpServer,
  handleFiles,
  handleFileGet,
  handleFilePost,
  handleCodexThreadsGet,
  handleGit,
  handleGraph,
  handleAskStream,
  handleAgentActivity,
  handleAssistantsDelete,
  handleAssistantsGet,
  handleAssistantsPost,
  handleAgentRuntimesGet,
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
  handleImFeishuOAuthCallbackGet,
  handleImFeishuOAuthGet,
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
  handleMcpTokenReveal,
  handleMcpAgentsGet,
  handleRawFile,
  handleRecentFiles,
  handleSearch,
  handleSearchPrewarm,
  createMindosHealth,
  collectAllFilesFromMindRoot,
  getDefaultMindRoot,
  getMindosServerContract,
  getRecentlyModifiedFromMindRoot,
  readTextFileFromMindRoot,
  getTreeVersionFromMindRoot,
  searchMindRoot,
  readMindosProductVersion
} from './server.js';

describe('MindOS server contract: core, files, HTTP', () => {
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
      id: 'skills.matrix',
      method: 'GET',
      path: '/api/skills/matrix',
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
      id: 'assistants.create',
      method: 'POST',
      path: '/api/assistants',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'assistants.delete',
      method: 'DELETE',
      path: '/api/assistants',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'assistants',
      method: 'GET',
      path: '/api/assistants',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-runtimes',
      method: 'GET',
      path: '/api/agent-runtimes',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-runtimes.codex.threads',
      method: 'GET',
      path: '/api/agent-runtimes/codex/threads',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-runtimes.codex.thread',
      method: 'GET',
      path: '/api/agent-runtimes/codex/threads/[threadId]',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-runtimes.codex.thread.fork',
      method: 'POST',
      path: '/api/agent-runtimes/codex/threads/[threadId]/fork',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-runtimes.codex.thread.archive',
      method: 'POST',
      path: '/api/agent-runtimes/codex/threads/[threadId]/archive',
      auth: 'required',
    });
    expect(contract.routes).toContainEqual({
      id: 'agent-runtimes.codex.thread.unarchive',
      method: 'POST',
      path: '/api/agent-runtimes/codex/threads/[threadId]/unarchive',
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

  it('loads local assistants from the hidden assistant registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-assistants-'));
    try {
      mkdirSync(join(root, '.mindos', 'assistants', 'daily-signal'), { recursive: true });
      mkdirSync(join(root, '.mindos', 'assistants', 'Bad Name'), { recursive: true });
      writeFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'prompt.md'), `---
owner: Research
tools: read_notes, web-search
skills: signal-curation
context: MIND_DAO
triggers: Daily review
guardrails: Cite sources
---

# Daily Signal

## Role

Collect weak signals and summarize them.

## Inputs

- Recent notes
- Decision logs

## Output

Write a concise signal brief.

## Boundaries

- Do not overwrite source notes.
`, 'utf-8');
      writeFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'profile.json'), JSON.stringify({
        name: 'Morning signal editor',
        description: 'Prepare a shorter morning brief.',
        schemaVersion: 1,
        preferredAgent: 'mindos-agent',
        skills: ['signal-curation'],
        mcp: ['arxiv'],
        schedule: { mode: 'daily' },
        surface: 'Overview',
        owner: 'Local Research',
        tools: ['read_notes'],
        context: ['MIND_DAO'],
        triggers: ['Daily review'],
        guardrails: ['Cite sources'],
      }), 'utf-8');
      writeFileSync(join(root, '.mindos', 'assistants', 'Bad Name', 'prompt.md'), '# Unsafe name\n', 'utf-8');

      const response = handleAssistantsGet({ mindRoot: root });
      const body = response.body as {
        root: string;
        assistants: Array<{
          id: string;
          name: string;
          description: string;
          source: 'builtin' | 'custom';
          deletable: boolean;
          preferredAgent?: string;
          skills: string[];
          mcp: string[];
          paths: { root: string; profile: string; prompt: string };
          prompt: { exists: boolean; content?: string };
          health: { state: string; issues: Array<{ code: string }> };
          promptReady: boolean;
          profileReady: boolean;
        }>;
      };

      expect(response.status).toBe(200);
      expect(body.root).toBe('.mindos/assistants');
      expect(body.assistants).toHaveLength(1);
      expect(body.assistants[0]).toMatchObject({
        id: 'daily-signal',
        name: 'Morning signal editor',
        description: 'Prepare a shorter morning brief.',
        source: 'builtin',
        deletable: false,
        preferredAgent: 'mindos-agent',
        skills: ['signal-curation'],
        mcp: ['arxiv'],
        paths: {
          root: '.mindos/assistants/daily-signal',
          profile: '.mindos/assistants/daily-signal/profile.json',
          prompt: '.mindos/assistants/daily-signal/prompt.md',
        },
        prompt: {
          exists: true,
        },
        health: {
          state: 'ready',
          issues: [],
        },
        promptReady: true,
        profileReady: true,
      });
      expect(body.assistants[0]?.prompt.content).toContain('# Daily Signal');
      expect(body.assistants[0]).not.toHaveProperty('sections');
      expect(body.assistants[0]).not.toHaveProperty('metadata');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates custom assistants with minimal profile and prompt files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-assistant-create-'));
    try {
      const response = handleAssistantsPost({
        id: 'research-scout',
        name: 'Research Scout',
        description: 'Finds useful local research follow-ups.',
        preferredAgent: 'mindos-agent',
        skills: ['mindos', 'mindos'],
        mcp: ['arxiv'],
        permissionMode: 'readonly',
        schedule: { mode: 'daily' },
        surface: ['agents'],
        outputPolicy: { mode: 'draft' },
        tools: ['write_file'],
      }, { mindRoot: root });
      const body = response.body as {
        ok: true;
        id: string;
        paths: { root: string; profile: string; prompt: string };
      };

      expect(response.status).toBe(201);
      expect(body).toMatchObject({
        ok: true,
        id: 'research-scout',
        paths: {
          root: '.mindos/assistants/research-scout',
          profile: '.mindos/assistants/research-scout/profile.json',
          prompt: '.mindos/assistants/research-scout/prompt.md',
        },
      });

      const savedProfile = JSON.parse(readFileSync(join(root, body.paths.profile), 'utf-8')) as Record<string, unknown>;
      expect(savedProfile).toMatchObject({
        name: 'Research Scout',
        description: 'Finds useful local research follow-ups.',
        schemaVersion: 1,
        preferredAgent: 'mindos-agent',
        skills: ['mindos'],
        mcp: ['arxiv'],
      });
      expect(savedProfile).not.toHaveProperty('permissionMode');
      expect(savedProfile).not.toHaveProperty('schedule');
      expect(savedProfile).not.toHaveProperty('surface');
      expect(savedProfile).not.toHaveProperty('outputPolicy');
      expect(savedProfile).not.toHaveProperty('tools');
      expect(readFileSync(join(root, body.paths.prompt), 'utf-8')).toContain('# Research Scout');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('protects built-in assistants and deletes custom assistant directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-assistant-delete-'));
    try {
      mkdirSync(join(root, '.mindos', 'assistants', 'daily-signal'), { recursive: true });
      writeFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'profile.json'), JSON.stringify({
        name: 'Daily Signal',
        schemaVersion: 1,
        preferredAgent: 'mindos-agent',
        skills: [],
        mcp: [],
      }), 'utf-8');
      writeFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'prompt.md'), '# Daily Signal\n', 'utf-8');
      const custom = handleAssistantsPost({ id: 'custom-research', name: 'Custom Research' }, { mindRoot: root });

      const createBuiltin = handleAssistantsPost({ id: 'daily-signal', name: 'Override' }, { mindRoot: root });
      const deleteBuiltin = handleAssistantsDelete({ id: 'daily-signal' }, { mindRoot: root });
      const deleteCustom = handleAssistantsDelete({ id: 'custom-research' }, { mindRoot: root });
      const listed = handleAssistantsGet({ mindRoot: root }).body as {
        assistants: Array<{ id: string }>;
      };

      expect(custom.status).toBe(201);
      expect(createBuiltin.status).toBe(409);
      expect(deleteBuiltin.status).toBe(403);
      expect(deleteCustom.status).toBe(200);
      expect(listed.assistants.some((item) => item.id === 'daily-signal')).toBe(true);
      expect(listed.assistants.some((item) => item.id === 'custom-research')).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  it('exposes the default MCP agent registry from the product HTTP runtime', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-product-agents-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-product-agents-root-'));
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
    mkdirSync(join(home, '.config', 'kilo'), { recursive: true });
    writeFileSync(join(home, '.claude.json'), JSON.stringify({
      mcpServers: {
        mindos: { type: 'stdio', command: 'mindos', args: ['mcp'] },
      },
    }), 'utf-8');
    writeFileSync(join(home, '.codex', 'config.toml'), [
      '[mcp_servers.mindos]',
      'type = "stdio"',
      'command = "mindos"',
    ].join('\n'), 'utf-8');
    writeFileSync(join(home, '.config', 'kilo', 'kilo.json'), JSON.stringify({
      mcp: {
        mindos: {
          type: 'local',
          command: ['mindos', 'mcp'],
          environment: { MCP_TRANSPORT: 'stdio' },
          enabled: true,
        },
      },
    }), 'utf-8');

    const services = createDefaultMindosHttpServices({
      homeDir: home,
      runtimeRoot: root,
      readSettings: () => ({ mindRoot: join(home, 'MindOS', 'mind') }),
    });
    const response = await handleMcpAgentsGet({
      agents: services.mcpAgents ?? {},
      readSettings: services.readSettings,
      homeDir: home,
      mindRoot: join(home, 'MindOS', 'mind'),
      projectRoot: root,
      env: {} as NodeJS.ProcessEnv,
      commandExists: () => false,
      skillAgentRegistry: createDefaultSkillAgentRegistry(),
    });

    expect(Object.keys(services.mcpAgents ?? {})).toHaveLength(27);
    expect(response.status).toBe(200);
    const agents = response.body.agents;
    expect(agents).toHaveLength(27);
    expect(agents.find((agent) => agent.key === 'mindos')).toMatchObject({
      present: true,
      installed: true,
    });
    expect(agents.find((agent) => agent.key === 'claude-code')).toMatchObject({
      present: true,
      installed: true,
      configuredMcpServers: ['mindos'],
    });
    expect(agents.find((agent) => agent.key === 'codex')).toMatchObject({
      present: true,
      installed: true,
      configuredMcpServers: ['mindos'],
    });
    expect(agents.find((agent) => agent.key === 'kilo-code')).toMatchObject({
      configKey: 'mcp',
      entryStyle: 'kilo',
      installed: true,
      transport: 'stdio',
      configPath: '~/.config/kilo/kilo.json',
      configuredMcpServers: ['mindos'],
      globalPath: '~/.config/kilo/kilo.jsonc',
      skillMode: 'universal',
      skillWorkspacePath: join(home, '.agents', 'skills'),
    });
    expect(agents.find((agent) => agent.key === 'warp')).toMatchObject({
      configKey: 'mcpServers',
      globalPath: '~/.warp/.mcp.json',
      projectPath: '.warp/.mcp.json',
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

  it('does not read Product Server space descriptions through symlinked README files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-spaces-readme-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-spaces-readme-outside-'));
    mkdirSync(join(root, 'SpaceA'), { recursive: true });
    writeFileSync(join(root, 'SpaceA', 'note.md'), 'hello', 'utf-8');
    writeFileSync(join(outside, 'README.md'), '# Outside\n\nLeaked description.\n', 'utf-8');
    symlinkSync(join(outside, 'README.md'), join(root, 'SpaceA', 'README.md'), 'file');

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
        fileCount: 1,
        description: '',
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

  it('rejects Product Server conflict checks through symlinked spaces outside mindRoot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-conflict-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-file-conflict-symlink-outside-'));
    writeFileSync(join(outside, 'hello.md'), 'outside', 'utf-8');
    symlinkSync(outside, join(root, 'Linked'), 'dir');

    const res = handleFileGet(new URLSearchParams('op=check_conflicts&space=Linked&names=hello.md'), {
      mindRoot: root,
      readTextFile: () => '',
      readLines: () => [],
      listSpaces: () => [],
      listDirectories: () => [],
    });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access denied' });
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

  it('rejects destructive file operations against built-in Assistant directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-builtin-assistant-protect-'));
    mkdirSync(join(root, '.mindos', 'assistants', 'daily-signal'), { recursive: true });
    mkdirSync(join(root, 'Archive'), { recursive: true });
    writeFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'prompt.md'), '# Daily Signal\n', 'utf-8');
    writeFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'profile.json'), '{"name":"Daily Signal"}\n', 'utf-8');

    const deleteDirectory = await handleFilePost(
      { op: 'delete_file', path: '.mindos/assistants/daily-signal' },
      { mindRoot: root },
    );
    const deletePrompt = await handleFilePost(
      { op: 'delete_file', path: '.mindos/assistants/daily-signal/prompt.md' },
      { mindRoot: root },
    );
    const renameDirectory = await handleFilePost(
      { op: 'rename_space', path: '.mindos/assistants/daily-signal', new_name: 'daily-signal-old' },
      { mindRoot: root },
    );
    const movePrompt = await handleFilePost(
      { op: 'move_file', path: '.mindos/assistants/daily-signal/prompt.md', to_path: 'Archive/daily-signal.md' },
      { mindRoot: root },
    );

    expect(deleteDirectory.status).toBe(403);
    expect(deletePrompt.status).toBe(403);
    expect(renameDirectory.status).toBe(403);
    expect(movePrompt.status).toBe(403);
    expect(existsSync(join(root, '.mindos', 'assistants', 'daily-signal'))).toBe(true);
    expect(readFileSync(join(root, '.mindos', 'assistants', 'daily-signal', 'prompt.md'), 'utf-8')).toBe('# Daily Signal\n');
    expect(existsSync(join(root, 'Archive', 'daily-signal.md'))).toBe(false);
  });

  it('returns POSIX knowledge paths after Product Server file moves', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-move-paths-'));
    mkdirSync(join(root, 'Source'), { recursive: true });
    writeFileSync(join(root, 'Source', 'note.md'), 'content', 'utf-8');

    const moved = await handleFilePost(
      { op: 'move_file', path: 'Source\\note.md', to_path: 'Archive\\moved.md' },
      { mindRoot: root },
    );

    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({
      ok: true,
      path: 'Archive/moved.md',
      newPath: 'Archive/moved.md',
    });
    expect(moved.changeEvent).toMatchObject({
      op: 'move_file',
      path: 'Archive/moved.md',
      beforePath: 'Source/note.md',
      afterPath: 'Archive/moved.md',
    });
    expect(existsSync(join(root, 'Source', 'note.md'))).toBe(false);
    expect(readFileSync(join(root, 'Archive', 'moved.md'), 'utf-8')).toBe('content');
  });

  it('returns POSIX knowledge paths after Product Server content edits', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-edit-paths-'));
    mkdirSync(join(root, 'Space'), { recursive: true });
    writeFileSync(join(root, 'Space', 'note.md'), '# Title\n\nBody', 'utf-8');
    writeFileSync(join(root, 'Space', 'table.csv'), 'name\n', 'utf-8');

    const inserted = await handleFilePost(
      { op: 'insert_after_heading', path: 'Space\\note.md', heading: 'Title', content: 'Inserted' },
      { mindRoot: root },
    );
    expect(inserted.status).toBe(200);
    expect(inserted.body).toMatchObject({ ok: true, path: 'Space/note.md' });
    expect(inserted.changeEvent).toMatchObject({ path: 'Space/note.md' });

    const appended = await handleFilePost(
      { op: 'append_csv', path: 'Space\\table.csv', row: ['Ada'] },
      { mindRoot: root },
    );
    expect(appended.status).toBe(200);
    expect(appended.body).toMatchObject({ ok: true, path: 'Space/table.csv', newRowCount: 2 });
    expect(appended.changeEvent).toMatchObject({ path: 'Space/table.csv' });
  });

  it('rejects Product Server delete when trash directory is a symlink outside root parent', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'mindos-file-trash-parent-'));
    const root = join(parent, 'mind');
    const outside = mkdtempSync(join(tmpdir(), 'mindos-file-trash-outside-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'note.md'), 'hello', 'utf-8');
    symlinkSync(outside, join(parent, '.trash'), 'dir');

    const deleted = await handleFilePost({ op: 'delete_file', path: 'note.md' }, { mindRoot: root });

    expect(deleted.status).toBe(403);
    expect(deleted.body).toEqual({ error: 'Access denied' });
    expect(existsSync(join(root, 'note.md'))).toBe(true);
    expect(existsSync(join(outside, 'note.md'))).toBe(false);
  });

  it('rejects Product Server writes through symlinks that resolve outside mindRoot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-file-symlink-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'outside', 'utf-8');
    symlinkSync(outside, join(root, 'linked-outside'), 'dir');

    const saved = await handleFilePost(
      { op: 'save_file', path: 'linked-outside/secret.md', content: 'changed' },
      { mindRoot: root },
    );

    expect(saved.status).toBe(403);
    expect(readFileSync(join(outside, 'secret.md'), 'utf-8')).toBe('outside');

    const created = await handleFilePost(
      { op: 'create_file', path: 'linked-outside/new.md', content: 'created' },
      { mindRoot: root },
    );

    expect(created.status).toBe(403);
    expect(existsSync(join(outside, 'new.md'))).toBe(false);
  });

  it('rejects Product Server legacy agent audit writes through symlinked metadata directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-file-audit-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-file-audit-symlink-outside-'));
    symlinkSync(outside, join(root, '.mindos'), 'dir');

    const res = await handleFilePost(
      {
        op: 'append_to_file',
        path: '.agent-log.json',
        content: '{"tool":"legacy","params":{},"result":"ok"}\n',
      },
      { mindRoot: root },
    );

    expect(res.status).toBe(403);
    expect(existsSync(join(outside, 'agent-audit-log.json'))).toBe(false);
  });

  it('rejects Product runtime reads through symlinks that resolve outside mindRoot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-runtime-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-runtime-symlink-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'outside', 'utf-8');
    symlinkSync(outside, join(root, 'linked-outside'), 'dir');

    expect(() => readTextFileFromMindRoot(root, 'linked-outside/secret.md')).toThrow(/Access denied/i);
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

    const windowsReservedSpace = await handleFilePost({ op: 'rename_space', path: 'Space', new_name: 'CON' }, { mindRoot: root });
    expect(windowsReservedSpace.status).toBe(400);
    expect(existsSync(join(root, 'Space'))).toBe(true);

    const windowsInvalidSpace = await handleFilePost({ op: 'rename_space', path: 'Space', new_name: 'bad:name' }, { mindRoot: root });
    expect(windowsInvalidSpace.status).toBe(400);
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
        documentExtraction: {
          extractPdf: async () => ({ text: 'PDF text', pages: 1 }),
          extractDocx: async () => ({
            text: 'Word text',
            markdown: 'Word text',
            extracted: true,
            pages: 1,
            chars: 9,
            truncated: false,
            charsTruncated: 0,
            imageCount: 0,
            hasCharts: false,
          }),
        },
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
      expect(await (await fetch(`${base}/api/extract-pdf`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'paper.pdf',
          dataBase64: Buffer.from('%PDF-1.4').toString('base64'),
        }),
      })).json()).toMatchObject({ name: 'paper.pdf', extracted: 'success', text: 'PDF text' });
      expect(await (await fetch(`${base}/api/extract-docx`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'brief.docx',
          dataBase64: Buffer.from('docx').toString('base64'),
        }),
      })).json()).toMatchObject({ name: 'brief.docx', extracted: true, text: 'Word text' });
      expect((await fetch(`${base}/missing`)).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves the unified skill matrix with MindOS as the self column over HTTP', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-skill-matrix-'));
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      services: createDefaultMindosHttpServices({
        homeDir: root,
        readSettings: () => ({ mindRoot: root }),
      }),
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/skills/matrix`);
      expect(response.status).toBe(200);
      const matrix = await response.json() as {
        skills: unknown[];
        agents: Array<{ key: string; name: string; mode: string }>;
        state: Record<string, Record<string, boolean>>;
        cells: Record<string, Record<string, { enabled: boolean; status: string }>>;
      };
      expect(Array.isArray(matrix.skills)).toBe(true);
      expect(matrix.agents[0]).toMatchObject({ key: 'mindos', mode: 'self' });
      expect(matrix.state).toEqual(expect.any(Object));
      expect(matrix.cells).toEqual(expect.any(Object));
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('migrates legacy copy-install records and clears the ledger on first skill matrix read', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-http-matrix-migrate-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-matrix-migrate-root-'));
    const configDir = join(home, '.mindos');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      mindRoot: root,
      installedSkillAgents: [{ agent: 'ghost-agent', skill: 'ghost-skill', path: join(home, 'ghost') }],
    }), 'utf-8');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtime: { homeDir: home },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/skills/matrix`);
      expect(response.status).toBe(200);
      const saved = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
      expect(saved.installedSkillAgents).toEqual([]);
      expect(saved.mindRoot).toBe(root);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('routes Channel APIs through Product HTTP services instead of default stubs', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-http-channel-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-channel-root-'));
    const configDir = join(home, '.mindos');
    const imConfigPath = join(configDir, 'im.json');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(imConfigPath, JSON.stringify({
      providers: {
        telegram: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
      },
    }), 'utf-8');

    const verifyCalls: any[] = [];
    const sendCalls: any[] = [];
    const feishuConfig = {
      app_id: 'cli_app',
      app_secret: 'secret',
      conversation: {
        enabled: true,
        transport: 'webhook',
        public_base_url: 'https://mindos.example',
        encrypt_key: 'encrypt',
      },
    };
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      services: {
        ...createDefaultMindosHttpServices({
          homeDir: home,
          readSettings: () => ({ mindRoot: root }),
        }),
        channels: {
          configPath: imConfigPath,
          verifyCredentials: async (platform, credentials) => {
            verifyCalls.push({ platform, credentials });
            return { ok: true, botName: 'MindOS Telegram', botId: 'bot_1' };
          },
          sendIMMessage: async (message, signal, options) => {
            sendCalls.push({ message, signal, options });
            return { ok: true, messageId: 'msg_1', timestamp: '2026-06-10T00:00:00.000Z' };
          },
          hasAnyIMConfig: () => true,
          listConfiguredIM: async () => [
            { platform: 'feishu', connected: true, botName: 'MindOS Feishu', capabilities: ['text'] },
          ],
          getPlatformConfig: (platform) => platform === 'feishu' ? feishuConfig : undefined,
          buildFeishuWebhookStatus: (config) => ({
            platform: 'feishu',
            state: config === feishuConfig ? 'ready' : 'disabled',
            transport: 'webhook',
            publicBaseUrl: 'https://mindos.example',
            webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
          }),
        },
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const config = await fetch(`${base}/api/im/config`);
      expect(config.status).toBe(200);
      expect(await config.json()).toMatchObject({
        providers: {
          telegram: { bot_token: '1234••••YZ' },
        },
      });

      const verify = await fetch(`${base}/api/channels/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
        }),
      });
      expect(verify.status).toBe(200);
      expect(await verify.json()).toEqual({ ok: true, botName: 'MindOS Telegram', botId: 'bot_1' });
      expect(verifyCalls).toEqual([{
        platform: 'telegram',
        credentials: { bot_token: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
      }]);

      const test = await fetch(`${base}/api/im/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'feishu', recipient_id: 'ou_123', message: 'hello' }),
      });
      expect(test.status).toBe(200);
      expect(await test.json()).toEqual({
        ok: true,
        messageId: 'msg_1',
        timestamp: '2026-06-10T00:00:00.000Z',
      });
      expect(sendCalls).toEqual([{
        message: { platform: 'feishu', recipientId: 'ou_123', text: 'hello', format: 'text' },
        signal: undefined,
        options: { activityType: 'test' },
      }]);

      const status = await fetch(`${base}/api/im/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        platforms: [
          {
            platform: 'feishu',
            connected: true,
            webhook: {
              state: 'ready',
              webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
            },
          },
        ],
      });

      const webhook = await fetch(`${base}/api/im/webhook-status?platform=feishu`);
      expect(webhook.status).toBe(200);
      expect(await webhook.json()).toMatchObject({
        status: {
          platform: 'feishu',
          state: 'ready',
          webhookUrl: 'https://mindos.example/api/im/webhook/feishu',
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('returns client errors for invalid HTTP JSON bodies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-json-errors-'));
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
      const invalid = await fetch(`${base}/api/setup/generate-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: '{bad json',
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: 'Invalid JSON body' });

      const oversized = await fetch(`${base}/api/setup/generate-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ seed: 'x'.repeat(1_000_001) }),
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({ error: 'Request body too large' });
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
      const protectedCodexRoutes: Array<{ path: string; init?: RequestInit }> = [
        { path: '/api/agent-runtimes/codex/threads' },
        { path: '/api/agent-runtimes/codex/threads/thr-existing' },
        { path: '/api/agent-runtimes/codex/threads/thr-existing/fork', init: { method: 'POST', body: '{}' } },
        { path: '/api/agent-runtimes/codex/threads/thr-existing/archive', init: { method: 'POST' } },
        { path: '/api/agent-runtimes/codex/threads/thr-existing/unarchive', init: { method: 'POST' } },
        { path: '/api/agent-runtimes/codex/threads/thr-existing/delete', init: { method: 'POST' } },
      ];
      for (const route of protectedCodexRoutes) {
        expect((await fetch(`${base}${route.path}`, route.init)).status, route.path).toBe(401);
      }
      expect((await fetch(`${base}/api/agent-runtimes/codex/threads/thr-existing/delete`, {
        method: 'POST',
        headers: { authorization: 'Bearer secret-token' },
      })).status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('dispatches Codex thread manager routes through the Product HTTP server without starting turns', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-codex-threads-'));
    const calls: string[] = [];
    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      services: {
        ...createDefaultMindosHttpServices({
          readSettings: () => ({ mindRoot: root, authToken: 'secret-token' }),
        }),
        createCodexClient: async () => ({
          initialize: async () => {
            calls.push('initialize');
          },
          listThreads: async () => {
            calls.push('thread/list');
            return {
              data: [{
                id: 'thr-existing',
                sessionId: 'sess-existing',
                preview: 'Existing Codex thread',
                turns: [],
              }],
              nextCursor: null,
              backwardsCursor: null,
            };
          },
          readThread: async (input) => {
            calls.push(`thread/read:${input.threadId}:${input.includeTurns ? 'turns' : 'summary'}`);
            return {
              thread: {
                id: input.threadId,
                preview: 'Existing Codex thread',
                turns: input.includeTurns ? [{ id: 'turn-existing' }] : [],
              },
            };
          },
          forkThread: async (input) => {
            calls.push(`thread/fork:${input.threadId}`);
            return { thread: { id: 'thr-forked', forkedFromId: input.threadId, turns: [] } };
          },
          archiveThread: async (input) => {
            calls.push(`thread/archive:${input.threadId}`);
          },
          unarchiveThread: async (input) => {
            calls.push(`thread/unarchive:${input.threadId}`);
            return { thread: { id: input.threadId, turns: [] } };
          },
          startThread: vi.fn(),
          resumeThread: vi.fn(),
          startTurn: vi.fn(),
          close: async () => {
            calls.push('close');
          },
        }),
      },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    const auth = { authorization: 'Bearer secret-token' };

    try {
      const list = await fetch(`${base}/api/agent-runtimes/codex/threads?limit=10`, { headers: auth });
      const read = await fetch(`${base}/api/agent-runtimes/codex/threads/thr-existing?includeTurns=1`, { headers: auth });
      const fork = await fetch(`${base}/api/agent-runtimes/codex/threads/thr-existing/fork`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: '/tmp/forked' }),
      });
      const archive = await fetch(`${base}/api/agent-runtimes/codex/threads/thr-existing/archive`, {
        method: 'POST',
        headers: auth,
      });
      const unarchive = await fetch(`${base}/api/agent-runtimes/codex/threads/thr-existing/unarchive`, {
        method: 'POST',
        headers: auth,
      });

      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({
        data: [expect.objectContaining({ id: 'thr-existing' })],
        nextCursor: null,
        backwardsCursor: null,
      });
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual({
        thread: expect.objectContaining({
          id: 'thr-existing',
          turns: [{ id: 'turn-existing' }],
        }),
      });
      expect(fork.status).toBe(200);
      expect(archive.status).toBe(200);
      expect(unarchive.status).toBe(200);
      expect(calls).toEqual([
        'initialize',
        'thread/list',
        'close',
        'initialize',
        'thread/read:thr-existing:turns',
        'close',
        'initialize',
        'thread/fork:thr-existing',
        'close',
        'initialize',
        'thread/archive:thr-existing',
        'close',
        'initialize',
        'thread/unarchive:thr-existing',
        'close',
      ]);
      expect(calls).not.toContain('turn/start');
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('returns structured Codex thread diagnostics when the local runtime is unavailable', async () => {
    const res = await handleCodexThreadsGet(new URLSearchParams('limit=10'), {
      resolveRuntimeCommand: async () => '/usr/local/bin/codex',
      checkCodexRuntimeHealth: async () => ({
        status: 'signed-out',
        reason: 'Codex model provider "custom" requires STAFF_KEY.',
      }),
    });

    expect(res).toEqual({
      status: 409,
      body: {
        error: 'Codex is signed out. Codex model provider "custom" requires STAFF_KEY.',
      },
    });
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

  it('preserves unrelated Product Server config fields when settings are saved', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-http-settings-merge-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-settings-merge-root-'));
    const configDir = join(home, '.mindos');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      mindRoot: root,
      authToken: 'secret-token',
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
      webSearch: { provider: 'auto', exaApiKey: 'old-key' },
      disabledSkills: ['legacy-skill'],
      acpAgents: { codex: { enabled: true } },
      customAgents: [{ key: 'local-agent', name: 'Local Agent' }],
      installedSkillAgents: [{ agent: 'codex', skill: 'mindos', path: '/tmp/skill' }],
    }), 'utf-8');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtime: { homeDir: home },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetch(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({
          ai: {
            activeProvider: 'anthropic',
            providers: [
              { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
              { id: 'p_anthropic01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
            ],
          },
          webSearch: { provider: 'exa', exaApiKey: 'new-key' },
        }),
      });
      expect(response.status).toBe(200);
      const saved = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'));
      expect(saved.ai.activeProvider).toBe('p_anthropic01');
      expect(saved.webSearch).toEqual({ provider: 'exa', exaApiKey: 'new-key' });
      expect(saved.disabledSkills).toEqual(['legacy-skill']);
      expect(saved.acpAgents).toEqual({ codex: { enabled: true } });
      expect(saved.customAgents).toEqual([{ key: 'local-agent', name: 'Local Agent' }]);
      expect(saved.installedSkillAgents).toEqual([{ agent: 'codex', skill: 'mindos', path: '/tmp/skill' }]);
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('resolves Product Server p_* provider routes with env fallback', async () => {
    const oldOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'env-openai-key';

    const fakeApi = createNodeServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer env-openai-key');
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'gpt-test' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise<void>((resolve) => fakeApi.listen(0, '127.0.0.1', resolve));
    const fakeAddress = fakeApi.address();
    if (!fakeAddress || typeof fakeAddress === 'string') throw new Error('expected fake TCP server address');
    const fakeBaseUrl = `http://127.0.0.1:${fakeAddress.port}/v1`;

    const home = mkdtempSync(join(tmpdir(), 'mindos-http-provider-home-'));
    const root = mkdtempSync(join(tmpdir(), 'mindos-http-provider-root-'));
    const configDir = join(home, '.mindos');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      mindRoot: root,
      authToken: 'secret-token',
      ai: {
        activeProvider: 'p_saved',
        providers: [
          { id: 'p_saved', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-test', baseUrl: fakeBaseUrl },
        ],
      },
    }), 'utf-8');

    const app = createMindosHttpServer({
      hostname: '127.0.0.1',
      port: 0,
      runtime: { homeDir: home },
    });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP server address');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const list = await fetch(`${base}/api/settings/list-models`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
        body: JSON.stringify({ provider: 'p_saved' }),
      });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ ok: true, models: ['gpt-test'] });

      const test = await fetch(`${base}/api/settings/test-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token' },
        body: JSON.stringify({ provider: 'p_saved' }),
      });
      expect(test.status).toBe(200);
      expect(await test.json()).toMatchObject({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => fakeApi.close((error) => error ? reject(error) : resolve()));
      if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldOpenAiKey;
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

  it('rejects raw files through symlinks that resolve outside mindRoot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-raw-file-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-raw-file-symlink-outside-'));
    mkdirSync(join(root, 'media'), { recursive: true });
    writeFileSync(join(outside, 'secret.mp3'), Buffer.from('secret'));
    symlinkSync(outside, join(root, 'media', 'linked-outside'), 'dir');

    expect(handleRawFile(new URLSearchParams('path=media/linked-outside/secret.mp3'), { mindRoot: root })).toMatchObject({
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
});
