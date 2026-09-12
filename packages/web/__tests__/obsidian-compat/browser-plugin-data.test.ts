// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { BrowserPluginHost } from '@/lib/obsidian-compat/browser-host/plugin-host';

// This unit suite exercises persistence, while the Electron suite verifies real realm isolation.
vi.mock('@/lib/obsidian-compat/browser-host/realm', () => ({ assertIsolatedPluginRealm: () => {} }));

let host: BrowserPluginHost;
let view: EditorView;
async function setup(adapter: NonNullable<ConstructorParameters<typeof BrowserPluginHost>[0]['dataAdapter']>) {
  view = new EditorView({ state: EditorState.create(), parent: document.body });
  host = new BrowserPluginHost({ editor: view, container: document.body, filePath: 'Note.md', dataAdapter: adapter });
  await host.load({ id: 'example', name: 'Example', version: '1.0.0' }, class extends host.api.Plugin {});
}
afterEach(async () => { await host?.destroy(); view?.destroy(); document.body.replaceChildren(); });

it('loads imported settings once and isolates snapshots from caller mutation', async () => {
  const load = vi.fn(async () => ({ label: '中文 📚', enabled: false }));
  await setup({ load, save: vi.fn(async () => {}) });
  const [first, second] = await Promise.all([host.getPluginData('example'), host.getPluginData('example')]);
  (first as { label: string }).label = 'changed';
  expect(second).toEqual({ label: '中文 📚', enabled: false });
  expect(load).toHaveBeenCalledTimes(1);
});

it('serializes writes and changes its cache only after successful persistence', async () => {
  let rejectSave!: (error: Error) => void;
  const save = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
  await setup({ load: async () => ({ count: 1 }), save });
  await host.getPluginData('example');
  const pending = host.savePluginData('example', { count: 2 });
  const rejected = expect(pending).rejects.toThrow('conflict');
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(await host.getPluginData('example')).toEqual({ count: 1 });
  rejectSave(new Error('conflict'));
  await rejected;
  expect(await host.getPluginData('example')).toEqual({ count: 1 });
  await expect(host.savePluginData('example', 'x'.repeat(1024 * 1024))).rejects.toThrow(/limit/);
});

it('revokes writes that are waiting for the initial data read when the plugin unloads', async () => {
  let resolveRead!: (data: unknown) => void;
  const save = vi.fn(async () => {});
  await setup({ load: () => new Promise(resolve => { resolveRead = resolve; }), save });
  const pending = host.savePluginData('example', {});
  const rejected = expect(pending).rejects.toThrow(/unloaded/);
  await vi.waitFor(() => expect(resolveRead).toBeTypeOf('function'));
  await host.unload('example');
  resolveRead({});
  await rejected;
  expect(save).not.toHaveBeenCalled();
});

it('lets a new instance read fresh data while the revoked instance still has a pending read', async () => {
  let finishOld!: (data: unknown) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValue({ count: 2 });
  await setup({ load, save: vi.fn(async () => {}) });
  const oldRead = host.getPluginData('example');
  const rejected = expect(oldRead).rejects.toThrow(/unloaded/);
  await host.unload('example');
  await host.load({ id: 'example', name: 'Example', version: '1.0.0' }, class extends host.api.Plugin {});
  const newRead = host.getPluginData('example').then(data => ({ data }), error => ({ error }));
  const reads = load.mock.calls.length;
  finishOld({ count: 1 });
  await rejected;
  expect(reads).toBe(2);
  await expect(newRead).resolves.toEqual({ data: { count: 2 } });
  expect(await host.getPluginData('example')).toEqual({ count: 2 });
});
