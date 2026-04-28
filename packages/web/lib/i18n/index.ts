import type { Widen } from './_core';
import { commonEn, commonZh } from './modules/common';
import { navigationEn, navigationZh } from './modules/navigation';
import { aiChatEn, aiChatZh } from './modules/ai-chat';
import { knowledgeEn, knowledgeZh } from './modules/knowledge';
import { panelsEn, panelsZh } from './modules/panels';
import { settingsEn, settingsZh } from './modules/settings';
import { onboardingEn, onboardingZh } from './modules/onboarding';
import { featuresEn, featuresZh } from './modules/features';
import { exploreEn, exploreZh } from './generated/explore-i18n.generated';

export const en = {
  ...commonEn,
  ...navigationEn,
  ...aiChatEn,
  ...knowledgeEn,
  ...panelsEn,
  ...settingsEn,
  ...onboardingEn,
  ...featuresEn,
  explore: exploreEn,
} as const;

export const zh: Widen<typeof en> = {
  ...commonZh,
  ...navigationZh,
  ...aiChatZh,
  ...knowledgeZh,
  ...panelsZh,
  ...settingsZh,
  ...onboardingZh,
  ...featuresZh,
  explore: exploreZh,
};

export type Locale = 'en' | 'zh';
export const messages = { en, zh } as const;
export type Messages = typeof en;
