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

export const useLocaleStore = create<LocaleStoreState>((set) => ({
  locale: 'en',
  t: messages['en'] as unknown as Messages,

  setLocale: (l: Locale) => {
    document.cookie = `locale=${l};path=/;max-age=31536000;SameSite=Lax`;
    document.documentElement.lang = l === 'zh' ? 'zh' : 'en';
    set({ locale: l, t: messages[l] as unknown as Messages });
    window.dispatchEvent(new Event('mindos-locale-change'));
  },

  _init: (ssrLocale: Locale) => {
    // Hydrate with client value (or SSR fallback)
    const clientLocale = typeof window !== 'undefined' ? getLocaleSnapshot() : ssrLocale;
    set({ locale: clientLocale, t: messages[clientLocale] as unknown as Messages });

    // Listen for external changes (e.g. localStorage change in another tab, or pre-hydration script)
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
