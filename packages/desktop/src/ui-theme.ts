/**
 * Shell appearance preference (boot shell + connect dialogs + main-window backdrop).
 *
 * The shell used to keep this only in the connect window's localStorage, so:
 *   - the splash screen ignored it entirely and always followed the OS;
 *   - the main window painted a hardcoded light backdrop, which gave every
 *     dark-mode user a white flash on launch — the opposite of what that
 *     backgroundColor was there for.
 *
 * Language already resolves through a single main-process source (i18n/lang.ts);
 * this is the same shape for appearance. Scope is deliberately the shell's own
 * surfaces: the Web app owns its own `theme` key on its own origin, and the
 * shell must not overwrite a durable user setting with a transient one.
 */
import * as electron from 'electron';

export type UiTheme = 'light' | 'dark';
export type UiThemePreference = 'system' | UiTheme;

/** Matches `--background` in packages/web/app/globals.css. */
export const SHELL_BACKGROUND = { light: '#f8f6f1', dark: '#131210' } as const;

export function normalizeUiThemePreference(value: unknown): UiThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** Pure: an explicit preference wins; 'system' defers to the OS. */
export function resolveUiTheme(
  preference: string | null | undefined,
  systemPrefersDark: boolean,
): UiTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemPrefersDark ? 'dark' : 'light';
}

/** Pure: the backdrop a window should paint before its first frame. */
export function backgroundColorFor(theme: UiTheme): string {
  return SHELL_BACKGROUND[theme];
}

function systemPrefersDark(): boolean {
  try {
    return Boolean((electron as unknown as { nativeTheme?: { shouldUseDarkColors?: boolean } })
      ?.nativeTheme?.shouldUseDarkColors);
  } catch {
    return false;
  }
}

function readStoredPreference(): UiThemePreference {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: electron-store needs a live app at import time; unit tests must still load this module
    const { getAppConfigStore } = require('./app-config-store') as typeof import('./app-config-store');
    return normalizeUiThemePreference(getAppConfigStore().get('uiTheme'));
  } catch {
    return 'system';
  }
}

export function getUiThemePreference(): UiThemePreference {
  return readStoredPreference();
}

export function getUiTheme(): UiTheme {
  return resolveUiTheme(readStoredPreference(), systemPrefersDark());
}

/** Persist an explicit choice (or 'system'). Returns the resolved theme. */
export function setUiThemePreference(value: unknown): UiTheme {
  const preference = normalizeUiThemePreference(value);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: electron-store needs a live app at import time; unit tests must still load this module
    const { getAppConfigStore } = require('./app-config-store') as typeof import('./app-config-store');
    getAppConfigStore().set('uiTheme', preference);
  } catch {
    /* store unavailable — fall back to the OS for this session */
  }
  return resolveUiTheme(preference, systemPrefersDark());
}

/** Backdrop for a freshly created window, so the first paint is never the wrong colour. */
export function currentWindowBackground(): string {
  return backgroundColorFor(getUiTheme());
}
