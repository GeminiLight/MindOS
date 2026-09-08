import { expect, it, vi } from 'vitest';
import * as hostModule from '@/lib/obsidian-compat/browser-host/plugin-host';

const bytes = (text: string) => new TextEncoder().encode(text);
const file = (path: string, content = 'hello', mtime = 2) => ({ path, data: bytes(content), stat: { ctime: 1, mtime, size: bytes(content).length } });
const snapshot = (sequence = 0, files = [file('Notes/中文.md'), file('Notes/data.csv', 'a,b\n1,2')]) => ({
  vaultId: 'a'.repeat(64), name: 'Approved vault', sequence, folders: ['Empty'], files,
});
function create(value = snapshot()) {
  expect((hostModule as any).createBrowserVault).toBeTypeOf('function');
  return (hostModule as any).createBrowserVault(value);
}

it('exposes real text and binary files, stable identities and a complete approved folder tree', async () => {
  const input = snapshot(); const { vault, close } = create(input);
  const note = vault.getFileByPath('Notes/中文.md');
  expect(note).toBe(vault.getAbstractFileByPath('Notes/中文.md'));
  expect(note.basename).toBe('中文'); expect(note.extension).toBe('md'); expect(note.vault).toBe(vault);
  expect(note.stat).toEqual({ ctime: 1, mtime: 2, size: 5 });
  expect(vault.getRoot()).toBe(vault.getAbstractFileByPath('/'));
  expect(note.parent).toBe(vault.getFolderByPath('Notes')); expect(note.parent.parent.isRoot()).toBe(true);
  expect(vault.getMarkdownFiles()).toEqual([note]); expect(vault.getFiles()).toHaveLength(2);
  expect(vault.getAllLoadedFiles()).toHaveLength(5);
  expect(await vault.adapter.list('')).toEqual({ files: [], folders: ['Empty', 'Notes'] });
  expect(await vault.adapter.exists('missing')).toBe(false); expect(await vault.adapter.stat('missing')).toBeNull();
  expect(await vault.read(note)).toBe('hello'); expect(await vault.cachedRead(note)).toBe('hello');
  expect(new Uint8Array(await vault.readBinary(note))).toEqual(bytes('hello'));
  input.files[0].data.fill(0); expect(await vault.read(note)).toBe('hello');
  const copy = new Uint8Array(await vault.readBinary(note)); copy.fill(0); expect(await vault.read(note)).toBe('hello');
  expect(vault.getName()).toBe('Approved vault'); close();
});

it('applies the full new snapshot before publishing create, modify, rename and delete events', async () => {
  const { vault, applySnapshot, close } = create(); const old = vault.getFileByPath('Notes/中文.md');
  const csv = vault.getFileByPath('Notes/data.csv'); const events: unknown[] = []; const visibleFiles: string[][] = [];
  for (const name of ['create', 'modify', 'rename', 'delete']) vault.on(name, (item: any, from?: string) => {
    events.push([name, item.path, from]);
    visibleFiles.push(vault.getFiles().map((f: any) => f.path));
  });
  applySnapshot(snapshot(1, [file('Archive/中文.md', 'changed', 3), file('new.md')]), [{ from: 'Notes/中文.md', to: 'Archive/中文.md' }]);
  expect(vault.getFileByPath('Archive/中文.md')).toBe(old); expect(old.parent.path).toBe('Archive');
  expect(await vault.read(old)).toBe('changed'); expect(vault.getFileByPath('Notes/data.csv')).toBeNull();
  await expect(vault.read(csv)).rejects.toThrow(/missing|stale/i);
  expect(events).toContainEqual(['rename', 'Archive/中文.md', 'Notes/中文.md']);
  expect(events).toContainEqual(['modify', 'Archive/中文.md', undefined]);
  expect(events).toContainEqual(['delete', 'Notes/data.csv', undefined]);
  expect(events).toContainEqual(['create', 'new.md', undefined]); close();
  expect(visibleFiles.length).toBeGreaterThan(0);
  expect(visibleFiles.every(paths => JSON.stringify(paths) === JSON.stringify(['Archive/中文.md', 'new.md']))).toBe(true);
});

it('reports file and folder type replacements as delete then create rather than a modification', () => {
  const { vault, applySnapshot, close } = create(snapshot(0, [file('a/child.md')]));
  const oldFolder = vault.getFolderByPath('a'); const events: unknown[] = [];
  for (const name of ['create', 'modify', 'delete']) vault.on(name, (item: any) => events.push([name, item.path]));
  applySnapshot(snapshot(1, [file('a')]));
  expect(events).toEqual([['delete', 'a/child.md'], ['delete', 'a'], ['create', 'a']]);
  expect(vault.getAbstractFileByPath('a')).not.toBe(oldFolder); close();
});

