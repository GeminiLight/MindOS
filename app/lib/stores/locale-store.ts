'use client';

import { create } from 'zustand';
import { Locale, messages, Messages } from '@/lib/i18n';

/* ── Store ── */

export interface LocaleStoreState {
  locale: Locale;
  t: Messages;
  setLocale: (l: Locale) => void;
  /** Hydrate from SSR value + attach listeners. Returns cleanup. */
  _init: (ssrLocale: Locale) => () => void;
}

/** Read locale from localStorage, resolving 'system' */
function getLocaleSnapshot(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem('locale');
  if (saved === 'zh') return 'zh';
  if (saved === 'en') return 'en';
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
}

/**
 * Read the locale that the inline <script> in layout.tsx already resolved.
 * Returns 'en' to match SSR default — the LocaleStoreInit component
 * reconciles to the real locale synchronously before first commit.
 */
function getPreHydrateLocale(): Locale {
  return 'en';
}

const initialLocale = getPreHydrateLocale();

export const useLocaleStore = create<LocaleStoreState>((set) => ({
  locale: initialLocale,
  t: messages[initialLocale] as unknown as Messages,

  setLocale: (l: Locale) => {
    document.cookie = `locale=${l};path=/;max-age=31536000;SameSite=Lax`;
    document.documentElement.lang = l === 'zh' ? 'zh' : 'en';
    (window as any).__mindos_locale__ = l;
    set({ locale: l, t: messages[l] as unknown as Messages });
    window.dispatchEvent(new Event('mindos-locale-change'));
  },

  _init: (ssrLocale: Locale) => {
    // Reconcile: if client localStorage disagrees with current store, update once
    const clientLocale = getLocaleSnapshot();
    const current = useLocaleStore.getState().locale;
    if (clientLocale !== current) {
      set({ locale: clientLocale, t: messages[clientLocale] as unknown as Messages });
    }

    const handler = () => {
      const l = getLocaleSnapshot();
      set({ locale: l, t: messages[l] as unknown as Messages });
    };
    window.addEventListener('mindos-locale-change', handler);
    return () => window.removeEventListener('mindos-locale-change', handler);
  },
}));

/* ── Backward-compatible hook ── */

export function useLocale() {
  return useLocaleStore();
}
