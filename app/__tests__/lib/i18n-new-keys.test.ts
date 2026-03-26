import { describe, it, expect } from 'vitest';
import { en } from '@/lib/i18n-en';
import { zh } from '@/lib/i18n-zh';

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

  it('defines exactly 4 steps', () => {
    expect(w.steps).toHaveLength(4);
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

describe('i18n echo panel', () => {
  const echoKeys = [
    'title',
    'aboutYouTitle',
    'continuedTitle',
    'dailyEchoTitle',
    'pastYouTitle',
    'intentGrowthTitle',
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
