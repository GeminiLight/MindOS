import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindObsidianWindowOwner } from './obsidian-window-owner';
import { prepareNativeObsidianPluginSession } from './obsidian-native-session';

const native = vi.hoisted(() => ({ showMessageBox: vi.fn(), getLocale: vi.fn(() => 'zh-CN') }));
vi.mock('electron', () => ({ dialog: { showMessageBox: native.showMessageBox }, app: { getLocale: native.getLocale } }));
const baseUrl = 'http://127.0.0.1:4567';
const subject = Object.freeze({
  pluginId: 'tables', pluginName: 'Tables', pluginVersion: '1.0.0', filePath: 'Notes/中文.md',
  vaultId: 'b'.repeat(64), fingerprint: 'a'.repeat(64), revision: 'c'.repeat(64),
  capabilities: Object.freeze(['document:read', 'document:write'] as const),
});
function owner() {
  let url = `${baseUrl}/view/Notes/test.md`;
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, getURL: () => url, mainFrame: { url } });
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: contents });
  return { window: window as unknown as BrowserWindow, events: window, contents, setUrl(value: string) { url = value; } };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('native Obsidian approval owner', () => {
  it('offers an unchecked read-only Vault grant and requires both allow and the checkbox', async () => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    const offered = { ...subject, optionalCapabilities: ['vault:read'] as const };
    native.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: true });
    expect(await binding.approve(offered)).toBe('read-vault');
    expect(native.showMessageBox.mock.calls[0][1]).toMatchObject({ checkboxChecked: false, checkboxLabel: expect.stringContaining('只读') });
    expect(await binding.approve(subject)).toBe(true);
    native.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true });
    expect(await binding.approve(offered)).toBe(false); binding.dispose();
  });

  it('shows the exact subject in a parented, cancellable native dialog with cancel as default', async () => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    native.showMessageBox.mockResolvedValue({ response: 1 });
    expect(await binding.approve(subject)).toBe(true);
    const [parent, options] = native.showMessageBox.mock.calls[0];
    expect(parent).toBe(fixture.window);
    expect(options).toMatchObject({ defaultId: 0, cancelId: 0, signal: binding.signal });
    expect(options.detail).toContain('明文');
    for (const value of [subject.pluginId, subject.pluginVersion, subject.filePath, subject.fingerprint, subject.vaultId]) expect(options.detail).toContain(value);
    binding.dispose();
    expect(fixture.contents.listenerCount('did-start-navigation')).toBe(0);
    expect(fixture.events.listenerCount('closed')).toBe(0);
  });

  it.each([0, 2, -1])('does not grant authority for native response %s', async response => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    native.showMessageBox.mockResolvedValue({ response });
    expect(await binding.approve(subject)).toBe(false); binding.dispose();
  });

  it.each(['closed', 'destroyed', 'render-process-gone'])('revokes on %s and ignores late approval', async event => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    let answer!: (result: { response: number }) => void;
    native.showMessageBox.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const approval = binding.approve(subject);
    (event === 'closed' ? fixture.events : fixture.contents).emit(event);
    expect(binding.signal.aborted).toBe(true);
    answer({ response: 1 });
    await expect(approval).rejects.toThrow(/closed|authorization/i);
    expect(binding.isCurrent()).toBe(false);
  });

  it('ignores subframe navigation but revokes on main-frame reload, even to the same URL', () => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    fixture.contents.emit('did-start-navigation', {}, 'about:blank', false, false);
    expect(binding.isCurrent()).toBe(true);
    fixture.contents.emit('did-start-navigation', {}, fixture.contents.getURL(), false, true);
    expect(binding.signal.aborted).toBe(true);
  });

  it('supports the structured Electron navigation event as well as legacy arguments', () => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    fixture.contents.emit('did-start-navigation', { isMainFrame: true });
    expect(binding.signal.aborted).toBe(true);
  });

  it('detects a mode change while the owner is idle and cannot revive when local mode returns', async () => {
    vi.useFakeTimers(); let current = true;
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => current });
    current = false; await vi.advanceTimersByTimeAsync(250);
    expect(binding.signal.aborted).toBe(true);
    current = true; expect(binding.isCurrent()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when the identity callback throws', () => {
    const fixture = owner(); let fail = false;
    const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => { if (fail) throw new Error('unavailable'); return true; } });
    fail = true; expect(binding.isCurrent()).toBe(false); expect(binding.signal.aborted).toBe(true);
  });

  it('rejects an owner from another origin before registering listeners or asking approval', () => {
    const fixture = owner(); fixture.setUrl('https://remote.example');
    expect(() => bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true })).toThrow(/local|authorization/i);
    expect(fixture.contents.eventNames()).toEqual([]); expect(native.showMessageBox).not.toHaveBeenCalled();
  });

  it('does not replace the captured owner predicate if the caller changes its options', () => {
    const fixture = owner(); let current = true;
    const options = { window: fixture.window, baseUrl, isCurrent: () => current };
    const binding = bindObsidianWindowOwner(options); current = false; options.isCurrent = () => true;
    expect(binding.isCurrent()).toBe(false);
  });

  it('a native locale failure does not permanently lock the approval dialog', async () => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    native.getLocale.mockImplementationOnce(() => { throw new Error('Locale unavailable'); });
    await expect(binding.approve(subject)).rejects.toThrow('Locale unavailable');
    native.showMessageBox.mockResolvedValue({ response: 1 });
    expect(await binding.approve(subject)).toBe(true); binding.dispose();
  });

  it('does not queue a second native dialog while this owner is awaiting a decision', async () => {
    const fixture = owner(); const binding = bindObsidianWindowOwner({ window: fixture.window, baseUrl, isCurrent: () => true });
    let answer!: (result: { response: number }) => void;
    native.showMessageBox.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const first = binding.approve(subject);
    await expect(binding.approve(subject)).rejects.toThrow(/already pending/i);
    expect(native.showMessageBox).toHaveBeenCalledTimes(1);
    answer({ response: 0 }); expect(await first).toBe(false); binding.dispose();
  });
});

