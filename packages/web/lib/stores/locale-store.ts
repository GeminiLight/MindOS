'use client';

import { create } from 'zustand';
import { en } from '@/lib/i18n/messages-en';
import type { Locale, Messages } from '@/lib/i18n';

/* ── Lazy locale messages ──
 *
 * Only the default locale (en) is statically bundled into the shared
 * first-load chunk. zh messages arrive in one of two ways:
 *  - registered synchronously before the store is read, by the
 *    server-selected LocaleStoreInitZh client component (zh SSR requests), or
 *  - dynamically imported here when the user switches locale at runtime.
 */

const loadedMessages: Partial<Record<Locale, Messages>> = { en };
let zhLoadPromise: Promise<Messages> | null = null;
/** Monotonic token: a stale async load must never overwrite a newer choice. */
let applyToken = 0;

/** Make a locale's messages available synchronously (used by SSR init). */
export function registerMessages(locale: Locale, msgs: Messages): void {
  loadedMessages[locale] = msgs;
}

function loadMessages(locale: Locale): Promise<Messages> {
  const cached = loadedMessages[locale];
  if (cached) return Promise.resolve(cached);
  if (!zhLoadPromise) {
    zhLoadPromise = import('@/lib/i18n/messages-zh')
      .then((mod) => {
        const msgs = mod.zh as unknown as Messages;
        loadedMessages.zh = msgs;
        return msgs;
      })
      .catch((err) => {
        zhLoadPromise = null; // allow a retry on the next switch
        throw err;
      });
  }
  return zhLoadPromise;
}

type SetState = (partial: Partial<LocaleStoreState>) => void;

/**
 * Apply a locale: synchronously when its messages are cached, otherwise
 * atomically (locale + strings together) once the lazy bundle resolves —
 * the UI keeps showing the previous locale in full until then, so there is
 * never a mixed-language or wrong-language intermediate state.
 */
function applyLocale(locale: Locale, set: SetState): void {
  const token = ++applyToken;
  const cached = loadedMessages[locale];
  if (cached) {
    set({ locale, t: cached });
    return;
  }
  void loadMessages(locale)
    .then((msgs) => {
      if (token === applyToken) set({ locale, t: msgs });
    })
    .catch((err) => {
      // Graceful degradation: keep the current locale's strings.
      console.error(`[locale-store] Failed to load messages for "${locale}":`, err);
    });
}

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

// The store defaults to 'en' (matching the SSR default); LocaleStoreInit
// reconciles to the real locale synchronously before first commit.
export const useLocaleStore = create<LocaleStoreState>((set) => ({
  locale: 'en',
  t: en as Messages,

  setLocale: (l: Locale) => {
    document.cookie = `locale=${l};path=/;max-age=31536000;SameSite=Lax`;
    document.documentElement.lang = l === 'zh' ? 'zh' : 'en';
    (window as unknown as { __mindos_locale__?: Locale }).__mindos_locale__ = l;
    applyLocale(l, set);
    window.dispatchEvent(new Event('mindos-locale-change'));
  },

  _init: (ssrLocale: Locale) => {
    void ssrLocale; // SSR alignment already happened in applySsrLocale
    // Reconcile: if client localStorage disagrees with current store, update once
    const clientLocale = getLocaleSnapshot();
    if (clientLocale !== useLocaleStore.getState().locale) {
      applyLocale(clientLocale, set);
    }

    const handler = () => {
      applyLocale(getLocaleSnapshot(), set);
    };
    window.addEventListener('mindos-locale-change', handler);
    return () => window.removeEventListener('mindos-locale-change', handler);
  },
}));

/**
 * Synchronously align the store with the SSR-resolved locale during the first
 * client render (called from LocaleStoreInitClient's useState initializer,
 * which runs before sibling components read `t` — this is what keeps the
 * first client render identical to the server HTML).
 */
export function applySsrLocale(ssrLocale: Locale): void {
  if (useLocaleStore.getState().locale === ssrLocale) return;
  applyLocale(ssrLocale, (partial) => useLocaleStore.setState(partial));
}

/* ── Backward-compatible hook ── */

export function useLocale() {
  return useLocaleStore();
}
