import {
  describe,
  expect,
  it
} from 'vitest';
import {
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
  handleEmbeddingGet,
  handleEmbeddingPost,
  handleMcpStatus,
  handleMcpTokenReveal,
  handleSettingsGet,
  handleSettingsListModelsPost,
  handleSettingsPost,
  handleSettingsTestKeyPost,
  getSkillRootsFromRuntime
} from './server.js';

describe('MindOS server contract: settings, embedding, protocols', () => {
  it('handles settings read with masked secrets and provider env overrides', () => {
    const res = handleSettingsGet({
      env: { AI_PROVIDER: 'openai', MIND_ROOT: '/mind', MINDOS_WEB_PORT: '4567' },
      readSettings: () => ({
        ai: { activeProvider: 'openai', providers: { openai: { apiKey: 'secret' } } },
        authToken: 'mindos-secret-token',
        webPassword: 'web-secret',
        mcpPort: 8567,
        agentRuntimeEnv: { keys: ['CLAUDE_CODE_OAUTH_TOKEN'] },
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
      webPassword: '••••••',
      allowNetworkAccess: false,
      port: 4567,
      mcpPort: 8567,
      webSearch: { provider: 'exa', exaApiKey: '••••••' },
      agentRuntimeEnv: { keys: ['CLAUDE_CODE_OAUTH_TOKEN'] },
      envOverrides: { AI_PROVIDER: true, MIND_ROOT: true, OPENAI_API_KEY: true },
      envValues: { AI_PROVIDER: 'openai', MIND_ROOT: '/mind', OPENAI_API_KEY: '***set***' },
    });
  });

  it('normalizes legacy settings reads so the active provider remains editable', () => {
    const parseLegacyProviders = (providers: unknown, activeProvider?: unknown) => {
      if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return [];
      const active = typeof activeProvider === 'string' ? activeProvider : '';
      return Object.entries(providers as Record<string, Record<string, string>>)
        .filter(([protocol, value]) => protocol === active || !!value.apiKey || !!value.model || !!value.baseUrl)
        .map(([protocol, value]) => ({
          id: `p_${protocol}`,
          name: protocol === 'anthropic' ? 'Anthropic' : protocol,
          protocol,
          apiKey: value.apiKey ?? '',
          model: value.model ?? (protocol === 'anthropic' ? 'claude-sonnet-4-6' : ''),
          baseUrl: value.baseUrl ?? '',
        }));
    };

    const res = handleSettingsGet({
      readSettings: () => ({
        ai: {
          activeProvider: 'anthropic',
          providers: { openai: {}, anthropic: {} },
        },
      }),
      writeSettings: () => undefined,
      readWebSearchConfig: () => ({}),
      writeWebSearchConfig: () => undefined,
      parseProviders: parseLegacyProviders,
      getEmbeddingStatus: () => ({}),
      invalidateCache: () => undefined,
      providerEnv: {
        ids: [],
        getApiKeyEnvVar: () => undefined,
        getApiKeyFromEnv: () => undefined,
      },
    });

    expect(res).toMatchObject({
      status: 200,
      body: {
        ai: {
          activeProvider: 'p_anthropic',
          providers: [
            {
              id: 'p_anthropic',
              name: 'Anthropic',
              protocol: 'anthropic',
              apiKey: '',
              model: 'claude-sonnet-4-6',
              baseUrl: '',
            },
          ],
        },
      },
    });
  });

  it('handles settings write without accepting incoming auth token replacement', () => {
    let settings: any = {
      ai: { activeProvider: 'openai', providers: { openai: {} } },
      authToken: 'keep-me',
      webPassword: 'keep-password',
      allowNetworkAccess: false,
      mindRoot: '/old',
      skillPaths: { enableAgentsDir: true, custom: ['/old-skills'] },
      agentRuntimeEnv: { keys: ['OLD_RUNTIME_KEY'] },
      baseUrlCompat: { openai: { streaming: false } },
    };
    let webSearch = { provider: 'exa', exaApiKey: 'old-key' };
    let invalidated = false;

    const res = handleSettingsPost({
      ai: { activeProvider: 'anthropic', providers: { anthropic: {} } },
      authToken: 'replace-me',
      webPassword: '••••••',
      allowNetworkAccess: true,
      mindRoot: '/new',
      webSearch: { provider: 'perplexity', exaApiKey: '••••••' },
      connectionMode: { cli: false, mcp: true },
      skillPaths: { enableAgentsDir: false, custom: ['/custom-skills', 42, '  '] } as never,
      agentRuntimeEnv: { keys: ['CLAUDE_CODE_OAUTH_TOKEN', 'bad key', '__proto__', 'CLAUDE_CODE_OAUTH_TOKEN'] },
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
    expect(settings.webPassword).toBe('keep-password');
    expect(settings.allowNetworkAccess).toBe(true);
    expect(settings.mindRoot).toBe('/new');
    expect(settings.connectionMode).toEqual({ cli: false, mcp: true });
    expect(settings.skillPaths).toEqual({ enableAgentsDir: false, custom: ['/custom-skills'] });
    expect(settings.agentRuntimeEnv).toEqual({ keys: ['CLAUDE_CODE_OAUTH_TOKEN'] });
    expect(settings.baseUrlCompat).toEqual({});
    expect(webSearch).toEqual({ provider: 'perplexity', exaApiKey: 'old-key' });
    expect(invalidated).toBe(true);
  });

  it('normalizes settings writes so activeProvider points to a provider entry id', () => {
    let settings: any = {
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
      mindRoot: '/mind',
    };

    const providers = [
      { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
      { id: 'p_anthropic01', name: 'Anthropic', protocol: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', baseUrl: '' },
    ];

    const res = handleSettingsPost({
      ai: { activeProvider: 'anthropic', providers },
    }, {
      readSettings: () => settings,
      writeSettings: (next) => {
        settings = next as typeof settings;
      },
      readWebSearchConfig: () => ({}),
      writeWebSearchConfig: () => undefined,
      parseProviders: (incoming) => incoming,
      getEmbeddingStatus: () => ({}),
      invalidateCache: () => undefined,
      providerEnv: {
        ids: [],
        getApiKeyEnvVar: () => undefined,
        getApiKeyFromEnv: () => undefined,
      },
    });

    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(settings.ai.activeProvider).toBe('p_anthropic01');
    expect(settings.ai.providers).toEqual(providers);
  });

  it('falls back to the first provider entry when settings write references a missing activeProvider', () => {
    let settings: any = {
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
      mindRoot: '/mind',
    };

    const res = handleSettingsPost({
      ai: {
        activeProvider: 'p_missing',
        providers: [
          { id: 'p_google01', name: 'Google Gemini', protocol: 'google', apiKey: '', model: 'gemini-2.5-flash', baseUrl: '' },
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
    }, {
      readSettings: () => settings,
      writeSettings: (next) => {
        settings = next as typeof settings;
      },
      readWebSearchConfig: () => ({}),
      writeWebSearchConfig: () => undefined,
      parseProviders: (incoming) => incoming,
      getEmbeddingStatus: () => ({}),
      invalidateCache: () => undefined,
      providerEnv: {
        ids: [],
        getApiKeyEnvVar: () => undefined,
        getApiKeyFromEnv: () => undefined,
      },
    });

    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(settings.ai.activeProvider).toBe('p_google01');
  });

  it('ignores malformed runtime custom skill paths', () => {
    const roots = getSkillRootsFromRuntime({
      mindRoot: '/mind',
      runtimeRoot: '/runtime',
      homeDir: '/home/ada',
      settings: {
        skillPaths: {
          custom: ['/extra-skills', 42 as never, '  '],
        },
      },
    });

    expect(roots.filter((root) => root.origin === 'custom').map((root) => root.path)).toEqual(['/extra-skills']);
  });

  it('expands home-relative runtime custom skill paths', () => {
    const roots = getSkillRootsFromRuntime({
      mindRoot: '/mind',
      runtimeRoot: '/runtime',
      homeDir: '/home/ada',
      settings: {
        skillPaths: {
          custom: ['~/direct-skill'],
        },
      },
    });

    expect(roots.filter((root) => root.origin === 'custom').map((root) => root.path)).toEqual(['/home/ada/direct-skill']);
  });

  it('lists agent-owned skill roots (agents-global and custom paths) as read-only builtins managed by their own agent', () => {
    const roots = getSkillRootsFromRuntime({
      mindRoot: '/mind',
      runtimeRoot: '/runtime',
      homeDir: '/home/ada',
      settings: {
        skillPaths: {
          custom: ['~/.codex/skills'],
        },
      },
    });

    const agentOwned = roots.filter((root) => root.origin === 'agents-global' || root.origin === 'custom');
    expect(agentOwned.length).toBe(2);
    for (const root of agentOwned) {
      expect(root.source).toBe('builtin');
      expect(root.editable).toBe(false);
    }

    // MindOS-managed roots stay editable — new skills are created and edited there.
    const managed = roots.filter((root) => root.origin === 'mindos-user' || root.origin === 'mindos-global');
    expect(managed.length).toBe(2);
    for (const root of managed) {
      expect(root.source).toBe('user');
      expect(root.editable).toBe(true);
    }
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

  it('surfaces optional local embedding runtime install errors clearly', async () => {
    const services = {
      isLocalModelDownloaded: async () => false,
      downloadLocalModel: async () => {
        throw new Error('npm is required to install the optional local embedding runtime.');
      },
    };

    await expect(handleEmbeddingPost({ action: 'download', model: 'custom-model' }, services)).resolves.toMatchObject({
      status: 200,
      body: { ok: true, message: 'Downloading custom-model...' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(handleEmbeddingPost({ action: 'status', model: 'custom-model' }, services)).resolves.toMatchObject({
      status: 200,
      body: {
        downloading: false,
        downloaded: false,
        error: 'npm is required to install the optional local embedding runtime. Install Node.js/npm, or use API mode.',
      },
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
    await expect(handleA2aDiscoverPost({ url: 'file:///etc/passwd' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid URL', agent: null },
    });
    await expect(handleA2aDiscoverPost({ url: 'https://user:pass@example.com' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid URL', agent: null },
    });
    await expect(handleA2aDiscoverPost({ url: 'http://127.0.0.1:3456' }, {
      ...services,
      validateDiscoveryUrl: () => ({ ok: false as const, message: 'Private-network A2A discovery is not allowed' }),
    })).resolves.toMatchObject({
      status: 400,
      body: { error: 'Private-network A2A discovery is not allowed', agent: null },
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
      config: { command: ' claude ', args: ['--acp', 1], env: { GOOD: 'yes', BAD: 1, ['__proto__']: 'polluted' }, enabled: false },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, agents: { claude: { command: 'claude', args: ['--acp'], env: { GOOD: 'yes' }, enabled: false } } },
    });
    expect(handleAcpConfigPost({
      agentId: '__proto__',
      config: { command: 'bad' },
    }, services)).toMatchObject({
      status: 400,
      body: { error: 'agentId is required' },
    });
    expect(({} as Record<string, unknown>).command).toBeUndefined();
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
    await expect(handleAcpInstallPost({ agentId: '--help', packageName: 'agent-plugin' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'agentId and packageName are required' },
    });
    await expect(handleAcpInstallPost({ agentId: 'claude', packageName: 'agent..plugin' }, services)).resolves.toMatchObject({
      status: 200,
      body: { status: 'installing', agentId: 'claude', packageName: 'agent..plugin' },
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
    await expect(handleAcpRegistryGet(new URLSearchParams('agent=__proto__'), services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'Invalid agent id', agent: null },
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
    await expect(handleAcpSessionPost({ agentId: '__proto__' }, services)).resolves.toMatchObject({
      status: 400,
      body: { error: 'agentId is required' },
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
      localIP: '192.168.1.2',
      connectionMode: { cli: false, mcp: true },
    });
  });

  it('reveals MCP auth token only through the explicit token endpoint', async () => {
    const res = await handleMcpTokenReveal({
      readSettings: () => ({ authToken: 'token-secret' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(res.body).toEqual({
      authConfigured: true,
      authToken: 'token-secret',
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