function packageWire() {
  const manifest = { id: 'tables', name: 'Tables', version: '1.0.0' };
  const files = Object.entries({ 'main.js': 'never executed', 'manifest.json': JSON.stringify(manifest) }).map(([path, text]) => ({
    path, size: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), base64: Buffer.from(text).toString('base64'),
  }));
  const assets = files.map(({ base64: _, ...asset }) => asset);
  const fingerprint = createHash('sha256').update(JSON.stringify(['mindos-plugin-package-v1', assets.map(({ path, size, sha256 }) => [path, size, sha256])])).digest('hex');
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    requests.push(String(input));
    const url = new URL(String(input));
    const body = url.pathname === '/api/file' ? { content: 'original', revision: subject.revision, vaultId: subject.vaultId }
      : { manifest, assets, fingerprint, vaultId: subject.vaultId, totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        ...(url.searchParams.has('fingerprint') ? { files } : {}),
      };
    return new Response(JSON.stringify(body));
  };
  return { fetchImpl, requests };
}

describe('native approval and package coordinator integration', () => {
  it('returns a native-approved package session whose close releases the owner lifecycle', async () => {
    const fixture = owner(); const wire = packageWire(); native.showMessageBox.mockResolvedValue({ response: 1 });
    const session = (await prepareNativeObsidianPluginSession({
      window: fixture.window, baseUrl, token: 'fixture-only', pluginId: 'tables', filePath: 'Note.md', isCurrent: () => true, ...wire,
    }))!;
    expect(wire.requests).toHaveLength(3);
    expect(session.binding.pluginId).toBe('tables'); session.setDraft('recover me'); session.close();
    expect(session.snapshot).toMatchObject({ status: 'closed', content: 'recover me' });
    expect(fixture.contents.eventNames()).toEqual([]);
  });

  it('cleans up the native owner when consent is denied', async () => {
    const fixture = owner(); const wire = packageWire(); native.showMessageBox.mockResolvedValue({ response: 0 });
    expect(await prepareNativeObsidianPluginSession({
      window: fixture.window, baseUrl, token: 'fixture-only', pluginId: 'tables', filePath: 'Note.md', isCurrent: () => true, ...wire,
    })).toBeNull();
    expect(wire.requests).toHaveLength(2); expect(fixture.contents.eventNames()).toEqual([]);
  });

  it('cleans up the native owner after a pre-approval network failure', async () => {
    const fixture = owner();
    await expect(prepareNativeObsidianPluginSession({
      window: fixture.window, baseUrl, token: 'fixture-only', pluginId: 'tables', filePath: 'Note.md', isCurrent: () => true,
      fetchImpl: async () => { throw new Error('Disconnected'); },
    })).rejects.toThrow('Disconnected');
    expect(fixture.contents.eventNames()).toEqual([]); expect(native.showMessageBox).not.toHaveBeenCalled();
  });

  it('window destruction closes the returned document and retains its draft', async () => {
    const fixture = owner(); const wire = packageWire(); native.showMessageBox.mockResolvedValue({ response: 1 });
    const session = (await prepareNativeObsidianPluginSession({
      window: fixture.window, baseUrl, token: 'fixture-only', pluginId: 'tables', filePath: 'Note.md', isCurrent: () => true, ...wire,
    }))!;
    session.setDraft('recover me'); fixture.events.emit('closed');
    expect(session.snapshot).toMatchObject({ status: 'closed', content: 'recover me' });
    await expect(session.save()).rejects.toThrow(/closed/i);
  });

  it('cleans up native ownership when the package download fails after consent', async () => {
    const fixture = owner(); const wire = packageWire(); native.showMessageBox.mockResolvedValue({ response: 1 });
    await expect(prepareNativeObsidianPluginSession({
      window: fixture.window, baseUrl, token: 'fixture-only', pluginId: 'tables', filePath: 'Note.md', isCurrent: () => true,
      fetchImpl: async (input, init) => String(input).includes('fingerprint=')
        ? new Response(JSON.stringify({ error: 'package_changed' }), { status: 409 }) : wire.fetchImpl(input, init),
    })).rejects.toThrow(/package_changed/);
    expect(fixture.contents.eventNames()).toEqual([]);
    expect(native.showMessageBox.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
