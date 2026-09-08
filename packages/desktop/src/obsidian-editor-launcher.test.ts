import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createObsidianEditorLauncher } from './obsidian-editor-launcher';
import { openObsidianDraftStore } from './obsidian-draft-store';

const calls = vi.hoisted(() => ({ prepare: vi.fn(), open: vi.fn(), dialog: vi.fn(), folder: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showMessageBox: calls.dialog }, shell: { openPath: calls.folder } }));
vi.mock('./obsidian-native-session', () => ({ prepareNativeObsidianPluginSession: calls.prepare }));
vi.mock('./obsidian-editor-window', () => ({ createObsidianEditorWindow: calls.open }));
let directory: string;
beforeEach(() => {
  vi.resetAllMocks(); directory = mkdtempSync(join(tmpdir(), 'obsidian-launcher-'));
  writeFileSync(join(directory, 'runtime.js'), 'fixture');
  calls.prepare.mockResolvedValue(null);
  calls.open.mockResolvedValue({ window: Object.assign(new EventEmitter(), { isDestroyed: () => false }) });
  calls.dialog.mockResolvedValue({ response: 0 }); calls.folder.mockResolvedValue('');
});
afterEach(() => { vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const frame = { url: 'http://localhost:3456/file/Tables.md' };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  let current = true;
  const context = { window, baseUrl: 'http://localhost:3456', token: 'main-only-token', isCurrent: () => current };
  const launcher = createObsidianEditorLauncher(() => context as any, directory, join(directory, 'drafts'));
  return { launcher, event: { sender: contents, senderFrame: frame } as any, context, revoke: () => { current = false; } };
}
const request = { pluginId: 'table-editor-obsidian', filePath: 'Tables.md' };
function sessionFixture() {
  let content = 'disk';
  return { binding: { ...request, vaultId: 'a'.repeat(64), fingerprint: 'b'.repeat(64) }, package: {},
    get snapshot() { return { filePath: request.filePath, content, dirty: content !== 'disk', revision: 'c'.repeat(64), status: 'ready' }; },
    setDraft: (value: string) => { content = value; }, save: vi.fn(async () => {}), close: vi.fn() };
}

it('does not create an editor when native approval is cancelled', async () => {
  const f = fixture(); expect(await f.launcher.open(f.event, request)).toEqual({ opened: false });
  expect(calls.open).not.toHaveBeenCalled();
  expect(calls.prepare.mock.calls[0][0]).toMatchObject({ token: 'main-only-token', ...request });
});
it('rejects subframes and non-owner callers before reading a package or asking for approval', async () => {
  const f = fixture();
  await expect(f.launcher.open({ ...f.event, senderFrame: { ...f.event.senderFrame } }, request)).rejects.toThrow('main window');
  await expect(f.launcher.open({ ...f.event, sender: {} }, request)).rejects.toThrow('main window');
  f.revoke(); await expect(f.launcher.open(f.event, request)).rejects.toThrow('main window');
  expect(calls.prepare).not.toHaveBeenCalled();
});
it.each([null, {}, { ...request, filePath: '../Private.md' }, { ...request, filePath: '' },
  { ...request, pluginId: 'a/b' }, { ...request, token: 'renderer-supplied' }])('rejects invalid requests and extra authority fields: %j', async value => {
  const f = fixture(); await expect(f.launcher.open(f.event, value)).rejects.toThrow('Invalid');
  expect(calls.prepare).not.toHaveBeenCalled();
});
it('rejects concurrent launches while a native approval is pending', async () => {
  const f = fixture(); let cancel!: (value: null) => void;
  calls.prepare.mockImplementationOnce(() => new Promise(resolve => { cancel = resolve; }));
  const pending = f.launcher.open(f.event, request);
  await expect(f.launcher.open(f.event, request)).rejects.toThrow('already');
  cancel(null); await pending;
  expect(await f.launcher.open(f.event, request)).toEqual({ opened: false });
});
it('closes the approved session if artifact loading or window creation fails', async () => {
  const f = fixture(); const session = sessionFixture(); calls.prepare.mockResolvedValue(session);
  calls.open.mockRejectedValueOnce(new Error('Window failed'));
  await expect(f.launcher.open(f.event, request)).rejects.toThrow('Window failed');
  expect(session.close).toHaveBeenCalled();
  rmSync(join(directory, 'runtime.js'));
  await expect(f.launcher.open(f.event, request)).rejects.toThrow();
  expect(session.close).toHaveBeenCalledTimes(2);
});
it('keeps a single active editor and allows another launch after it closes', async () => {
  const f = fixture(); const window = Object.assign(new EventEmitter(), { isDestroyed: () => false });
  const session = sessionFixture(); calls.prepare.mockResolvedValue(session); calls.open.mockResolvedValue({ window });
  expect(await f.launcher.open(f.event, request)).toEqual({ opened: true });
  await expect(f.launcher.open(f.event, request)).rejects.toThrow('already');
  window.emit('closed'); calls.prepare.mockResolvedValueOnce(null);
  expect(await f.launcher.open(f.event, request)).toEqual({ opened: false });
});

it('requests separate recovery consent and restores a matching backup only after approval', async () => {
  const f = fixture(); const session = sessionFixture(); calls.prepare.mockResolvedValue(session);
  const store = await openObsidianDraftStore(join(directory, 'drafts')); const old = store.create(session.binding);
  old.update({ ...session.snapshot, content: 'recovered', dirty: true }); await old.flush();
  expect(await f.launcher.open(f.event, request)).toEqual({ opened: false });
  expect(calls.open).not.toHaveBeenCalled(); expect(await store.list(session.binding)).toHaveLength(1);
  calls.dialog.mockResolvedValue({ response: 1 });
  calls.open.mockResolvedValue({ window: Object.assign(new EventEmitter(), { isDestroyed: () => false }) });
  await f.launcher.open(f.event, request); await f.launcher.flush();
  expect(calls.open.mock.calls[0][0].session.snapshot.content).toBe('recovered');
  expect(calls.dialog.mock.calls[1][1].buttons).toEqual(['取消', '恢复草稿', '查看备份文件']);
  expect(session.save).not.toHaveBeenCalled();
});

it('never restores stale backups and opens only the main-owned recovery folder on request', async () => {
  const f = fixture(); const session = sessionFixture(); calls.prepare.mockResolvedValue(session);
  const store = await openObsidianDraftStore(join(directory, 'drafts')); const old = store.create(session.binding);
  old.update({ ...session.snapshot, revision: 'd'.repeat(64), content: 'stale', dirty: true }); await old.flush();
  calls.dialog.mockResolvedValue({ response: 1 });
  expect(await f.launcher.open(f.event, request)).toEqual({ opened: false });
  expect(calls.dialog.mock.calls[0][1].buttons).toEqual(['取消', '查看备份文件']);
  expect(calls.folder).toHaveBeenCalledWith(join(directory, 'drafts'));
  expect(calls.open).not.toHaveBeenCalled(); expect(session.snapshot.content).toBe('disk');
});

it('revokes a pending recovery dialog on owner change and keeps its backup untouched', async () => {
  const f = fixture(); const session = sessionFixture(); calls.prepare.mockResolvedValue(session);
  const store = await openObsidianDraftStore(join(directory, 'drafts')); const old = store.create(session.binding);
  old.update({ ...session.snapshot, content: 'keep this', dirty: true }); await old.flush();
  let entered!: () => void; const shown = new Promise<void>(resolve => { entered = resolve; });
  calls.dialog.mockImplementation(() => { entered(); return new Promise(() => {}); });
  vi.useFakeTimers(); const opening = f.launcher.open(f.event, request);
  const rejection = expect(opening).rejects.toThrow(/owner closed/i);
  await shown; f.revoke(); await vi.advanceTimersByTimeAsync(250); await rejection;
  expect(calls.open).not.toHaveBeenCalled(); expect(session.close).toHaveBeenCalled();
  expect(await store.list(session.binding)).toHaveLength(1);
});
