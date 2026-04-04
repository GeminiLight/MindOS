'use client';

import { useEffect } from 'react';
import { useLocaleStore } from '@/lib/stores/locale-store';
import type { Locale } from '@/lib/i18n';

/**
 * Initializes locale store with SSR value and attaches event listeners.
 * Renders nothing. Place once near the root.
 */
export default function LocaleStoreInit({ ssrLocale }: { ssrLocale: Locale }) {
  useEffect(() => {
    const cleanup = useLocaleStore.getState()._init(ssrLocale);
    return cleanup;
  }, [ssrLocale]);

  return null;
}
