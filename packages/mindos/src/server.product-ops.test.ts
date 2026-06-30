import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import {
  tmpdir
} from 'node:os';
import {
  join
} from 'node:path';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';
import {
  handleAgentCapabilitiesGet,
  handleAgentSessionsDelete,
  handleAgentSessionsGet,
  handleAgentSessionsPost,
  handleBacklinks,
  handleBootstrapGet,
  handleConnectGet,
  handleGit,
  handleGraph,
  handleAgentActivity,
  handleInboxDelete,
  handleInboxGet,
  handleInboxPost,
  handleInitPost,
  handleChangesGet,
  handleChangesPost,
  handleSpaceOverviewGet,
  handleSetupCheckPath,
  handleSetupListDirectories,
  handleRestartPost,
  handleUninstallPost,
  handleUpdateCheckGet,
  handleUpdatePost,
  handleUpdateStatusGet
} from './server.js';

describe('MindOS server contract: product operations', () => {
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
      expect.objectContaining({ id: 'source.md', label: 'source', folder: '.' }),
      expect.objectContaining({ id: 'Space/target.md', label: 'Target', folder: 'Space' }),
    ]));
    expect(graph.body.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'source.md', target: 'Space/target.md', count: 2 }),
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
        expect.objectContaining({ id: '1', ts: '2026-01-01T00:00:00.000Z', tool: 'write_file', params: {}, result: 'ok' }),
      ],
    });
  });

  it('aggregates agent capabilities with source isolation and safe metadata', async () => {
    const response = await handleAgentCapabilitiesGet(new URLSearchParams(), {
      kb: () => [
        {
          id: 'kb:read',
          kind: 'kb-tool',
          name: 'Read File',
          description: 'Read notes',
          source: 'mindos',
          status: 'available',
          permissionRequired: 'read',
          metadata: {
            toolName: 'read_file',
            execute: () => 'must not leak',
            apiKey: 'sk-capability-secret-abcdefghijkl',
          },
        },
        {
          id: 'kb:delete',
          kind: 'kb-tool',
          name: 'Delete File',
          description: 'Delete notes',
          source: 'mindos',
          status: 'available',
          permissionRequired: 'ask',
        },
      ],
      subagents: () => {
        throw new Error('Authorization: Bearer sk-capability-secret-1234567890');
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.capabilities).toHaveLength(2);
    expect(response.body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'kb:read',
        kind: 'kb-tool',
        source: 'mindos',
        permissionRequired: 'read',
        metadata: {
          toolName: 'read_file',
          apiKey: '[redacted]',
        },
      }),
      expect.objectContaining({
        id: 'kb:delete',
        kind: 'kb-tool',
        source: 'mindos',
        permissionRequired: 'ask',
      }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain('must not leak');
    expect(JSON.stringify(response.body)).not.toContain('sk-capability-secret');
    expect(response.body.sources).toContainEqual({
      id: 'subagents',
      status: 'error',
      count: 0,
      error: 'Authorization: Bearer [redacted]',
    });

    const removedMode = await handleAgentCapabilitiesGet(new URLSearchParams('mode=agent'), {});
    expect(removedMode.status).toBe(400);
    expect(removedMode.body).toEqual({ error: 'Unknown field: mode' });

    const agent = await handleAgentCapabilitiesGet(new URLSearchParams('include=kb,mcp,a2a'), {
      kb: () => [{
        kind: 'kb-tool',
        name: 'Delete File',
        description: 'Delete notes',
        source: 'mindos',
        permissionRequired: 'ask',
      }],
      mcp: () => [{
        kind: 'mcp-tool',
        name: 'search_code',
        description: 'Search code',
        source: 'mcp',
        status: 'cached',
        permissionRequired: 'ask',
        metadata: { serverName: 'github', authToken: 'token-secret' },
      }],
      a2a: () => [{
        kind: 'a2a-agent',
        name: 'Remote Reviewer',
        description: 'Remote agent',
        source: 'a2a',
        permissionRequired: 'ask',
      }],
    });

    expect(agent.status).toBe(200);
    expect(agent.body.include).toEqual(['kb', 'mcp', 'a2a']);
    expect(agent.body.capabilities.map((capability) => capability.kind)).toEqual([
      'kb-tool',
      'mcp-tool',
      'a2a-agent',
    ]);
    expect(JSON.stringify(agent.body)).not.toContain('token-secret');
  });

  it('persists agent sessions in the product runtime store', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-agent-sessions-'));
    const storePath = join(root, 'sessions.json');
    const session = {
      id: 's1',
      title: 'Session 1',
      updatedAt: 1,
      messages: [{ role: 'user', content: 'hello' }],
    };

    expect(handleAgentSessionsGet({ storePath }).body).toEqual([]);
    expect(handleAgentSessionsPost({ session }, { storePath })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    // Per-session storage: each session lives in its own file under sessions/.
    expect(JSON.parse(readFileSync(join(root, 'sessions', `${Buffer.from('s1').toString('base64url')}.json`), 'utf-8'))).toEqual(session);
    expect(handleAgentSessionsGet({ storePath }).body).toEqual([session]);
    expect(handleAgentSessionsDelete({ id: 's1' }, { storePath })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
    expect(handleAgentSessionsGet({ storePath }).body).toEqual([]);
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

  it('rejects Product Server space overview through symlinked spaces outside mindRoot', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-space-overview-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-space-overview-symlink-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'outside');
    symlinkSync(outside, join(root, 'Linked'), 'dir');

    expect(handleSpaceOverviewGet(new URLSearchParams('space=Linked'), { mindRoot: root })).toMatchObject({
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

    const invalidBase64 = handleInboxPost({
      files: [{ name: 'broken.txt', content: 'not base64!!!', encoding: 'base64' }],
    }, { mindRoot: root });
    expect(invalidBase64.status).toBe(200);
    expect(invalidBase64.body).toMatchObject({
      saved: [],
      skipped: [{ name: 'broken.txt', reason: expect.stringContaining('Invalid base64 content') }],
    });
    expect(existsSync(join(root, 'Inbox', 'broken.md'))).toBe(false);

    const pdfBytes = Buffer.from('%PDF original bytes');
    const savedBinary = handleInboxPost({
      files: [{ name: 'source.pdf', content: pdfBytes.toString('base64'), encoding: 'base64' }],
    }, { mindRoot: root });
    expect(savedBinary.status).toBe(200);
    expect(savedBinary.body).toMatchObject({
      saved: [{ original: 'source.pdf', path: 'Inbox/source.pdf' }],
      skipped: [],
    });
    expect(readFileSync(join(root, 'Inbox', 'source.pdf'))).toEqual(pdfBytes);

    const savedWebClip = handleInboxPost({
      files: [{
        name: 'video.md',
        content: [
          '---',
          'title: Video Notes',
          'type: material',
          'source_type: web',
          'source_url: "https://www.youtube.com/watch?v=abc"',
          'source_platform: youtube',
          'captured_at: 2026-06-16T10:30:00.000Z',
          '---',
          '',
          '# Video Notes',
        ].join('\n'),
      }],
    }, { mindRoot: root });
    expect(savedWebClip.status).toBe(200);

    const listed = handleInboxGet({ mindRoot: root });
    expect(listed.body.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'todo.md', path: 'Inbox/todo.md' }),
      expect.objectContaining({ name: 'source.pdf', path: 'Inbox/source.pdf' }),
      expect.objectContaining({
        name: 'video.md',
        source: expect.objectContaining({
          kind: 'web',
          url: 'https://www.youtube.com/watch?v=abc',
          domain: 'youtube.com',
          platform: 'youtube',
          platformLabel: 'YouTube',
          title: 'Video Notes',
        }),
      }),
    ]));

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

  it('rejects inbox operations when Inbox is a symlink outside mindRoot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-inbox-symlink-outside-'));
    symlinkSync(outside, join(root, 'Inbox'), 'dir');

    expect(handleInboxGet({ mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(handleInboxPost({
      files: [{ name: 'todo.txt', content: 'Buy milk' }],
    }, { mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(existsSync(join(outside, 'todo.md'))).toBe(false);

    expect(handleInboxDelete({ names: ['todo.md'] }, { mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
  });

  it('rejects inbox archive when .processed is a symlink outside mindRoot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-processed-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'mindos-inbox-processed-symlink-outside-'));
    mkdirSync(join(root, 'Inbox'), { recursive: true });
    writeFileSync(join(root, 'Inbox', 'todo.md'), '# Todo', 'utf-8');
    symlinkSync(outside, join(root, 'Inbox', '.processed'), 'dir');

    expect(handleInboxDelete({ names: ['todo.md'] }, { mindRoot: root })).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(existsSync(join(root, 'Inbox', 'todo.md'))).toBe(true);
    expect(existsSync(join(outside, 'todo.md'))).toBe(false);
  });

  it('keeps both archived Inbox copies when the same name is archived in the same second', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-inbox-archive-collision-'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T10:20:30.000Z'));
    try {
      mkdirSync(join(root, 'Inbox'), { recursive: true });
      writeFileSync(join(root, 'Inbox', 'todo.md'), 'first', 'utf-8');
      const first = handleInboxDelete({ names: ['todo.md'] }, { mindRoot: root });

      writeFileSync(join(root, 'Inbox', 'todo.md'), 'second', 'utf-8');
      const second = handleInboxDelete({ names: ['todo.md'] }, { mindRoot: root });

      expect(first.body.archived[0].archivedPath).toBe('Inbox/.processed/20260621-102030_todo.md');
      expect(second.body.archived[0].archivedPath).toBe('Inbox/.processed/20260621-102030_todo-1.md');
      expect(readFileSync(join(root, first.body.archived[0].archivedPath), 'utf-8')).toBe('first');
      expect(readFileSync(join(root, second.body.archived[0].archivedPath), 'utf-8')).toBe('second');
    } finally {
      vi.useRealTimers();
    }
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
    expect(handleSetupCheckPath({ path: 'relative-notes' })).toMatchObject({
      status: 200,
      body: {
        exists: false,
        empty: true,
        count: 0,
        unsafe: true,
        reason: expect.stringContaining('absolute path'),
      },
    });
    expect(handleSetupListDirectories({ path: '.' })).toMatchObject({
      status: 200,
      body: { dirs: [] },
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
      ['..Notes/README.md', '# Dotted Notes'],
      ['..Notes/INSTRUCTION.md', '# Dotted Notes Instructions'],
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
    expect(handleBootstrapGet(new URLSearchParams('target_dir=..Notes'), services)).toMatchObject({
      status: 200,
      body: {
        target_readme: '# Dotted Notes',
        target_instruction: '# Dotted Notes Instructions',
      },
    });
    expect(handleBootstrapGet(new URLSearchParams('target_dir=../secret'), services)).toMatchObject({
      status: 400,
      body: { error: 'invalid target_dir' },
    });
    expect(handleBootstrapGet(new URLSearchParams('target_dir=C:/Users/Ada'), services)).toMatchObject({
      status: 400,
      body: { error: 'invalid target_dir' },
    });
    expect(handleBootstrapGet(new URLSearchParams('target_dir=C:\\Users\\Ada'), services)).toMatchObject({
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

    const projectRoot = mkdtempSync(join(tmpdir(), 'mindos-update-version-'));
    mkdirSync(join(projectRoot, 'packages', 'mindos'), { recursive: true });
    writeFileSync(join(projectRoot, 'packages', 'mindos', 'package.json'), JSON.stringify({
      name: '@geminilight/mindos',
      version: '1.1.53',
    }));

    await expect(handleUpdateCheckGet({
      projectRoot,
      env: {},
      registries: [],
    })).resolves.toMatchObject({
      status: 200,
      body: { current: '1.1.53', latest: '1.1.53', hasUpdate: false },
    });

    await expect(handleUpdateCheckGet({
      currentVersion: '1.1.53',
      registries: [
        'https://registry.npmmirror.example/@geminilight/mindos/latest',
        'https://registry.npmjs.example/@geminilight/mindos/latest',
      ],
      fetcher: async (url) => ({
        ok: true,
        json: async () => ({
          version: url.includes('npmmirror') ? '0.6.33' : '1.1.55',
        }),
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: { current: '1.1.53', latest: '1.1.55', hasUpdate: true },
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
      WEB_SESSION_SECRET: 'secret-session',
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
    expect((spawned[0].options.env as Record<string, string | undefined>).WEB_SESSION_SECRET).toBeUndefined();
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
    expect((spawned[1].options.env as Record<string, string | undefined>).WEB_SESSION_SECRET).toBeUndefined();
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
      env: { PATH: '/usr/bin', MIND_ROOT: '/private/mind', AUTH_TOKEN: 'secret', WEB_SESSION_SECRET: 'secret-session' },
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
    expect(childEnv.WEB_SESSION_SECRET).toBeUndefined();
  });

  it('defaults uninstall to preserving local configuration when removeConfig is omitted', () => {
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

    const response = handleUninstallPost({}, {
      cliPath: '/opt/mindos/bin/cli.js',
      nodeBin: '/usr/local/bin/node',
      env: { PATH: '/usr/bin' },
      spawn,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(writes).toEqual(['Y\nN\nN\n']);
  });

  it('removes local configuration only when removeConfig is explicitly true', () => {
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

    const response = handleUninstallPost({ removeConfig: true }, {
      cliPath: '/opt/mindos/bin/cli.js',
      nodeBin: '/usr/local/bin/node',
      env: { PATH: '/usr/bin' },
      spawn,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(writes).toEqual(['Y\nY\nN\n']);
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
});
