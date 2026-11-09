import { zh, type I18nKeys } from './zh';
import { en } from './en';
// lang-core only — importing ./lang here would pull `electron` into the
// renderer bundle (and with it fs / path / child_process shims).
import { normalizeLocaleToLang, resolveUiLang, type UiLang } from './lang-core';

export type { I18nKeys };
export type Lang = UiLang;

export const translations: Record<Lang, Record<I18nKeys, string>> = { zh, en };

/**
 * Keys whose value contains intentional markup. Everything else is injected as
 * text so a translation can never become an HTML sink (see applyI18n).
 */
export const HTML_I18N_KEYS: ReadonlySet<I18nKeys> = new Set<I18nKeys>(['hint']);

function detectBrowserLang(): Lang {
  try {
    return normalizeLocaleToLang(
      typeof navigator !== 'undefined' ? navigator.language : undefined,
    );
  } catch {
    return 'en';
  }
}

/**
 * Default to the environment language rather than a hardcoded 'zh'. t() used to
 * return Chinese for anything rendered before the first setLang() call.
 */
let currentLang: Lang = detectBrowserLang();

export function setLang(lang: Lang): void {
  currentLang = lang;
}

export function getLang(): Lang {
  return currentLang;
}

/** Interpolate `{name}` placeholders; unknown names stay verbatim. */
export function formatI18n(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export function t(key: I18nKeys, params?: Record<string, string | number>): string {
  return formatI18n(translations[currentLang][key], params);
}

/** True when `key` is a known translation key (used to translate main-process error codes). */
export function isI18nKey(key: unknown): key is I18nKeys {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(zh, key);
}

/**
 * Translate a structured failure coming from the main process. Main sends a
 * stable `code` (+ params) so the Chinese UI never shows raw English fetch
 * errors; `message` is only a last-resort fallback for unexpected failures.
 */
export function translateFailure(
  failure: { code?: unknown; params?: Record<string, string | number>; message?: unknown } | null | undefined,
  fallbackKey: I18nKeys,
): string {
  if (failure && isI18nKey(failure.code)) return t(failure.code, failure.params);
  if (failure && typeof failure.message === 'string' && failure.message) return failure.message;
  return t(fallbackKey);
}

export { resolveUiLang, normalizeLocaleToLang };
