import AsyncStorage from '@react-native-async-storage/async-storage';

let identity = '';
const listeners = new Set<() => void>();
export function subscribeWorkspaceIdentity(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function setWorkspaceIdentity(server: string, rootId = ''): void {
  const next = server ? JSON.stringify([server.replace(/\/+$/, ''), rootId]) : '';
  if (next === identity) return;
  identity = next;
  for (const listener of listeners) listener();
}
export function getWorkspaceIdentity(): string { return identity; }
export function workspaceKey(key: string, scope = identity): string {
  return `mindos_workspace_v1:${scope || 'unpaired'}:${key}`;
}

/** Serializes read/modify/write operations; a rejected write must not poison the queue. */
const queues = new Map<string, Promise<unknown>>();
export function serializeWorkspace<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.catch(() => { }).finally(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  queues.set(key, settled);
  return result;
}

/** Copy readable history to the original server once. Preserve all legacy originals.
 * Pending writes are deliberately excluded: a previous server switch may have left
 * them with unknown ownership. They require explicit recovery, never auto-send.
 */
export async function migrateLegacyWorkspace(scope: string): Promise<void> {
  if (!scope || typeof AsyncStorage.getAllKeys !== 'function') return;
  await serializeWorkspace('legacy-migration', async () => {
    const marker = 'mindos_workspace_migrated_v1';
    const migrated = await AsyncStorage.getItem(marker);
    const [server, root] = JSON.parse(scope) as string[];
    let previousScope: string | null = null;
    if (migrated) {
      const [previousServer, previousRoot] = JSON.parse(migrated) as string[];
      if (previousServer !== server || previousRoot || !root) return;
      previousScope = migrated;
    }
    const saved = await AsyncStorage.getItem('mindos_server_url');
    if (!saved || saved.replace(/\/+$/, '') !== server) return;
    const prefix = previousScope ? workspaceKey('', previousScope) : '';
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix)).filter(key => {
      const local = key.slice(prefix.length);
      return local.startsWith('mindos_chat_') || local === 'mindos_file_tree_cache';
    });
    for (const key of keys) {
      const value = await AsyncStorage.getItem(key);
      const target = workspaceKey(key.slice(prefix.length), scope);
      if (value !== null && await AsyncStorage.getItem(target) === null) {
        await AsyncStorage.setItem(target, value);
      }
    }
    await AsyncStorage.setItem(marker, scope);
  });
}
