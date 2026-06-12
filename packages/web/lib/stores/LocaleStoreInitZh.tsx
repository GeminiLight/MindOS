'use client';

import { zh } from '@/lib/i18n/messages-zh';
import type { Messages } from '@/lib/i18n';
import LocaleStoreInitClient from './LocaleStoreInitClient';

/**
 * zh variant of the locale store initializer.
 *
 * Statically imports the zh messages so they are available synchronously at
 * hydration time (zh SSR HTML must hydrate to identical zh output — no
 * mismatch, no language flash). The LocaleStoreInit server component renders
 * this only when the request's resolved locale is zh, so Next only ships the
 * zh chunk on zh page loads; en users never download it.
 */
export default function LocaleStoreInitZh() {
  return <LocaleStoreInitClient ssrLocale="zh" ssrMessages={zh as unknown as Messages} />;
}
