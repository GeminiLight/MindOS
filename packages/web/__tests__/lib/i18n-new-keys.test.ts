import { describe, it, expect } from 'vitest';
import { en } from '@/lib/i18n';
import { zh } from '@/lib/i18n';

describe('i18n explore keys', () => {
  const e = en.explore;

  it('has title and subtitle', () => {
    expect(e.title).toBeTruthy();
    expect(e.subtitle).toBeTruthy();
  });

  it('has tryIt button text', () => {
    expect(e.tryIt).toBeTruthy();
  });

  it('has all 6 category labels', () => {
    expect(e.categories['knowledge-management']).toBeTruthy();
    expect(e.categories['memory-sync']).toBeTruthy();
    expect(e.categories['auto-execute']).toBeTruthy();
    expect(e.categories['experience-evolution']).toBeTruthy();
    expect(e.categories['human-insights']).toBeTruthy();
    expect(e.categories['audit-control']).toBeTruthy();
  });

  it('has all 4 scenario labels', () => {
    expect(e.scenarios['first-day']).toBeTruthy();
    expect(e.scenarios['daily']).toBeTruthy();
    expect(e.scenarios['project']).toBeTruthy();
    expect(e.scenarios['advanced']).toBeTruthy();
  });

  it('has c1-c9 each with title, desc, prompt', () => {
    for (let i = 1; i <= 9; i++) {
      const key = `c${i}` as keyof typeof e;
      const data = e[key] as { title: string; desc: string; prompt: string };
      expect(data.title, `c${i}.title`).toBeTruthy();
      expect(data.desc, `c${i}.desc`).toBeTruthy();
      expect(data.prompt, `c${i}.prompt`).toBeTruthy();
    }
  });
});

describe('i18n plugin market keys', () => {
  it('keeps the Discover entry and market page copy aligned in en and zh', () => {
    expect(en.panels.discover.pluginMarket).toBe('Plugin Market');
    expect(en.panels.discover.pluginMarketDesc).toContain('community plugins');
    expect(zh.panels.discover.pluginMarket).toBe('插件市场');
    expect(zh.panels.discover.pluginMarketDesc).toContain('社区插件');

    for (const messages of [en, zh]) {
      const p = messages.settings.plugins;
      expect(p.marketTitle).toBeTruthy();
      expect(p.marketSubtitle).toBeTruthy();
      expect(p.marketResultNote).toBeTruthy();
      expect(p.marketManageAction).toBeTruthy();
      expect(p.browseMarketAction).toBeTruthy();
      expect(p.marketCheckedAction).toBeTruthy();
      expect(p.marketRetryAction).toBeTruthy();
      expect(p.marketDetailsAction).toBeTruthy();
      expect(p.marketCacheState('fresh')).toBeTruthy();
      expect(p.marketClearSearch).toBeTruthy();
      expect(p.marketFilterAll).toBeTruthy();
      expect(p.marketFilterAvailable).toBeTruthy();
      expect(p.marketShowingCount(1, 2)).toBeTruthy();
      expect(p.marketShowMore(12)).toBeTruthy();
      expect(p.marketLocalDeferred).toBeTruthy();
      expect(p.marketLocalLoadAction).toBeTruthy();
      expect(p.mindosRenderersTitle).toBeTruthy();
    }

    expect(en.settings.plugins.mindosRenderersTitle).toBe('Built-in extensions');
    expect(zh.settings.plugins.mindosRenderersTitle).toBe('内置扩展');
    expect(zh.settings.plugins.communityPreflightSupportLevel('ready')).toBe('可用');
    expect(zh.settings.plugins.communityPreflightSupportLevel('limited')).toBe('受限');
    expect(zh.settings.plugins.communityPreflightSupportLevel('native')).toBe('本机能力');
  });
});

