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
        mindRoot: '/home/tester/MindOS/mind',
        homeDir: '/home/tester',
        platform: 'linux',
        port: 3456,
        mcpPort: 8781,
        authToken: 'token',
        providerConfigs: [{ id: 'p_openai', apiKeyMask: 'sk-tes***' }],
      },
    });
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
  };
  return { services, state, createdDirs, templates };
}
