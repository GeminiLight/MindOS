'use client';

import { createContext, useContext, useSyncExternalStore, ReactNode } from 'react';
import { Locale, messages, Messages } from './i18n';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Messages;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: messages['en'],
});

/** Read locale from localStorage (canonical client source), resolving 'system' */
function getLocaleSnapshot(): Locale {
  const saved = localStorage.getItem('locale');
  if (saved === 'zh') return 'zh';
  if (saved === 'en') return 'en';
  // 'system' or null — detect from browser
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
}

interface LocaleProviderProps {
  children: ReactNode;
  /** Locale read from cookie on the server — ensures SSR matches client hydration */
  ssrLocale?: Locale;
}

export function LocaleProvider({ children, ssrLocale = 'en' }: LocaleProviderProps) {
  const locale = useSyncExternalStore(
    (onStoreChange) => {
      const listener = () => onStoreChange();
      window.addEventListener('mindos-locale-change', listener);
      return () => window.removeEventListener('mindos-locale-change', listener);
    },
    getLocaleSnapshot,
    () => ssrLocale,
  );

  const setLocale = (l: Locale) => {
    // Only write resolved locale to cookie + html lang (not localStorage — caller manages that)
    document.cookie = `locale=${l};path=/;max-age=31536000;SameSite=Lax`;
    document.documentElement.lang = l === 'zh' ? 'zh' : 'en';
    window.dispatchEvent(new Event('mindos-locale-change'));
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: messages[locale] as unknown as Messages }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
