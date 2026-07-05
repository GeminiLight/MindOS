import {
  existsSync,
  lstatSync,
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
  it
} from 'vitest';
import {
  handleAgentCopySkillPost,
  handleCustomAgentDetectPost,
  handleCustomAgentsDelete,
  handleCustomAgentsPost,
  handleCustomAgentsPut,
  handleMcpAgentsGet,
  handleMcpInstallPost,
  handleMcpInstallSkillPost,
  resolveNpxInvocation,
  findMcpProcessIdsByPort,
  handleMcpRestartPost,
  handleMcpUninstallPost,
  isMindosMcpCommandLine,
  parseNetstatListeningPids,
  handleMcpDirectToolsPost,
  handleMcpToolsGet,
  handleSettingsResetTokenPost,
  handleSkillsGet,
  handleSkillsPost,
  getSkillRootsFromRuntime,
  type MindosSkillsSettings,
  type CustomAgentSettings,
  type MindosCustomMcpAgentDef,
  type MindosMcpAgentDef,
  type MindosMcpAgentRegistryDef,
  type MindosSkillAgentRegistration
} from './server.js';

describe('MindOS server contract: skills, custom agents, MCP management', () => {
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
    expect(res.headers?.['Cache-Control']).toBe('no-store');
    expect(res.body.skills).toEqual([
      expect.objectContaining({ name: 'custom-skill', description: 'User skill', source: 'user', enabled: true, editable: true }),
      expect.objectContaining({ name: 'mindos', description: 'Builtin skill', source: 'builtin', enabled: false, editable: false }),
    ]);
  });

  it('lists external skill directories when entries are symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-symlinked-external-skills-'));
    const codexSkillsRoot = join(root, 'codex-skills');
    const agentSkillsRoot = join(root, 'agent-skills');
    mkdirSync(codexSkillsRoot, { recursive: true });
    mkdirSync(join(agentSkillsRoot, 'linked-skill'), { recursive: true });
    writeFileSync(join(agentSkillsRoot, 'linked-skill', 'SKILL.md'), '---\nname: linked-skill\ndescription: Linked skill\n---\n');
    symlinkSync(join(agentSkillsRoot, 'linked-skill'), join(codexSkillsRoot, 'linked-skill'), 'dir');

    const res = handleSkillsGet({
      disabledSkills: [],
      skillRoots: [
        { path: codexSkillsRoot, source: 'user', origin: 'custom', editable: true },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.skills).toEqual([
      expect.objectContaining({
        name: 'linked-skill',
        description: 'Linked skill',
        source: 'user',
        origin: 'custom',
        editable: true,
      }),
    ]);
  });

  it('lists and reads custom skill paths when the path points directly at a skill directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-direct-custom-skill-'));
    const home = join(root, 'home');
    const directSkillRoot = join(home, 'custom-skills', 'direct-skill');
    mkdirSync(directSkillRoot, { recursive: true });
    writeFileSync(join(directSkillRoot, 'SKILL.md'), '---\nname: direct-skill\ndescription: Direct custom skill\n---\n\nDirect body');

    const skillRoots = getSkillRootsFromRuntime({
      mindRoot: join(root, 'mind'),
      runtimeRoot: join(root, 'runtime'),
      homeDir: home,
      settings: { skillPaths: { custom: ['~/custom-skills/direct-skill'] } },
    });

    expect(skillRoots.find((skillRoot) => skillRoot.origin === 'custom')?.path).toBe(directSkillRoot);

    const listed = handleSkillsGet({
      disabledSkills: [],
      skillRoots,
    });
    expect(listed.body.skills).toEqual([
      expect.objectContaining({
        name: 'direct-skill',
        description: 'Direct custom skill',
        origin: 'custom',
        path: join(directSkillRoot, 'SKILL.md'),
      }),
    ]);

    expect(handleSkillsPost({ action: 'read', name: 'direct-skill' }, {
      mindRoot: join(root, 'mind'),
      skillRoots,
      readSettings: () => ({}),
      writeSettings: () => undefined,
    })).toMatchObject({
      status: 200,
      body: { content: expect.stringContaining('Direct body') },
    });

    expect(handleSkillsPost({ action: 'read-native', name: 'direct-skill', sourcePath: directSkillRoot }, {
      mindRoot: join(root, 'mind'),
      skillRoots,
      readSettings: () => ({}),
      writeSettings: () => undefined,
    })).toMatchObject({
      status: 200,
      body: { content: expect.stringContaining('Direct body'), description: 'Direct custom skill' },
    });
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
    expect(handleSkillsPost({ action: 'read-native', name: 'builtin-skill', sourcePath: builtinRoot }, services)).toMatchObject({
      status: 200,
      body: { content: expect.stringContaining('Builtin') },
    });

    const outsideRoot = mkdtempSync(join(tmpdir(), 'mindos-skill-read-native-outside-'));
    mkdirSync(join(outsideRoot, 'secret-skill'), { recursive: true });
    writeFileSync(join(outsideRoot, 'secret-skill', 'SKILL.md'), '---\nname: secret-skill\n---\nsecret');
    expect(handleSkillsPost({ action: 'read-native', name: 'secret-skill', sourcePath: outsideRoot }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid sourcePath' },
    });
    expect(handleSkillsPost({ action: 'read-native', name: 'secret-skill', sourcePath: outsideRoot }, {
      ...services,
      trustedNativeSkillRoots: [outsideRoot],
    })).toMatchObject({
      status: 200,
      body: { content: expect.stringContaining('secret') },
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

  it('rejects product skill writes through symlinked user skill directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-skill-symlink-root-'));
    const mindRoot = join(root, 'mind');
    const builtinRoot = join(root, 'builtin-skills');
    const outside = mkdtempSync(join(tmpdir(), 'mindos-skill-symlink-outside-'));
    mkdirSync(mindRoot, { recursive: true });
    mkdirSync(join(builtinRoot, 'builtin-skill'), { recursive: true });
    writeFileSync(join(builtinRoot, 'builtin-skill', 'SKILL.md'), '---\nname: builtin-skill\n---\nBuiltin');
    symlinkSync(outside, join(mindRoot, '.skills'), 'dir');

    const services = {
      mindRoot,
      skillRoots: [
        { path: builtinRoot, source: 'builtin' as const, origin: 'project-builtin' as const, editable: false },
        { path: join(mindRoot, '.skills'), source: 'user' as const, origin: 'mindos-user' as const, editable: true },
      ],
      readSettings: () => ({}),
      writeSettings: () => {},
    };

    expect(handleSkillsGet({
      skillRoots: services.skillRoots,
    }).body.skills).toEqual([
      expect.objectContaining({ name: 'builtin-skill' }),
    ]);
    expect(handleSkillsPost({ action: 'read', name: 'builtin-skill' }, services)).toMatchObject({
      status: 200,
      body: { content: expect.stringContaining('Builtin') },
    });
    expect(handleSkillsPost({ action: 'create', name: 'external-skill' }, services)).toMatchObject({
      status: 403,
      body: { error: 'Access denied' },
    });
    expect(existsSync(join(outside, 'external-skill', 'SKILL.md'))).toBe(false);
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
    expect(handleCustomAgentsPost({ name: 'Pollute', baseDir: '~/.pollute/', key: '__proto__' }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('Agent key') },
    });
    expect(handleCustomAgentsPost({ name: 'Bad Path', baseDir: '~/../bad/' }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('parent directory') },
    });
    expect(handleCustomAgentsPost({
      name: 'Bad Config',
      baseDir: '~/.bad/',
      configKey: '__proto__.servers',
    }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('unsafe key') },
    });
    expect(handleCustomAgentsPost({
      name: 'Bad Format',
      baseDir: '~/.bad/',
      format: 'yaml' as never,
    }, services)).toMatchObject({
      status: 400,
      body: { error: 'format must be "json" or "toml"' },
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
      globalNestedKey: 'mcp.__proto__',
    }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('unsafe key') },
    });
    expect(handleCustomAgentsPut({
      key: 'qclaw-local',
      presenceDirs: ['~/../bad/'],
    }, services)).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('parent directory') },
    });

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

    const originalPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      expect(handleCustomAgentsPut({
        key: 'qclaw-local',
        baseDir: 'C:\\Users\\Ada\\.qclaw\\',
      }, services)).toMatchObject({
        status: 200,
        body: {
          agent: {
            baseDir: 'C:\\Users\\Ada\\.qclaw\\',
            presenceDirs: ['C:\\Users\\Ada\\.qclaw\\'],
            skillDir: 'C:\\Users\\Ada\\.qclaw\\skills/',
          },
        },
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }

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
    writeFileSync(join(agentRoot, 'skills', 'agent-skill', 'SKILL.md'), '# Agent Skill');
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
      status: 200,
      body: { exists: false, hasSkillsDir: false },
    });

    const skillRoot = join(home, 'mindos-skills');
    mkdirSync(join(skillRoot, 'mindos'), { recursive: true });
    writeFileSync(join(skillRoot, 'mindos', 'SKILL.md'), '# MindOS');
    const targetRoot = join(home, 'target..skills');

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
      targetPath: `${home}/parent/../target-skills`,
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid target path' },
    });

    mkdirSync(join(skillRoot, 'agent..skill'), { recursive: true });
    writeFileSync(join(skillRoot, 'agent..skill', 'SKILL.md'), '# Agent Dotted Skill');
    const dottedTargetRoot = join(home, 'target-dotted-skills');

    await expect(handleAgentCopySkillPost({
      skillName: 'agent..skill',
      targetPath: dottedTargetRoot,
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 200,
      body: { success: true, skillName: 'agent..skill', targetPath: join(dottedTargetRoot, 'agent..skill') },
    });
    expect(existsSync(join(dottedTargetRoot, 'agent..skill', 'SKILL.md'))).toBe(true);

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

    const nativeSourceRoot = join(agentRoot, 'skills');
    const linkedTargetRoot = join(home, '.claude', 'skills');

    await expect(handleAgentCopySkillPost({
      skillName: 'agent-skill',
      sourcePath: nativeSourceRoot,
      targetPath: linkedTargetRoot,
      strategy: 'symlink',
      dryRun: true,
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 200,
      body: {
        success: true,
        dryRun: true,
        skillName: 'agent-skill',
        operation: 'symlink',
        sourcePath: join(nativeSourceRoot, 'agent-skill'),
        targetPath: join(linkedTargetRoot, 'agent-skill'),
      },
    });
    expect(existsSync(join(linkedTargetRoot, 'agent-skill'))).toBe(false);

    await expect(handleAgentCopySkillPost({
      skillName: 'agent-skill',
      sourcePath: nativeSourceRoot,
      targetPath: linkedTargetRoot,
      strategy: 'symlink',
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 200,
      body: {
        success: true,
        dryRun: false,
        skillName: 'agent-skill',
        operation: 'symlink',
        sourcePath: join(nativeSourceRoot, 'agent-skill'),
        targetPath: join(linkedTargetRoot, 'agent-skill'),
      },
    });
    expect(lstatSync(join(linkedTargetRoot, 'agent-skill')).isSymbolicLink()).toBe(true);

    await expect(handleAgentCopySkillPost({
      skillName: 'agent-skill',
      sourcePath: nativeSourceRoot,
      targetPath: linkedTargetRoot,
      strategy: 'copy',
    }, {
      skillRoots: [{ path: skillRoot, source: 'builtin', origin: 'project-builtin', editable: false }],
      homeDir: home,
    })).resolves.toMatchObject({
      status: 409,
      body: { error: 'Skill "agent-skill" already exists in target directory' },
    });
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
      'kilo-code': {
        name: 'Kilo Code',
        project: '.kilo/kilo.jsonc',
        global: '~/.config/kilo/kilo.jsonc',
        projectReadAlso: ['.kilo/kilo.json', 'kilo.jsonc', 'kilo.json'],
        globalReadAlso: ['~/.config/kilo/kilo.json'],
        key: 'mcp',
        preferredTransport: 'stdio',
        entryStyle: 'kilo',
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
      agents: [{ key: 'unsafe-key', scope: 'global' }],
      transport: 'stdio',
    }, {
      agents: {
        'unsafe-key': {
          name: 'Unsafe',
          project: null,
          global: '~/.unsafe/config.json',
          key: '__proto__',
          preferredTransport: 'stdio',
        },
      },
      homeDir: home,
    })).resolves.toMatchObject({
      status: 200,
      body: { results: [{ agent: 'unsafe-key', status: 'error', message: expect.stringContaining('Invalid agent config key') }] },
    });
    await expect(handleMcpInstallPost({
      agents: [{ key: 'unsafe-nested', scope: 'global' }],
      transport: 'stdio',
    }, {
      agents: {
        'unsafe-nested': {
          name: 'Unsafe Nested',
          project: null,
          global: '~/.unsafe-nested/config.json',
          key: 'mcp',
          globalNestedKey: 'mcp.__proto__',
          preferredTransport: 'stdio',
        },
      },
      homeDir: home,
    })).resolves.toMatchObject({
      status: 200,
      body: { results: [{ agent: 'unsafe-nested', status: 'error', message: expect.stringContaining('Invalid nested config path') }] },
    });
    expect(({} as Record<string, unknown>).mindos).toBeUndefined();

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

    await expect(handleMcpInstallPost({
      agents: [{ key: 'kilo-code', scope: 'global' }],
      transport: 'stdio',
    }, { agents, homeDir: home })).resolves.toMatchObject({
      status: 200,
      body: { results: [{ agent: 'kilo-code', status: 'ok', path: '~/.config/kilo/kilo.jsonc', transport: 'stdio' }] },
    });
    const kiloConfig = JSON.parse(readFileSync(join(home, '.config', 'kilo', 'kilo.jsonc'), 'utf-8'));
    expect(kiloConfig.mcp.mindos).toEqual({
      type: 'local',
      command: ['mindos', 'mcp'],
      environment: { MCP_TRANSPORT: 'stdio' },
      enabled: true,
    });

    const specialAgents: Record<string, MindosMcpAgentDef> = {
      codex: {
        name: 'Codex',
        project: null,
        global: '~/.codex/config.toml',
        key: 'mcp_servers',
        format: 'toml',
        preferredTransport: 'http',
      },
      hermes: {
        name: 'Hermes',
        project: null,
        global: '~/.hermes/config.yaml',
        key: 'mcp_servers',
        format: 'yaml',
        preferredTransport: 'http',
      },
      'kilo-code': {
        name: 'Kilo Code',
        project: null,
        global: '~/.config/kilo/kilo.jsonc',
        key: 'mcp',
        preferredTransport: 'http',
        entryStyle: 'kilo',
      },
    };
    await expect(handleMcpInstallPost({
      agents: [
        { key: 'codex', scope: 'global' },
        { key: 'hermes', scope: 'global' },
        { key: 'kilo-code', scope: 'global' },
      ],
      transport: 'http',
      url: 'http://localhost:8781/mcp?label="main"',
      token: 'tok"line\nnext',
    }, { agents: specialAgents, homeDir: home })).resolves.toMatchObject({
      status: 200,
      body: {
        results: [
          { agent: 'codex', status: 'ok' },
          { agent: 'hermes', status: 'ok' },
          { agent: 'kilo-code', status: 'ok' },
        ],
      },
    });
    const specialToml = readFileSync(join(home, '.codex', 'config.toml'), 'utf-8');
    expect(specialToml).toContain('url = "http://localhost:8781/mcp?label=\\"main\\""');
    expect(specialToml).toContain('Authorization = "Bearer tok\\"line\\nnext"');
    const specialYaml = readFileSync(join(home, '.hermes', 'config.yaml'), 'utf-8');
    expect(specialYaml).toContain('url: "http://localhost:8781/mcp?label=\\"main\\""');
    expect(specialYaml).toContain('Authorization: "Bearer tok\\"line\\nnext"');
    const specialKilo = JSON.parse(readFileSync(join(home, '.config', 'kilo', 'kilo.jsonc'), 'utf-8'));
    expect(specialKilo.mcp.mindos).toEqual({
      type: 'remote',
      url: 'http://localhost:8781/mcp?label="main"',
      headers: { Authorization: 'Bearer tok"line\nnext' },
      enabled: true,
    });

    expect(handleMcpUninstallPost({
      agents: [{ key: 'copaw', scope: 'global' }],
    }, { agents, homeDir: home })).toMatchObject({
      status: 200,
      body: { results: [{ agent: 'copaw', status: 'ok', path: '~/.copaw/config.json' }] },
    });
    const afterUninstall = JSON.parse(readFileSync(join(home, '.copaw', 'config.json'), 'utf-8'));
    expect(afterUninstall.mcp.clients.mindos).toBeUndefined();
  });

  it('expands Windows-style home-relative MCP config paths', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-install-home-backslash-'));
    const configPath = join(home, '.copaw\\config.json');
    writeFileSync(configPath, JSON.stringify({
      mcp: {
        clients: {
          mindos: { type: 'stdio', command: 'mindos' },
          search: { type: 'stdio', command: 'search' },
        },
      },
    }), 'utf-8');

    const agents: Record<string, MindosMcpAgentDef> = {
      copaw: {
        name: 'CoPaw',
        project: null,
        global: '~\\.copaw\\config.json',
        key: 'mcp',
        globalNestedKey: 'mcp.clients',
        preferredTransport: 'stdio',
      },
    };

    expect(handleMcpUninstallPost({
      agents: [{ key: 'copaw', scope: 'global' }],
    }, { agents, homeDir: home })).toMatchObject({
      status: 200,
      body: { results: [{ agent: 'copaw', status: 'ok', path: '~\\.copaw\\config.json' }] },
    });

    const afterUninstall = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(afterUninstall.mcp.clients.mindos).toBeUndefined();
    expect(afterUninstall.mcp.clients.search).toMatchObject({ command: 'search' });
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

    expect(handleMcpDirectToolsPost({ server: '__proto__', directTools: true }, {
      updateServerDirectTools: () => {
        throw new Error('should not update unsafe server name');
      },
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid server name' },
    });
    expect(({} as Record<string, unknown>).directTools).toBeUndefined();

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
      skillCapabilities: {
        mode: 'universal',
        visibility: 'global',
        nativeSkillScope: 'global',
        canLinkMindosSkills: true,
        canReceiveLinkedSkills: true,
        canExportNativeSkills: true,
        linkStrategy: 'symlink',
      },
    });
    expect(profiles[1]).toMatchObject({
      key: 'claude-code',
      skillMode: 'additional',
      skillCapabilities: {
        mode: 'additional',
        visibility: 'agent',
        nativeSkillScope: 'none',
        canLinkMindosSkills: true,
        canReceiveLinkedSkills: true,
        canExportNativeSkills: false,
        linkStrategy: 'symlink',
      },
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
      skillCapabilities: {
        mode: 'additional',
        visibility: 'agent',
        nativeSkillScope: 'native-private',
        canLinkMindosSkills: true,
        canReceiveLinkedSkills: true,
        canExportNativeSkills: true,
        linkStrategy: 'symlink',
      },
    });
  });

  it('discovers custom MCP agents with Windows-style home-relative config paths', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-mcp-agents-home-backslash-'));
    const configPath = join(home, '.custom\\mcp.json');
    writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        mindos: {},
        search: {},
      },
    }), 'utf-8');

    const agents: Record<string, MindosMcpAgentRegistryDef> = {
      'custom-one': {
        name: 'Custom One',
        project: null,
        global: '~\\.custom\\mcp.json',
        key: 'mcpServers',
        preferredTransport: 'stdio',
        presenceDirs: ['~\\.custom\\'],
      },
    };
    const customAgents: MindosCustomMcpAgentDef[] = [{
      name: 'Custom One',
      key: 'custom-one',
      baseDir: '~\\.custom\\',
      global: '~\\.custom\\mcp.json',
      configKey: 'mcpServers',
      format: 'json',
      preferredTransport: 'stdio',
      presenceDirs: ['~\\.custom\\'],
    }];

    const response = await handleMcpAgentsGet({
      agents,
      builtInAgents: {},
      customAgents,
      homeDir: home,
      pathExists: (targetPath) => targetPath === configPath,
      readTextFile: (targetPath) => {
        expect(targetPath).toBe(configPath);
        return readFileSync(targetPath, 'utf-8');
      },
      listSkillNames: () => [],
    });

    expect(response.status).toBe(200);
    expect(response.body.agents[0]).toMatchObject({
      key: 'custom-one',
      installed: true,
      configuredMcpServers: ['mindos', 'search'],
      configuredMcpSources: [`local:${configPath}`],
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

  it('installs MindOS skills locally through the product runtime installer handler', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-install-skill-'));
    const home = join(root, 'home');
    const localSkills = join(root, 'skills');
    mkdirSync(join(localSkills, 'mindos'), { recursive: true });
    mkdirSync(join(localSkills, 'mindos-zh'), { recursive: true });
    writeFileSync(join(localSkills, 'mindos', 'SKILL.md'), '---\nname: mindos\n---\nEnglish');
    writeFileSync(join(localSkills, 'mindos-zh', 'SKILL.md'), '---\nname: mindos-zh\n---\nChinese');
    mkdirSync(join(home, '.claude', 'skills', 'mindos'), { recursive: true });
    writeFileSync(join(home, '.claude', 'skills', 'mindos', 'README.md'), 'partial');
    mkdirSync(join(home, '.agents', 'skills', 'mindos-zh'), { recursive: true });
    writeFileSync(join(home, '.agents', 'skills', 'mindos-zh', 'SKILL.md'), 'custom skill');

    const agents: Record<string, MindosMcpAgentRegistryDef> = {
      cursor: {
        name: 'Cursor',
        project: '.cursor/mcp.json',
        global: '~/.cursor/mcp.json',
        key: 'mcpServers',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.cursor/'],
      },
      'claude-code': {
        name: 'Claude Code',
        project: '.mcp.json',
        global: '~/.claude.json',
        key: 'mcpServers',
        preferredTransport: 'stdio',
        presenceDirs: ['~/.claude/'],
      },
    };
    const skillAgentRegistry: Record<string, MindosSkillAgentRegistration> = {
      cursor: { mode: 'universal' },
      'claude-code': { mode: 'additional', skillAgentName: 'claude-code' },
    };

    expect(handleMcpInstallSkillPost({ agents: [] }, {
      runCommand: () => {
        throw new Error('should not run invalid request');
      },
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid skill name' },
    });
    expect(handleMcpInstallSkillPost({ skill: 'mindos', agents: ['--help'] }, {
      runCommand: () => {
        throw new Error('should not run invalid agent request');
      },
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid agent name' },
    });
    expect(handleMcpInstallSkillPost({ skill: 'mindos', agents: ['__proto__'] }, {
      runCommand: () => {
        throw new Error('should not run invalid agent request');
      },
    })).toMatchObject({
      status: 400,
      body: { error: 'Invalid agent name' },
    });

    const mixed = handleMcpInstallSkillPost({ skill: 'mindos-zh', agents: ['cursor', 'claude-code'] }, {
      projectRoot: root,
      homeDir: home,
      agents,
      skillAgentRegistry,
      runCommand: () => {
        throw new Error('local install should not run npx when packaged skills are available');
      },
    });
    expect(mixed).toMatchObject({
      status: 200,
      body: {
        ok: true,
        method: 'local-copy',
        skill: 'mindos-zh',
        agents: ['cursor', 'claude-code'],
        results: [
          { agent: 'cursor', status: 'exists', workspacePath: join(home, '.agents', 'skills') },
          { agent: 'claude-code', status: 'copied', workspacePath: join(home, '.claude', 'skills') },
        ],
      },
    });
    expect(readFileSync(join(home, '.agents', 'skills', 'mindos-zh', 'SKILL.md'), 'utf-8')).toBe('custom skill');
    expect(readFileSync(join(home, '.claude', 'skills', 'mindos-zh', 'SKILL.md'), 'utf-8')).toContain('name: mindos-zh');

    const repaired = handleMcpInstallSkillPost({ skill: 'mindos', agents: ['claude-code'] }, {
      projectRoot: root,
      homeDir: home,
      agents,
      skillAgentRegistry,
      runCommand: () => {
        throw new Error('local repair should not run npx');
      },
    });
    expect(repaired).toMatchObject({
      status: 200,
      body: {
        ok: true,
        method: 'local-copy',
        results: [{ agent: 'claude-code', status: 'repaired' }],
      },
    });
    expect(readFileSync(join(home, '.claude', 'skills', 'mindos', 'SKILL.md'), 'utf-8')).toContain('name: mindos');
  });

  it('falls back to argv-safe npx skill installation when no local skill source exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'mindos-install-skill-fallback-'));
    const commands: Array<{ command: string; args: string[] }> = [];

    expect(handleMcpInstallSkillPost({
      skill: 'mindos-zh',
      agents: ['cursor', 'claude-code', 'unknown-agent'],
    }, {
      projectRoot: root,
      skillAgentRegistry: {
        cursor: { mode: 'universal' },
        'claude-code': { mode: 'additional', skillAgentName: 'claude-code' },
      },
      runCommand: (command, args) => {
        commands.push({ command, args });
        return 'Done!\n';
      },
    })).toMatchObject({
      status: 200,
      body: {
        ok: true,
        method: 'npx',
        skill: 'mindos-zh',
        agents: ['claude-code', 'unknown-agent'],
        stdout: 'Done!',
      },
    });

    expect(commands).toEqual([{
      command: 'npx',
      args: ['skills', 'add', 'GeminiLight/MindOS', '--skill', 'mindos-zh', '-a', 'claude-code', '-a', 'unknown-agent', '-g', '-y'],
    }]);
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
      getCommandLine: (pid) => pid === 1234
        ? 'C:\\Program Files\\MindOS\\node.exe C:\\Users\\me\\.mindos\\runtime\\dist\\protocols\\mcp-server\\index.cjs'
        : 'C:\\Windows\\System32\\svchost.exe',
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
      getCommandLine: (pid) => pid === 2468
        ? '/usr/bin/node /home/me/.mindos/runtime/dist/protocols/mcp-server/index.cjs'
        : '/usr/bin/python -m http.server 8781',
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
    expect(source).toContain("execFileSync('powershell.exe', [");
    expect(source).toContain("execFileSync('wmic', ['process', 'where', `ProcessId=${pid}`");
  });

  it('filters MCP restart port owners by MindOS MCP command line before killing', () => {
    expect(isMindosMcpCommandLine('/usr/bin/node /home/me/.mindos/runtime/dist/protocols/mcp-server/index.cjs')).toBe(true);
    expect(isMindosMcpCommandLine('C:\\MindOS\\node.exe C:\\MindOS\\dist\\protocols\\mcp-server\\index.cjs')).toBe(true);
    expect(isMindosMcpCommandLine('/usr/bin/python -m http.server 8781')).toBe(false);

    const pids = findMcpProcessIdsByPort(8781, {
      platform: 'linux',
      execFile: (command) => {
        if (command === 'lsof') return '111\n222\n';
        return '';
      },
      getCommandLine: (pid) => pid === 111
        ? '/usr/bin/node /opt/mindos/dist/protocols/mcp-server/index.cjs'
        : '/usr/bin/node /srv/other-service/server.js',
    });

    expect(pids).toEqual([111]);
  });
});
