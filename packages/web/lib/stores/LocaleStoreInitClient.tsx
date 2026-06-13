'use client';

import { useEffect, useState } from 'react';
import { applySsrLocale, registerMessages, useLocaleStore } from '@/lib/stores/locale-store';
import type { Locale, Messages } from '@/lib/i18n';

/**
 * Initializes the locale store with the SSR value and attaches listeners.
 * Renders nothing. Rendered once near the root, BEFORE the app shell, so its
 * first-render store update is visible to every sibling/child component in
 * the same pass (no hydration mismatch).
 *
 * `ssrMessages` is provided by per-locale wrappers (LocaleStoreInitZh) whose
 * static import puts the non-default locale in a chunk that the server only
 * references for matching requests. This file must NOT import messages-zh.
 */
export default function LocaleStoreInitClient({
  ssrLocale,
  ssrMessages,
}: {
  ssrLocale: Locale;
  ssrMessages?: Messages;
}) {
  // Synchronous one-time store update during first render — before React
  // commits. Registering the SSR locale's messages first guarantees the
  // store can swap to them without an async gap.
  useState(() => {
    if (ssrMessages) registerMessages(ssrLocale, ssrMessages);
    applySsrLocale(ssrLocale);
    return null;
  });

  useEffect(() => {
    // Reconciles with localStorage/navigator for the true client preference.
    const cleanup = useLocaleStore.getState()._init(ssrLocale);
    return cleanup;
  }, [ssrLocale]);

  return null;
}