describe('i18n skill market keys', () => {
  it('keeps the Discover entry and skill market page copy aligned in en and zh', () => {
    expect(en.panels.discover.skillMarket).toBe('Skill Market');
    expect(en.panels.discover.skillMarketDesc).toContain('AI agents');
    expect(zh.panels.discover.skillMarket).toBe('技能市场');
    expect(zh.panels.discover.skillMarketDesc).toContain('AI 智能体');
    expect(en.skillMarket.subtitle).toBe('Find public agent skills and review the source before installing.');
    expect(en.skillMarket.manageAction).toBe('Manage Installed');
    expect(zh.skillMarket.manageAction).toBe('管理已安装');

    for (const messages of [en, zh]) {
      const s = messages.skillMarket;
      expect(s.title).toBeTruthy();
      expect(s.subtitle).toBeTruthy();
      expect(s.sourceBadge).toBeTruthy();
      expect(s.reviewBadge).toBeTruthy();
      expect(s.cliBadge).toBeTruthy();
      expect(s.manageAction).toBeTruthy();
      expect(s.searchPlaceholder).toBeTruthy();
      expect(s.searchAction).toBeTruthy();
      expect(s.refreshAction).toBeTruthy();
      expect(s.resultNote).toBeTruthy();
      expect(s.cacheState('fresh')).toBeTruthy();
      expect(s.cacheState('stale')).toBeTruthy();
      expect(s.queryLabel('github')).toBeTruthy();
      expect(s.skippedNotice(2)).toBeTruthy();
      expect(s.showingCount(1, 2)).toBeTruthy();
      expect(s.showMore(12)).toBeTruthy();
      expect(s.installsLabel(1000)).toBeTruthy();
      expect(s.copyCommand).toBeTruthy();
      expect(s.copiedCommand).toBeTruthy();
      expect(s.inspectSourceHint).toBeTruthy();
    }
  });
});

describe('i18n walkthrough keys', () => {
  const w = en.walkthrough;

  it('has step counter function', () => {
    expect(w.step(1, 5)).toBe('1 of 5');
    expect(w.step(3, 5)).toBe('3 of 5');
  });

  it('has navigation labels', () => {
    expect(w.next).toBeTruthy();
    expect(w.back).toBeTruthy();
    expect(w.skip).toBeTruthy();
    expect(w.done).toBeTruthy();
  });

  it('has exploreCta', () => {
    expect(w.exploreCta).toBeTruthy();
  });

  it('defines exactly 3 steps', () => {
    expect(w.steps).toHaveLength(3);
  });

  it('each step has title and body', () => {
    for (const step of w.steps) {
      expect(step.title).toBeTruthy();
      expect(step.body).toBeTruthy();
    }
  });
});

describe('i18n onboarding keys', () => {
  const o = en.onboarding;

  it('has error-related keys', () => {
    expect(o.initError).toBeTruthy();
    expect(o.dismiss).toBeTruthy();
  });
});

