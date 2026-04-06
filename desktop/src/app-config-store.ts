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
}

const store = new Store<AppConfig>({
  name: 'mindos-app-config',
  defaults: {
    lastCleanExit: 0,
    cachedNodePath: '',
  },
});

export function getAppConfigStore() {
  return store;
}
