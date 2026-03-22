/**
 * Connection storage with pluggable backend.
 * Browser/Capacitor: use browserStorage (localStorage)
 * Electron main process: inject electron-store adapter
 */
import type { SavedConnection } from './connection';

const STORAGE_KEY = 'mindos:connections';
const ACTIVE_KEY = 'mindos:activeConnection';
const MAX_CONNECTIONS = 5;

/** Storage backend interface (localStorage-compatible) */
export interface ConnectionStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Browser/Capacitor localStorage adapter */
export const browserStorage: ConnectionStorage = {
  get: (k) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { localStorage.setItem(k, v); } catch { /* quota exceeded or restricted */ }
  },
  remove: (k) => {
    try { localStorage.removeItem(k); } catch { /* restricted */ }
  },
};

/** In-memory storage for testing */
export function createMemoryStorage(): ConnectionStorage {
  const store = new Map<string, string>();
  return {
    get: (k) => store.get(k) ?? null,
    set: (k, v) => { store.set(k, v); },
    remove: (k) => { store.delete(k); },
  };
}

/** Create a connection store with the given storage backend */
export function createConnectionStore(storage: ConnectionStorage) {
  function readAll(): SavedConnection[] {
    const raw = storage.get(STORAGE_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function writeAll(conns: SavedConnection[]): void {
    storage.set(STORAGE_KEY, JSON.stringify(conns));
  }

  return {
    /** Get all connections, sorted by lastConnected descending */
    getConnections(): SavedConnection[] {
      return readAll().sort(
        (a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime(),
      );
    },

    /** Save or update a connection (match by address). Enforces MAX_CONNECTIONS limit. */
    saveConnection(conn: SavedConnection): void {
      let list = readAll();
      const idx = list.findIndex((c) => c.address === conn.address);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...conn };
      } else {
        list.unshift(conn);
      }
      // Sort by most recent first, then trim
      list.sort(
        (a, b) => new Date(b.lastConnected).getTime() - new Date(a.lastConnected).getTime(),
      );
      if (list.length > MAX_CONNECTIONS) {
        list = list.slice(0, MAX_CONNECTIONS);
      }
      writeAll(list);
    },

    /** Remove a connection by address */
    removeConnection(address: string): void {
      const list = readAll().filter((c) => c.address !== address);
      writeAll(list);
    },

    /** Get the active (last used) connection address */
    getActiveConnection(): string | null {
      return storage.get(ACTIVE_KEY);
    },

    /** Set the active connection address */
    setActiveConnection(address: string): void {
      storage.set(ACTIVE_KEY, address);
    },

    /** Clear active connection */
    clearActiveConnection(): void {
      storage.remove(ACTIVE_KEY);
    },
  };
}
