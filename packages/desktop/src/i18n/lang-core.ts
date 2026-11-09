/**
 * Pure language helpers — no Electron, no storage.
 *
 * Kept separate from lang.ts so the connect renderer (a browser bundle) can
 * share the resolution rules without dragging the `electron` module into the
 * renderer build.
 */

export type UiLang = 'zh' | 'en';
export type UiLangPreference = 'system' | UiLang;

/** Map an OS/browser locale string to a supported UI language. */
export function normalizeLocaleToLang(locale: string | null | undefined): UiLang {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** A stored preference wins; 'system' (or anything unknown) falls back to the locale. */
export function resolveUiLang(
  preference: string | null | undefined,
  systemLocale: string | null | undefined,
): UiLang {
  if (preference === 'zh' || preference === 'en') return preference;
  return normalizeLocaleToLang(systemLocale);
}

/** Only 'system' | 'zh' | 'en' may be persisted. */
export function normalizeUiLangPreference(value: unknown): UiLangPreference {
  return value === 'zh' || value === 'en' || value === 'system' ? value : 'system';
}
