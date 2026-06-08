import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MINDOS_AGENT } from '@/lib/ask-agent';
import { aiChatEn, aiChatZh } from '@/lib/i18n/modules/ai-chat';
import { navigationEn, navigationZh } from '@/lib/i18n/modules/navigation';
import { knowledgeEn, knowledgeZh } from '@/lib/i18n/modules/knowledge';
import { featuresEn, featuresZh } from '@/lib/i18n/modules/features';
import { panelsEn, panelsZh } from '@/lib/i18n/modules/panels';
import { onboardingEn, onboardingZh } from '@/lib/i18n/modules/onboarding';

const repoRoot = path.resolve(__dirname, '../../../..');

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

  it('frames the local knowledge surface as Mind with a built-in mind system', () => {
    expect(navigationEn.sidebar.files).toBe('Mind');
    expect(navigationZh.sidebar.files).toBe('Mind');
    expect(navigationEn.sidebar.builtInSpacesTitle).toBe('Mind System');
    expect(navigationZh.sidebar.builtInSpacesTitle).toBe('Mind 系统');
    expect(navigationEn.sidebar.builtInSpacesRoot).toContain('Dao');
    expect(navigationEn.sidebar.builtInSpacesRoot).toContain('Shu');
    expect(navigationZh.sidebar.builtInSpacesRoot).toContain('道');
    expect(navigationZh.sidebar.builtInSpacesRoot).toContain('术');

    expect(knowledgeEn.home.builtInSpacesTitle).toBe('Mind System');
    expect(knowledgeZh.home.builtInSpacesTitle).toBe('Mind 系统');
    expect(Object.keys(knowledgeEn.home.mindPillars)).toEqual(['dao', 'fa', 'shu', 'qi', 'shi', 'yan']);
    expect(Object.keys(knowledgeZh.home.mindPillars)).toEqual(['dao', 'fa', 'shu', 'qi', 'shi', 'yan']);
  });

  it('packages every built-in MindOS skill reference used by SKILL.md', () => {
    for (const skillName of ['mindos', 'mindos-zh']) {
      const sourceSkillPath = path.join(repoRoot, 'skills', skillName, 'SKILL.md');
      const packagedSkillPath = path.join(repoRoot, 'packages/web/data/skills', skillName, 'SKILL.md');
      const sourceSkill = fs.readFileSync(sourceSkillPath, 'utf-8');
      const packagedSkill = fs.readFileSync(packagedSkillPath, 'utf-8');
      const refs = Array.from(sourceSkill.matchAll(/references\/[\w.-]+\.md/g), match => match[0]);

      expect(packagedSkill).toBe(sourceSkill);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of new Set(refs)) {
        const sourceRef = path.join(repoRoot, 'skills', skillName, ref);
        const packagedRef = path.join(repoRoot, 'packages/web/data/skills', skillName, ref);
        expect(fs.existsSync(packagedRef), `${skillName} missing packaged ${ref}`).toBe(true);
        expect(fs.readFileSync(packagedRef, 'utf-8')).toBe(fs.readFileSync(sourceRef, 'utf-8'));
      }
    }
  });
});
