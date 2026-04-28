import { describe, it, expect } from 'vitest';
import { MINDOS_AGENT } from '@/lib/ask-agent';
import { aiChatEn, aiChatZh } from '@/lib/i18n/modules/ai-chat';
import { navigationEn, navigationZh } from '@/lib/i18n/modules/navigation';
import { featuresEn, featuresZh } from '@/lib/i18n/modules/features';
import { panelsEn, panelsZh } from '@/lib/i18n/modules/panels';
import { onboardingEn, onboardingZh } from '@/lib/i18n/modules/onboarding';

describe('MindOS copy alignment', () => {
  it('uses MindOS as the default local assistant name', () => {
    expect(MINDOS_AGENT).toEqual({ id: 'mindos', name: 'MindOS' });
    expect(aiChatEn.ask.title).toBe('MindOS');
    expect(aiChatZh.ask.title).toBe('MindOS');
    expect(navigationEn.sidebar.askTitle).toBe('MindOS');
    expect(navigationZh.sidebar.askTitle).toBe('MindOS');
    expect(panelsEn.panels.agents.acpDefaultAgent).toBe('MindOS');
    expect(panelsZh.panels.agents.acpDefaultAgent).toBe('MindOS');
  });

  it('keeps shortcut and onboarding copy aligned around MindOS', () => {
    expect(featuresEn.shortcuts[1]?.description).toBe('MindOS');
    expect(featuresZh.shortcuts[1]?.description).toBe('MindOS');
    expect(featuresEn.shortcuts[2]?.description).not.toBe('MindOS');
    expect(onboardingEn.setup.welcomeLinkAskAI).toBe('MindOS');
    expect(onboardingZh.setup.welcomeLinkAskAI).toBe('MindOS');
    expect(onboardingEn.walkthrough.steps[1]?.body).toContain('MindOS');
    expect(onboardingZh.walkthrough.steps[1]?.body).toContain('MindOS');
  });

  it('removes second-brain wording from key user-facing copy surfaces', () => {
    expect(featuresEn.help.whatIs.body.toLowerCase()).not.toContain('same brain');
    expect(featuresZh.help.whatIs.body).not.toContain('同一个大脑');
    expect(panelsEn.panels.im.emptyDesc.toLowerCase()).not.toContain('mindos agent');
    expect(panelsZh.panels.im.emptyDesc).not.toContain('MindOS Agent');
  });
});
