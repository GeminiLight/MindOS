import type { Locale } from '@/lib/i18n';
import LocaleStoreInitClient from './LocaleStoreInitClient';
import LocaleStoreInitZhLoader from './LocaleStoreInitZhLoader';

/**
 * Server component: selects the per-locale client initializer for this
 * request. The zh branch goes through LocaleStoreInitZhLoader, whose
 * client-side import() keeps messages-zh in an async chunk that only zh
 * responses reference — en first load never ships zh strings. Do NOT import
 * LocaleStoreInitZh here (even dynamically): any client component referenced
 * from a server module is bundled eagerly into the layout chunk group.
 */
export default function LocaleStoreInit({ ssrLocale }: { ssrLocale: Locale }) {
  if (ssrLocale === 'zh') return <LocaleStoreInitZhLoader />;
  return <LocaleStoreInitClient ssrLocale={ssrLocale} />;
}
