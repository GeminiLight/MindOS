import { beforeEach, expect, it, vi } from 'vitest';
const data = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); },
    getAllKeys: async () => [...data.keys()],
  }
}));
import { setWorkspaceIdentity, workspaceKey, getWorkspaceIdentity, migrateLegacyWorkspace } from '@/lib/workspace-storage';
beforeEach(() => { data.clear(); setWorkspaceIdentity('', ''); });
it('isolates the same storage key across servers and knowledge roots', () => {
  setWorkspaceIdentity('https://one.test/', 'root-a');
  const a = workspaceKey('chat');
  setWorkspaceIdentity('https://one.test', 'root-b');
  expect(workspaceKey('chat')).not.toBe(a);
  setWorkspaceIdentity('https://two.test', 'root-a');
  expect(workspaceKey('chat')).not.toBe(a);
  setWorkspaceIdentity('https://one.test', 'root-a');
  expect(workspaceKey('chat')).toBe(a);
});
it('copies legacy data only to the original saved server and preserves the original', async () => {
  data.set('mindos_server_url', 'https://one.test');
  data.set('mindos_chat_sessions', '[{"id":"legacy"}]');
  setWorkspaceIdentity('https://two.test', 'b');
  await migrateLegacyWorkspace(getWorkspaceIdentity());
  expect(data.has(workspaceKey('mindos_chat_sessions'))).toBe(false);
  setWorkspaceIdentity('https://one.test', 'a');
  await migrateLegacyWorkspace(getWorkspaceIdentity());
  expect(data.get(workspaceKey('mindos_chat_sessions'))).toContain('legacy');
  expect(data.get('mindos_chat_sessions')).toContain('legacy');
  setWorkspaceIdentity('https://one.test', 'different-root');
  await migrateLegacyWorkspace(getWorkspaceIdentity());
  expect(data.has(workspaceKey('mindos_chat_sessions'))).toBe(false);
});
it('does not automatically adopt legacy pending writes with unknown ownership', async () => {
  data.set('mindos_server_url', 'https://one.test');
  data.set('mindos_quick_capture_pending_queue', '[{"text":"private"}]');
  setWorkspaceIdentity('https://one.test', 'a');
  await migrateLegacyWorkspace(getWorkspaceIdentity());
  expect(data.has(workspaceKey('mindos_quick_capture_pending_queue'))).toBe(false);
  expect(data.has('mindos_quick_capture_pending_queue')).toBe(true);
});
it('keeps legacy chats visible while the first root identity is being verified', async () => {
  data.set('mindos_server_url', 'https://one.test'); data.set('mindos_chat_sessions', '[{"id":"legacy"}]');
  setWorkspaceIdentity('https://one.test'); await migrateLegacyWorkspace(getWorkspaceIdentity());
  data.set(workspaceKey('mindos_chat_sessions'), '[{"id":"legacy"},{"id":"offline"}]');
  setWorkspaceIdentity('https://one.test', 'first-root'); await migrateLegacyWorkspace(getWorkspaceIdentity());
  expect(data.get(workspaceKey('mindos_chat_sessions'))).toContain('offline');
  setWorkspaceIdentity('https://one.test', 'second-root'); await migrateLegacyWorkspace(getWorkspaceIdentity());
  expect(data.has(workspaceKey('mindos_chat_sessions'))).toBe(false);
});
