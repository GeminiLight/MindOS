import type { Widen } from './_core';
import type { en } from './messages-en';
import { commonZh } from './modules/common-zh';
import { navigationZh } from './modules/navigation-zh';
import { aiChatZh } from './modules/ai-chat-zh';
import { knowledgeZh } from './modules/knowledge-zh';
import { panelsZh } from './modules/panels-zh';
import { settingsZh } from './modules/settings-zh';
import { onboardingZh } from './modules/onboarding-zh';
import { featuresZh } from './modules/features-zh';
import { workspaceTabsZh } from './modules/workspace-tabs-zh';
import { exploreZh } from './generated/explore-i18n-zh.generated';

/**
 * zh messages — kept out of the shared first-load client graph.
 *
 * Client code reaches this module only through:
 *  - lib/stores/LocaleStoreInitZh.tsx (server-selected chunk, zh requests only)
 *  - the dynamic import in lib/stores/locale-store.ts (runtime locale switch)
 * Server code (route handlers, tests) may import it freely via ./index.
 */
export const zh: Widen<typeof en> = {
  ...commonZh,
  ...navigationZh,
  ...aiChatZh,
  ...knowledgeZh,
  ...panelsZh,
  ...settingsZh,
  ...onboardingZh,
  ...featuresZh,
  ...workspaceTabsZh,
  explore: exploreZh,
};