describe('i18n agents panel hub', () => {
  const hubKeys = [
    'navOverview',
    'navAssistant',
    'navAgent',
    'navCapabilities',
    'navChannels',
    'navRuns',
    'navMcp',
    'navSkills',
    'rosterLabel',
    'notFoundDetail',
    'skillsEmptyHint',
    'backToList',
    'closeAgentDetail',
    'agentDetailPanelAria',
    'agentDetailTransport',
    'agentDetailSnippet',
  ] as const;

  it('en has all hub keys', () => {
    const a = en.panels.agents;
    for (const k of hubKeys) {
      expect((a as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });

  it('zh mirrors all hub keys', () => {
    const a = zh.panels.agents;
    for (const k of hubKeys) {
      expect((a as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });
});

describe('i18n agents content IA', () => {
  const contentKeys = [
    'navOverview',
    'navAssistant',
    'navAgent',
    'navCapabilities',
    'navChannels',
    'navRuns',
    'agentSubtitle',
    'capabilitiesSubtitle',
    'runsSubtitle',
  ] as const;

  const overviewKeys = [
    'systemModelTitle',
    'toolsUnit',
    'profilesUnit',
    'runtimeEndpointsUnit',
    'entryPointsUnit',
    'assistantLabel',
    'agentLabel',
    'capabilitiesLabel',
    'channelsLabel',
    'runsLabel',
    'nextActionsTitle',
    'actionDetectedTitle',
    'actionConfigureAssistantTitle',
    'actionReviewRunsTitle',
    'actionOpen',
    'recentActivity',
  ] as const;

  const presetKeys = [
    'profileSection',
    'localRoot',
    'localRootHint',
    'loading',
    'loadFailed',
    'retry',
    'emptyTitle',
    'emptyHint',
    'readyLabel',
    'needsPromptLabel',
    'localOwnerLabel',
    'promptMissingHint',
    'saveProfile',
    'profileSaved',
    'nameLabel',
    'descLabel',
    'scheduleLabel',
    'scheduleManual',
    'scheduleDaily',
    'scheduleWeekly',
    'roleTitle',
    'inputTitle',
    'outputTitle',
    'boundaryTitle',
    'noResources',
    'notDefinedYet',
    'totalLabel',
    'scheduledLabel',
    'systemModelDefault',
    'profileInvalidJson',
    'profileUnreadable',
    'promptPlaceholder',
  ] as const;

  it('en has canonical IA keys', () => {
    const a = en.agentsContent;
    for (const k of contentKeys) {
      expect((a as Record<string, unknown>)[k], k).toBeTruthy();
    }
    for (const k of overviewKeys) {
      expect((a.overview as Record<string, unknown>)[k], k).toBeTruthy();
    }
    for (const k of presetKeys) {
      expect((a.presets as Record<string, unknown>)[k], k).toBeTruthy();
    }
    expect(a.navPresets).toBe('Assistant');
    expect(a.presets.title).toBe('Assistant');
  });

  it('zh mirrors canonical IA keys without the old Assistant label', () => {
    const a = zh.agentsContent;
    for (const k of contentKeys) {
      expect((a as Record<string, unknown>)[k], k).toBeTruthy();
    }
    for (const k of overviewKeys) {
      expect((a.overview as Record<string, unknown>)[k], k).toBeTruthy();
    }
    for (const k of presetKeys) {
      expect((a.presets as Record<string, unknown>)[k], k).toBeTruthy();
    }
    expect(a.navAssistant).toBe('助理');
    expect(a.navPresets).toBe('助理');
    expect(a.navCapabilities).toBe('Skills & MCP');
    expect(a.presets.title).toBe('助理');
    expect(a.presets.subtitle).toContain('助理档案');
    expect(a.overview.assistantLabel).toBe('助理');
    expect(a.overview.actionConfigureAssistantTitle).toBe('检查助理路由');
    expect(a.navHints.presets).not.toBe('内置能力');
  });
});

describe('i18n echo panel', () => {
  const echoKeys = [
    'title',
    'overviewTitle',
    'imprintTitle',
    'threadsTitle',
    'growthTitle',
    'practiceTitle',
    'overviewDesc',
    'threadsDesc',
    'practiceDesc',
  ] as const;

  it('en has all echo keys', () => {
    const e = en.panels.echo;
    for (const k of echoKeys) {
      expect((e as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });

  it('zh mirrors all echo keys', () => {
    const e = zh.panels.echo;
    for (const k of echoKeys) {
      expect((e as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });
});

describe('i18n ask panel composer', () => {
  const keys = ['panelComposerResize', 'panelComposerFooter', 'panelComposerResetHint', 'panelComposerKeyboard'] as const;

  it('en has panel composer UX strings', () => {
    const a = en.ask;
    for (const k of keys) {
      expect((a as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });

  it('zh mirrors panel composer UX strings', () => {
    const a = zh.ask;
    for (const k of keys) {
      expect((a as Record<string, unknown>)[k], k).toBeTruthy();
    }
  });
});
