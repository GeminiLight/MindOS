// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), input: {} as any, buttons: [] as any[], storage: new Map<string, string>() }));
vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove() { } }) }, Platform: { OS: 'ios' }, useColorScheme: () => 'dark',
  StyleSheet: { create: (x: any) => x, hairlineWidth: 1 }, Alert: { alert: vi.fn() },
  View: ({ children }: any) => children, Text: ({ children }: any) => children,
  ScrollView: ({ children }: any) => children, ActivityIndicator: () => null,
  TextInput: (props: any) => { mocks.input = props; return null },
  Pressable: (props: any) => { mocks.buttons.push(props); return props.children },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-native-markdown-display', () => ({ default: () => null }));
vi.mock('@/components/editor/MarkdownToolbar', () => ({ default: () => null }));
vi.mock('@/lib/api-client', () => ({ mindosClient: { baseUrl: 'http://fixture', rootId: 'root', getConnectInfo: async () => ({ rootId: 'root' }), saveFile: mocks.save } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async (k: string) => mocks.storage.get(k) ?? null, setItem: async (k: string, v: string) => { mocks.storage.set(k, v) }, removeItem: async (k: string) => { mocks.storage.delete(k) } } }));
import MarkdownEditor from '@/components/editor/MarkdownEditor';
let root: Root;
const onSaved = vi.fn();
beforeEach(async () => {
  mocks.save.mockReset(); mocks.storage.clear(); mocks.buttons = []; onSaved.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.innerHTML = '<div id="root"></div>'; root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(React.createElement(MarkdownEditor, { filePath: 'note.md', initialContent: 'original', initialMtime: 1, onSaved })));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() });
function saveButton() { return mocks.buttons.findLast(p => p.disabled === false && p.onPress?.constructor.name === 'AsyncFunction') }
it('keeps edits made during a slow save and uses the new version for the next save', async () => {
  let finish!: (r: any) => void;
  mocks.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ ok: true, mtime: 3 });
  await act(async () => mocks.input.onChangeText('first edit'));
  let saving!: Promise<void>;
  await act(async () => { saving = saveButton().onPress() });
  await act(async () => mocks.input.onChangeText('first edit plus later typing'));
  await act(async () => { finish({ ok: true, mtime: 2 }); await saving });
  expect(onSaved).not.toHaveBeenCalled();
  expect(mocks.input.value).toBe('first edit plus later typing');
  await act(async () => saveButton().onPress());
  expect(mocks.save.mock.calls[1].slice(0, 3)).toEqual(['note.md', 'first edit plus later typing', 2]);
  expect(onSaved).toHaveBeenCalledTimes(1);
});
it('keeps a failed save editable and allows retry without losing text', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, mtime: 2 });
  await act(async () => mocks.input.onChangeText('precious draft'));
  await act(async () => saveButton().onPress());
  expect(onSaved).not.toHaveBeenCalled(); expect(mocks.input.value).toBe('precious draft');
  await act(async () => saveButton().onPress()); expect(onSaved).toHaveBeenCalledTimes(1);
});
