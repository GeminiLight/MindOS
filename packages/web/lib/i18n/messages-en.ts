import { commonEn } from './modules/common-en';
import { navigationEn } from './modules/navigation-en';
import { aiChatEn } from './modules/ai-chat-en';
import { knowledgeEn } from './modules/knowledge-en';
import { panelsEn } from './modules/panels-en';
import { settingsEn } from './modules/settings-en';
import { onboardingEn } from './modules/onboarding-en';
import { featuresEn } from './modules/features-en';
import { workspaceTabsEn } from './modules/workspace-tabs-en';
import { exploreEn } from './generated/explore-i18n-en.generated';

/**
 * Default-locale (en) messages.
 *
 * Bundle-split contract: this is the ONLY locale composition that first-load
 * client code may import statically (see lib/stores/locale-store.ts). zh lives
 * in ./messages-zh and reaches the client either via the server-selected
 * LocaleStoreInitZh chunk or a dynamic import on locale switch. Importing
 * ./index (which composes both locales) from client code defeats the split —
 * guarded by __tests__/lib/first-load-bundle-split.test.ts.
 */
export const en = {
  ...commonEn,
  ...navigationEn,
  ...aiChatEn,
  ...knowledgeEn,
  ...panelsEn,
  ...settingsEn,
  ...onboardingEn,
  ...featuresEn,
  ...workspaceTabsEn,
  explore: exploreEn,
} as const;
