// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mocks = vi.hoisted(() => ({ storage: new Map<string, string>(), stream: vi.fn(), read: vi.fn(), save: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
default: {
    getItem: async (k: string) => mocks.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { mocks.storage.set(k, v) },
    removeItem: async (k: string) => { mocks.storage.delete(k) },
  }
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() { } }) } }));
vi.mock('@/lib/connection-store', () => ({ useConnectionStore: (fn: any) => fn({ serverUrl: 'http://fixture', status: 'connected' }) }));
vi.mock('@/lib/api-client', () => ({ mindosClient: { authToken: '', getFileContent: mocks.read, saveFile: mocks.save }, ApiError: class extends Error { status = 404 } }));
vi.mock('@/hooks/useAgentRunTimeline', () => ({ useAgentRunTimeline: () => { } }));
vi.mock('@/lib/sse-client', async (importOriginal) => ({ ...await importOriginal<any>(), streamChat: mocks.stream }));
import { useChatSessions } from '@/hooks/useChatSessions';
import { useChatWithSession } from '@/hooks/useChatWithSession';
import { saveQuickCapture, queueQuickCapture, loadPendingCaptures } from '@/lib/quick-capture';
let root: any; let value: any;
beforeEach(() => {
  mocks.storage.clear(); mocks.stream.mockReset().mockReturnValue(vi.fn()); mocks.read.mockReset(); mocks.save.mockReset();
  document.body.innerHTML = '<div id="root"></div>'; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() });
async function render(hook: () => any) { function Probe() { value = hook(); return null } await act(async () => root.render(React.createElement(Probe))); }
it('deleting the last session creates one empty replacement', async () => {
  await render(() => useChatSessions()); const id = value.activeSessionId;
  await act(async () => { await value.deleteSession(id) });
  expect(value.sessions.map((s: any) => s.id)).not.toContain(id);
  expect(value.sessions).toHaveLength(1);
});
it('preserves a custom session title when messages are saved', async () => {
  await render(() => useChatSessions()); const id = value.activeSessionId;
  await act(async () => { await value.renameSession(id, 'My custom title') });
  await act(async () => { await value.saveSessionMessages(id, [{ role: 'user', content: 'original question' }]) });
  expect(value.sessions[0].title).toBe('My custom title');
});
it('retry sends the failed question exactly once', async () => {
  const initial: any[] = []; const onChange = vi.fn();
  await render(() => useChatWithSession({ sessionId: 'one', initialMessages: initial, onMessagesChange: onChange }));
  await act(async () => { value.send('hello') });
  await act(async () => { mocks.stream.mock.calls[0][2].onError(new Error('offline')) });
  await act(async () => { value.retry() });
  expect(mocks.stream.mock.calls[1][1].messages.map((m: any) => m.content)).toEqual(['hello']);
});
it('persists an outgoing turn before switching sessions', async () => {
  vi.useFakeTimers(); const initial: any[] = []; const onChange = vi.fn();
  let sessionId = 'one';
  function Probe() { value = useChatWithSession({ sessionId, initialMessages: initial, onMessagesChange: onChange }); return null }
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => vi.advanceTimersByTime(501)); onChange.mockClear();
  await act(async () => { value.send('unsaved question') });
  await act(async () => { mocks.stream.mock.calls[0][2].onEvent({ type: 'text_delta', delta: 'partial answer' }) });
  sessionId = 'two'; await act(async () => root.render(React.createElement(Probe)));
  await act(async () => vi.advanceTimersByTime(501));
  expect(onChange.mock.calls.some(([messages]) => messages.some((m: any) => m.content === 'unsaved question'))).toBe(true);
});
it('serializes quick captures without losing either successful note', async () => {
  let content = '# Inbox\n'; mocks.read.mockImplementation(async () => ({ content, mtime: 1 }));
  mocks.save.mockImplementation(async (_path: string, text: string) => { content = text; return { ok: true, mtime: 2 } });
  await Promise.all([saveQuickCapture('FIRST'), saveQuickCapture('SECOND')]);
  expect(content).toContain('FIRST'); expect(content).toContain('SECOND');

});
it('serializes concurrent offline queue writes', async () => {
  await Promise.all([queueQuickCapture('FIRST'), queueQuickCapture('SECOND')]);
  expect(await loadPendingCaptures()).toHaveLength(2);
});
it('Chat is read-only and Act requests approval for writes', async () => {
  const initial: any[] = []; let intent: 'chat' | 'act' = 'chat';
  function Probe() { value = useChatWithSession({ sessionId: 'permissions', initialMessages: initial, composerIntent: intent, onMessagesChange: vi.fn() }); return null }
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => value.send('explain this'));
  expect(mocks.stream.mock.calls[0][1].permissionMode).toBe('read');
  await act(async () => value.cancel()); intent = 'act'; await act(async () => root.render(React.createElement(Probe)));
  await act(async () => value.send('update this'));
  expect(mocks.stream.mock.calls[1][1].permissionMode).toBe('ask');
});
it('a failed local save remains retryable without losing the message', async () => {
  const initial: any[] = []; const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  await render(() => useChatWithSession({ sessionId: 'one', initialMessages: initial, onMessagesChange: save }));
  await act(async () => value.send('retain me'));
  expect(value.saveError).toBeTruthy();
  await act(async () => value.flush());
  expect(value.saveError).toBe(''); expect(save.mock.lastCall![0][0].content).toBe('retain me');
});