it('rejects sparse data before mutating any retained file or folder references', async () => {
  const { vault, applySnapshot, close } = create(); const original = vault.getFileByPath('Notes/中文.md');
  const sparse = [file('Notes/中文.md', 'wrong'), file('missing.md')]; delete sparse[1];
  expect(() => applySnapshot(snapshot(1, sparse))).toThrow();
  expect(await vault.read(original)).toBe('hello');
  expect(original.parent.children.map((f: any) => f.path)).toEqual(['Notes/data.csv', 'Notes/中文.md']); close();
});

it('does not let an event consumer forge metadata updates without a new broker snapshot', () => {
  const { vault, close } = create(); const changed = vi.fn(); vault.on('modify', changed);
  // Event consumers can emit their own custom Obsidian events, but a lifecycle
  // event must not mutate file bytes or identity by itself.
  vault.trigger('modify', { path: 'Notes/中文.md' });
  expect(vault.getFileByPath('Notes/中文.md').stat.size).toBe(5); close();
});

it('rejects stale, cross-vault or invalid snapshots atomically without publishing misleading events', () => {
  const { vault, applySnapshot, close } = create(); const changed = vi.fn(); vault.on('modify', changed);
  for (const value of [snapshot(0), { ...snapshot(1), vaultId: 'b'.repeat(64) },
    snapshot(1, [file('../escape.md')]), snapshot(1, [file('.mindos/secret.md')]),
    snapshot(1, [file('a.md'), file('a.md')]), snapshot(1, [file('a'), file('a/b.md')]),
    snapshot(1, [{ ...file('a.md'), stat: { ctime: 1, mtime: NaN, size: 5 } }]),
    snapshot(1, [{ ...file('a.md'), stat: { ctime: 1, mtime: 2, size: 99 } }]),
  ]) expect(() => applySnapshot(value)).toThrow();
  expect(vault.getFiles()).toHaveLength(2); expect(changed).not.toHaveBeenCalled(); close();
});

it('rejects inaccessible paths, foreign file objects and writes without an authorized broker', async () => {
  const { vault, close } = create(); const other = create();
  for (const path of ['../x', '/etc/passwd', '.obsidian/config', 'a\\b', 'a//b', 'a/./b']) {
    await expect(vault.adapter.read(path)).rejects.toThrow();
  }
  await expect(vault.read(other.vault.getFileByPath('Notes/中文.md'))).rejects.toThrow(/foreign|stale/i);
  await expect(vault.adapter.write('new.md', 'must not be stored')).rejects.toThrow(/authorized|read.only/i);
  expect(vault.getFileByPath('new.md')).toBeNull(); close(); other.close();
});

it('revokes retained vault references and listeners when its owning runtime closes', async () => {
  const { vault, applySnapshot, close } = create(); const note = vault.getFileByPath('Notes/中文.md'); const event = vi.fn();
  vault.on('modify', event); close(); close();
  await expect(vault.read(note)).rejects.toThrow(/closed/i);
  expect(() => vault.getFiles()).toThrow(/closed/i);
  expect(() => vault.on('modify', event)).toThrow(/closed/i);
  expect(() => applySnapshot(snapshot(1))).toThrow(/closed/i);
  vault.trigger('modify', note); expect(event).not.toHaveBeenCalled();
});

it('preserves arbitrary binary bytes and rejects invalid UTF-8 instead of silently replacing content', async () => {
  const data = new Uint8Array([0, 255, 128, 1]);
  const { vault, close } = create(snapshot(0, [{ path: 'image.bin', data, stat: { ctime: 1, mtime: 2, size: 4 } }]));
  const binary = vault.getFileByPath('image.bin');
  expect(new Uint8Array(await vault.readBinary(binary))).toEqual(data);
  await expect(vault.read(binary)).rejects.toThrow(); close();
});

it('rejects excessive file size, path depth and invalid rename hints before changing the current snapshot', async () => {
  const { vault, applySnapshot, close } = create(); const before = vault.getFileByPath('Notes/中文.md');
  expect(() => applySnapshot(snapshot(1, [file('large.md', 'x'.repeat(2 * 1024 * 1024 + 1))]))).toThrow(/data|statistics|limit/i);
  expect(() => applySnapshot(snapshot(1, [file('a/'.repeat(65) + 'note.md')]))).toThrow(/path/i);
  expect(() => applySnapshot(snapshot(1, [file('new.md')]), [{ from: 'missing.md', to: 'new.md' }])).toThrow(/rename/i);
  expect(await vault.read(before)).toBe('hello'); close();
});

it('observes asynchronous listener failures without breaking other consumers or snapshot installation', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { vault, applySnapshot, close } = create(); const seen: string[] = [];
  try {
    vault.on('modify', async () => { throw new Error('listener failure'); });
    vault.on('modify', (file: any) => seen.push(file.path));
    applySnapshot(snapshot(1, [file('Notes/中文.md', 'new')]));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual(['Notes/中文.md']);
    expect(report).toHaveBeenCalledWith('[obsidian-compat] Vault listener failed:', expect.any(Error));
    expect(await vault.read(vault.getFileByPath('Notes/中文.md'))).toBe('new');
  } finally { close(); report.mockRestore(); }
});
