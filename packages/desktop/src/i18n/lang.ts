/**
 * Single source of truth for the Desktop shell's UI language (main process).
 *
 * Before this module the shell had three independent language sources:
 *   - main process   → app.getLocale()
 *   - connect window → localStorage['mindos-lang']
 *   - splash window  → navigator.language
 * Toggling the language in the connect window left the tray, menu, splash and
 * every dialog in the old language. Everything now resolves through
 * getUiLang(), and the user's explicit choice is persisted app-wide.
 *
 * Pure helpers live in lang-core.ts so the renderer bundle can reuse them
 * without importing `electron`.
 */
// Namespace import: safe even when the `electron` entry point is the plain
// CJS path string (plain Node test runs), and still intercepted by vi.mock.
import * as electron from 'electron';
import {
  normalizeUiLangPreference,
  resolveUiLang,
  type UiLang,
  type UiLangPreference,
} from './lang-core';

export {
  normalizeLocaleToLang,
  normalizeUiLangPreference,
  resolveUiLang,
  type UiLang,
  type UiLangPreference,
} from './lang-core';

function systemLocale(): string | undefined {
  try {
    return (electron as unknown as { app?: { getLocale?: () => string } })?.app?.getLocale?.();
  } catch {
    return undefined;
  }
}

function readStoredPreference(): UiLangPreference {
  try {
    // Lazy: electron-store needs a real app instance, and the shared language
    // must still resolve (to 'system') in plain unit tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: electron-store needs a live app at import time; unit tests must still load this module
    const { getAppConfigStore } = require('../app-config-store') as typeof import('../app-config-store');
    return normalizeUiLangPreference(getAppConfigStore().get('uiLang'));
  } catch {
    return 'system';
  }
}

/** Current UI language for every main-process surface (dialogs, tray, menu, overlays). */
export function getUiLang(): UiLang {
  return resolveUiLang(readStoredPreference(), systemLocale());
}

export function getUiLangPreference(): UiLangPreference {
  return readStoredPreference();
}

/** Persist an explicit choice (or 'system' to follow the OS again). Returns the resolved language. */
export function setUiLangPreference(value: unknown): UiLang {
  const preference = normalizeUiLangPreference(value);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: electron-store needs a live app at import time; unit tests must still load this module
    const { getAppConfigStore } = require('../app-config-store') as typeof import('../app-config-store');
    getAppConfigStore().set('uiLang', preference);
  } catch {
    /* store unavailable — fall back to system locale for this session */
  }
  return resolveUiLang(preference, systemLocale());
}

/** Convenience for the many `const zh = ...` call sites. */
export function isZhUi(): boolean {
  return getUiLang() === 'zh';
}
