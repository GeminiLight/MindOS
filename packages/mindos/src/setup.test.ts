import { describe, expect, it } from 'vitest';
import {
  buildMindosSetupState,
  applyMindosSetupConfig,
  patchMindosSetupGuideState,
  type MindosSetupServices,
  type MindosSetupSettings,
} from './setup/index.js';

describe('MindOS setup domain operations', () => {
  it('builds setup state with masked provider keys', () => {
    const services = makeServices({
      ai: {
        activeProvider: 'p_openai',
        providers: [
          { id: 'p_openai', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-test-123456', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
      mindRoot: '',
      port: 3456,
      mcpPort: 8781,
      authToken: 'token',
      webPassword: '',
    });

    expect(buildMindosSetupState(services)).toMatchObject({
      status: 200,
      body: {
        mindRoot: '~/MindOS/mind',
        homeDir: '/home/tester',
        platform: 'linux',
        port: 3456,
        mcpPort: 8781,
        authToken: 'token',
        providerConfigs: [{ id: 'p_openai', apiKeyMask: 'sk-tes***' }],
      },
    });
  });

  it('resolves platform-aware default Mind roots under Documents when available', () => {
    const baseSettings: MindosSetupSettings = {
      ai: { activeProvider: '', providers: [] },
      mindRoot: '',
    };

    const mac = {
      ...makeServices(baseSettings),
      homeDir: () => '/Users/tester',
      platform: () => 'darwin',
      pathSep: () => '/',
      existsSync: () => false,
    };
    expect(buildMindosSetupState(mac).body.mindRoot).toBe('~/Documents/MindOS/mind');

    const windows = {
      ...makeServices(baseSettings),
      homeDir: () => 'C:\\Users\\Tester',
      platform: () => 'win32',
      pathSep: () => '\\',
      existsSync: () => false,
    };
    expect(buildMindosSetupState(windows).body.mindRoot).toBe('~\\Documents\\MindOS\\mind');

    const linuxDesktop = {
      ...makeServices(baseSettings),
      platform: () => 'linux',
      env: () => ({ XDG_DOCUMENTS_DIR: '$HOME/Docs' }),
      existsSync: (target: string) => target === '/home/tester/Docs',
    };
    expect(buildMindosSetupState(linuxDesktop).body.mindRoot).toBe('~/Docs/MindOS/mind');

    const linuxHeadless = {
      ...makeServices(baseSettings),
      platform: () => 'linux',
      existsSync: () => false,
    };
    expect(buildMindosSetupState(linuxHeadless).body.mindRoot).toBe('~/MindOS/mind');
  });

  it('applies setup config with validation, template handling, provider merge, and restart detection', () => {
    const { services, state, createdDirs, templates } = makeMutableServices({
      ai: {
        activeProvider: 'p_openai',
        providers: [
          { id: 'p_openai', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-existing', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
      mindRoot: '',
      port: 3456,
      mcpPort: 8781,
      authToken: 'token-old',
      webPassword: '',
      setupPending: true,
      startMode: 'daemon',
    });

    expect(applyMindosSetupConfig({ template: 'en' }, services)).toMatchObject({
      status: 400,
      body: { error: 'mindRoot is required' },
    });
    expect(applyMindosSetupConfig({ mindRoot: '/System/MindOS' }, services)).toMatchObject({
      status: 400,
      body: { unsafePath: true },
    });
    expect(applyMindosSetupConfig({ mindRoot: '~/mind', port: 80 }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid web port: 80' },
    });

    expect(applyMindosSetupConfig({
      mindRoot: '~/mind',
      template: 'zh',
      port: 3457,
      mcpPort: 8782,
      ai: {
        providers: [
          { id: 'p_openai', name: 'OpenAI', protocol: 'openai', apiKey: '', model: 'gpt-5.5', baseUrl: '' },
          { id: 'bad', name: 'Bad', protocol: 'bad', apiKey: 'no', model: 'no', baseUrl: '' },
        ],
        activeProvider: 'p_openai',
      },
      connectionMode: { cli: true, mcp: true },
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, portChanged: true, needsRestart: true, newPort: 3457 },
    });

    expect(createdDirs).toContain('/home/tester/mind');
    expect(templates).toEqual([{ template: 'zh', root: '/home/tester/mind' }]);
    expect(state.settings).toMatchObject({
      mindRoot: '/home/tester/mind',
      port: 3457,
      mcpPort: 8782,
      authToken: 'token-old',
      startMode: 'daemon',
      setupPending: false,
      setupPort: undefined,
      disabledSkills: ['mindos'],
      connectionMode: { cli: true, mcp: true },
      guideState: { active: true, dismissed: false, template: 'zh', nextStepIndex: 0 },
      ai: {
        activeProvider: 'p_openai',
        providers: [{ id: 'p_openai', apiKey: 'sk-existing', model: 'gpt-5.5' }],
      },
    });
  });

  it('arms the walkthrough in guide state during first-time setup without requiring a welcome URL', () => {
    const { services, state } = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '',
      setupPending: true,
    });

    expect(applyMindosSetupConfig({
      mindRoot: '~/mind',
      template: 'en',
    }, services)).toMatchObject({
      status: 200,
      body: { ok: true, needsRestart: true },
    });

    expect(state.settings.guideState).toMatchObject({
      active: true,
      dismissed: false,
      template: 'en',
      walkthroughStep: 0,
      walkthroughDismissed: false,
    });
  });

  it('validates and applies selected initial Mind Spaces after the base template', () => {
    const { services, templates, initialSpaces } = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '',
      setupPending: true,
    });

    const response = applyMindosSetupConfig({
      mindRoot: '~/mind',
      template: 'zh',
      initialSpaces: ['product', 'social', 'product'],
      initialSpaceLocale: 'zh',
    }, services);

    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        installedInitialSpaces: [
          { id: 'product', locale: 'zh', copied: ['产品/README.md'], skipped: [] },
          { id: 'social', locale: 'zh', copied: ['社交/README.md'], skipped: [] },
        ],
      },
    });
    expect(templates).toEqual([{ template: 'zh', root: '/home/tester/mind' }]);
    expect(initialSpaces).toEqual([{ ids: ['product', 'social'], root: '/home/tester/mind', locale: 'zh' }]);
  });

  it('accepts legacy Space Kit fields during transition', () => {
    const { services, templates, initialSpaces } = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '',
      setupPending: true,
    });

    const response = applyMindosSetupConfig({
      mindRoot: '~/mind',
      template: 'en',
      spaceKits: ['life', 'learning', 'life'],
      spaceKitLocale: 'zh',
    }, services);

    expect(response).toMatchObject({
      status: 200,
      body: {
        ok: true,
        installedInitialSpaces: [
          { id: 'life', locale: 'zh', copied: ['life/README.md'], skipped: [] },
          { id: 'learning', locale: 'zh', copied: ['learning/README.md'], skipped: [] },
        ],
      },
    });
    expect(templates).toEqual([{ template: 'en', root: '/home/tester/mind' }]);
    expect(initialSpaces).toEqual([{ ids: ['life', 'learning'], root: '/home/tester/mind', locale: 'zh' }]);
  });

  it('rejects invalid initial Mind Spaces before copying templates or spaces', () => {
    const { services, templates, initialSpaces } = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '',
      setupPending: true,
    });

    expect(applyMindosSetupConfig({
      mindRoot: '~/mind',
      template: 'en',
      initialSpaces: ['product', '../bad'],
    }, services)).toMatchObject({
      status: 400,
      body: { error: 'Invalid initial space: ../bad' },
    });
    expect(templates).toEqual([]);
    expect(initialSpaces).toEqual([]);
  });

  it('keeps Web sessions stable when setup writes the Web UI password', () => {
    const withExisting = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '/home/tester/mind',
      authToken: 'token',
      webPassword: 'old-password',
      webSessionSecret: 'stable-session-secret',
    });

    expect(applyMindosSetupConfig({
      mindRoot: '~/mind',
      webPassword: 'new-password',
    }, withExisting.services)).toMatchObject({ status: 200 });
    expect(withExisting.state.settings.webPassword).toBe('new-password');
    expect(withExisting.state.settings.webSessionSecret).toBe('stable-session-secret');

    const legacyWithoutSecret = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '/home/tester/mind',
      authToken: 'token',
      webPassword: 'old-password',
    });

    expect(applyMindosSetupConfig({
      mindRoot: '~/mind',
      webPassword: 'new-password',
    }, legacyWithoutSecret.services)).toMatchObject({ status: 200 });
    expect(legacyWithoutSecret.state.settings.webSessionSecret).toBe('old-password');

    const withoutExisting = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '/home/tester/mind',
      authToken: 'token',
      webPassword: '',
    });

    expect(applyMindosSetupConfig({
      mindRoot: '~/mind',
      webPassword: 'new-password',
    }, withoutExisting.services)).toMatchObject({ status: 200 });
    expect(withoutExisting.state.settings.webSessionSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('patches guide state through a known-field whitelist', () => {
    const { services, state } = makeMutableServices({
      ai: { activeProvider: '', providers: [] },
      mindRoot: '/home/tester/mind',
      guideState: {
        active: false,
        dismissed: false,
        template: 'en',
        step1Done: false,
        askedAI: false,
        nextStepIndex: 0,
      },
    });

    expect(patchMindosSetupGuideState({ guideState: 'invalid' }, services)).toMatchObject({
      status: 400,
      body: { error: 'guideState object required' },
    });
    expect(patchMindosSetupGuideState({
      guideState: {
        dismissed: true,
        step1Done: true,
        askedAI: true,
        active: true,
        nextStepIndex: 2,
        walkthroughStep: 1,
        walkthroughDismissed: true,
        unknown: 'ignored',
      },
    }, services)).toMatchObject({
      status: 200,
      body: {
        ok: true,
        guideState: {
          dismissed: true,
          step1Done: true,
          askedAI: true,
          active: true,
          nextStepIndex: 2,
          walkthroughStep: 1,
          walkthroughDismissed: true,
        },
      },
    });
    expect(state.settings.guideState).not.toHaveProperty('unknown');
  });
});

