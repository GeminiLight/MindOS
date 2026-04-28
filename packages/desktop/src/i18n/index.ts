import { zh, type I18nKeys } from './zh';
import { en } from './en';

export type { I18nKeys };
export type Lang = 'zh' | 'en';

export const translations: Record<Lang, Record<I18nKeys, string>> = { zh, en };

let currentLang: Lang = 'zh';

export function setLang(lang: Lang): void {
  currentLang = lang;
}

export function t(key: I18nKeys): string {
  return translations[currentLang][key];
}
