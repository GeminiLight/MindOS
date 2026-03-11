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

function getLocaleSnapshot(): Locale {
  const saved = localStorage.getItem('locale');
  return saved === 'zh' ? 'zh' : 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(
    (onStoreChange) => {
      const listener = () => onStoreChange();
      window.addEventListener('mindos-locale-change', listener);
      return () => window.removeEventListener('mindos-locale-change', listener);
    },
    getLocaleSnapshot,
    () => 'en' as Locale,
  );

  const setLocale = (l: Locale) => {
    localStorage.setItem('locale', l);
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