function makeServices(settings: MindosSetupSettings): MindosSetupServices {
  return {
    readSettings: () => settings,
    writeSettings: () => {},
    homeDir: () => '/home/tester',
    platform: () => 'linux',
    pathSep: () => '/',
    existsSync: () => false,
    mkdirSync: () => {},
    applyTemplate: () => ({ ok: true }),
    expandPathHome: (value) => value === '~' ? '/home/tester' : value.replace(/^~\//, '/home/tester/'),
    validateMindRootPath: (value) => value.includes('/System')
      ? { safe: false, reason: 'unsafe path', reasonZh: '不安全路径' }
      : { safe: true },
    isProviderId: (value) => ['openai', 'anthropic'].includes(value),
    generateProviderId: () => 'p_generated',
    providerPresets: {
      openai: { name: 'OpenAI', defaultModel: 'gpt-5.4' },
      anthropic: { name: 'Anthropic', defaultModel: 'claude-sonnet-4-6' },
    },
  };
}

function makeMutableServices(initial: MindosSetupSettings) {
  const state = { settings: initial };
  const createdDirs: string[] = [];
  const templates: Array<{ template: string; root: string }> = [];
  const initialSpaces: Array<{ ids: string[]; root: string; locale: string }> = [];
  const services: MindosSetupServices = {
    ...makeServices(state.settings),
    readSettings: () => state.settings,
    writeSettings: (settings) => { state.settings = settings; },
    existsSync: (value) => createdDirs.includes(value),
    mkdirSync: (value) => { createdDirs.push(value); },
    applyTemplate: (template, root) => {
      templates.push({ template, root });
      createdDirs.push(root);
      return { ok: true };
    },
    applyInitialSpaces: (ids, root, locale) => {
      initialSpaces.push({ ids, root, locale });
      return {
        ok: true,
        installed: ids.map(id => ({
          id,
          locale,
          copied: [`${id === 'product' ? '产品' : id === 'social' ? '社交' : id}/README.md`],
          skipped: [],
        })),
      };
    },
  };
  return { services, state, createdDirs, templates, initialSpaces };
}
