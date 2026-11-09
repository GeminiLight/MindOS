/**
 * Persistent app-level config store — caches startup-related values
 * (node path, last clean exit timestamp, etc.) across restarts.
 *
 * Separate from window-state.ts to keep concerns isolated.
 */
import Store from 'electron-store';

interface AppConfig {
  /** Timestamp (ms) of the last clean app exit */
  lastCleanExit: number;
  /** Cached absolute path to the Node.js binary */
  cachedNodePath: string;
  /**
   * Explicit UI language for the whole shell (boot shell + connect + tray + menu +
   * dialogs). 'system' follows app.getLocale(). See i18n/lang.ts.
   */
  uiLang: 'system' | 'zh' | 'en';
  /**
   * Explicit appearance for the shell's own surfaces. 'system' follows
   * nativeTheme. See ui-theme.ts — the Web app keeps its own `theme` key.
   */
  uiTheme: 'system' | 'light' | 'dark';
}

const store = new Store<AppConfig>({
  name: 'mindos-app-config',
  defaults: {
    lastCleanExit: 0,
    cachedNodePath: '',
    uiLang: 'system',
    uiTheme: 'system',
  },
});

export function getAppConfigStore() {
  return store;
}
