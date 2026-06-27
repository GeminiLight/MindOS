import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Vault } from '@/lib/obsidian-compat/shims/vault';

let mindRoot: string;
let vault: Vault;

function arrayBufferFrom(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function textFromArrayBuffer(value: ArrayBuffer): string {
  return new TextDecoder().decode(value);
}

describe('Vault', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-vault-'));
    vault = new Vault(mindRoot);
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('creates, reads, modifies, appends and deletes a file', async () => {
    const created = await vault.create('notes/today.md', 'hello');
    expect(created.path).toBe('notes/today.md');
    expect(await vault.read(created)).toBe('hello');

    await vault.modify(created, 'updated');
    expect(await vault.read(created)).toBe('updated');

    await vault.append(created, ' world');
    expect(await vault.read(created)).toBe('updated world');

    await expect(vault.process(created, (data) => data.replace('updated', 'processed'))).resolves.toBe('processed world');
    expect(await vault.read(created)).toBe('processed world');

    await vault.delete(created);
    expect(vault.getFileByPath('notes/today.md')).toBeNull();
  });

  it('exposes a DataAdapter for direct vault file operations', async () => {
    const onCreate = vi.fn();
    const onModify = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    vault.on('create', onCreate);
    vault.on('modify', onModify);
    vault.on('rename', onRename);
    vault.on('delete', onDelete);

    expect(vault.adapter.getName()).toBe(path.basename(mindRoot));
    await vault.adapter.mkdir('notes');
    await vault.adapter.write('notes/direct.md', 'hello');

    expect(await vault.adapter.exists('notes/direct.md')).toBe(true);
    expect(await vault.adapter.read('notes/direct.md')).toBe('hello');
    expect(vault.getFileByPath('notes/direct.md')?.path).toBe('notes/direct.md');
    expect(await vault.adapter.stat('notes/direct.md')).toMatchObject({
      type: 'file',
      size: 5,
    });
    expect(await vault.adapter.list('notes')).toEqual({
      files: ['notes/direct.md'],
      folders: [],
    });

    await vault.adapter.append('notes/direct.md', ' world');
    await expect(vault.adapter.process('notes/direct.md', (data) => data.toUpperCase())).resolves.toBe('HELLO WORLD');
    expect(await vault.adapter.read('notes/direct.md')).toBe('HELLO WORLD');

    await vault.adapter.rename('notes/direct.md', 'notes/renamed.md');
    expect(await vault.adapter.exists('notes/direct.md')).toBe(false);
    expect(await vault.adapter.read('notes/renamed.md')).toBe('HELLO WORLD');

    await vault.adapter.copy('notes/renamed.md', 'notes/copied.md');
    expect(await vault.adapter.read('notes/copied.md')).toBe('HELLO WORLD');

    await vault.adapter.remove('notes/copied.md');
    expect(await vault.adapter.exists('notes/copied.md')).toBe(false);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/direct.md' }));
    expect(onModify).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/direct.md' }));
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/renamed.md' }), 'notes/direct.md');
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/copied.md' }));
  });

  it('supports binary reads and writes through Vault and DataAdapter', async () => {
    const created = await vault.createBinary('assets/blob.bin', arrayBufferFrom('binary'));
    expect(textFromArrayBuffer(await vault.readBinary(created))).toBe('binary');

    await vault.modifyBinary(created, arrayBufferFrom('updated'));
    expect(textFromArrayBuffer(await vault.adapter.readBinary('assets/blob.bin'))).toBe('updated');
    await vault.appendBinary(created, arrayBufferFrom('-vault'));
    expect(textFromArrayBuffer(await vault.readBinary(created))).toBe('updated-vault');

    await vault.adapter.writeBinary('assets/adapter.bin', arrayBufferFrom('adapter'));
    await vault.adapter.appendBinary('assets/adapter.bin', arrayBufferFrom('-tail'));
    expect(textFromArrayBuffer(await vault.adapter.readBinary('assets/adapter.bin'))).toBe('adapter-tail');
  });

  it('exposes vault resource paths and top-level trash fallback', async () => {
    const onDelete = vi.fn();
    vault.on('delete', onDelete);
    const file = await vault.create('assets/image.png', 'image');

    expect(vault.getResourcePath(file)).toBe(`mindos-vault:///${encodeURIComponent('assets/image.png')}`);

    await vault.trash(file, true);

    expect(vault.getFileByPath('assets/image.png')).toBeNull();
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ path: 'assets/image.png' }));
  });

  it('reports unsupported system trash without deleting and supports local trash fallback', async () => {
    await vault.adapter.write('notes/trash.md', 'trash me');

    await expect(vault.adapter.trashSystem('notes/trash.md')).resolves.toBe(false);
    expect(await vault.adapter.exists('notes/trash.md')).toBe(true);

    await vault.adapter.trashLocal('notes/trash.md');
    expect(await vault.adapter.exists('notes/trash.md')).toBe(false);
  });

  it('creates folders through Vault and DataAdapter', async () => {
    const folder = await vault.createFolder('projects/current');
    expect(folder.path).toBe('projects/current');
    expect(vault.getFolderByPath('projects/current')?.path).toBe('projects/current');

    await vault.adapter.mkdir('projects/archive');
    expect(vault.getFolderByPath('projects/archive')?.path).toBe('projects/archive');
    expect(await vault.adapter.list('projects')).toEqual({
      files: [],
      folders: ['projects/archive', 'projects/current'],
    });
  });

  it('treats the empty folder path as vault root with recursive public children', async () => {
    await vault.create('2026-06-26.md', 'daily');
    await vault.create('notes/nested.md', 'nested');
    fs.mkdirSync(path.join(mindRoot, '.mindos', 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.mindos', 'plugins', 'private.md'), 'private', 'utf-8');

    const root = vault.getAbstractFileByPath('');
    const paths: string[] = [];

    expect(root).toMatchObject({ path: '', name: '' });
    Vault.recurseChildren(root as ReturnType<Vault['getRoot']>, (file) => {
      paths.push(file.path);
    });

    expect(paths).toEqual(expect.arrayContaining(['2026-06-26.md', 'notes', 'notes/nested.md']));
    expect(paths).not.toContain('.mindos');
    expect(paths).not.toContain('.mindos/plugins/private.md');
  });

  it('renames and copies files', async () => {
    const created = await vault.create('notes/source.md', 'copy me');
    const onRename = vi.fn();
    vault.on('rename', onRename);

    await vault.rename(created, 'notes/renamed.md');
    const renamed = vault.getFileByPath('notes/renamed.md');
    expect(renamed?.path).toBe('notes/renamed.md');
    expect(created.path).toBe('notes/renamed.md');
    expect(created.basename).toBe('renamed');
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/renamed.md' }), 'notes/source.md');

    const copied = await vault.copy(renamed!, 'notes/copied.md');
    expect(copied.path).toBe('notes/copied.md');
    expect(await vault.read(copied)).toBe('copy me');
  });

  it('copies binary files without text transcoding', async () => {
    const binary = new Uint8Array([0, 255, 1, 2, 128, 64]);
    const created = await vault.createBinary('assets/source.bin', binary.buffer.slice(0));

    const copied = await vault.copy(created, 'assets/copied.bin');

    expect(copied.path).toBe('assets/copied.bin');
    expect(Array.from(new Uint8Array(await vault.readBinary(copied)))).toEqual(Array.from(binary));
  });

  it('returns markdown files only from getMarkdownFiles', async () => {
    await vault.create('notes/one.md', 'one');
    await vault.create('notes/two.txt', 'two');

    const markdownFiles = vault.getMarkdownFiles();

    expect(markdownFiles).toHaveLength(1);
    expect(markdownFiles[0]?.path).toBe('notes/one.md');
  });

  it('exposes Obsidian-style vault config without reading private .obsidian files', async () => {
    fs.mkdirSync(path.join(mindRoot, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.obsidian', 'app.json'), '{"cssTheme":"private-theme"}', 'utf-8');

    expect(vault.getConfig('cssTheme')).toBe('');
    expect(vault.getConfig('unknown')).toBeNull();

    vault.setConfig('cssTheme', 'Minimal');
    vault.setConfig('baseFontSize', 18);

    expect(vault.getConfig('cssTheme')).toBe('Minimal');
    expect(vault.getConfig('baseFontSize')).toBe(18);
    expect(fs.readFileSync(path.join(mindRoot, '.obsidian', 'app.json'), 'utf-8')).toBe('{"cssTheme":"private-theme"}');
  });

  it('skips private plugin and Obsidian config files when listing vault files', async () => {
    await vault.create('notes/one.md', 'one');
    fs.mkdirSync(path.join(mindRoot, '.plugins', 'sample-plugin'), { recursive: true });
    fs.mkdirSync(path.join(mindRoot, '.obsidian', 'plugins', 'obsidian-plugin'), { recursive: true });
    fs.mkdirSync(path.join(mindRoot, '.mindos', 'assistants'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.plugins', 'sample-plugin', 'data.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(mindRoot, '.obsidian', 'plugins', 'obsidian-plugin', 'manifest.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(mindRoot, '.obsidian', 'workspace.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(mindRoot, '.mindos', 'assistants', 'profile.json'), '{}', 'utf-8');

    const files = vault.getFiles().map((file) => file.path);

    expect(files).toContain('notes/one.md');
    expect(files).not.toContain(path.join('.plugins', 'sample-plugin', 'data.json'));
    expect(files).not.toContain(path.join('.obsidian', 'plugins', 'obsidian-plugin', 'manifest.json'));
    expect(files).not.toContain(path.join('.obsidian', 'workspace.json'));
    expect(files).not.toContain(path.join('.mindos', 'assistants', 'profile.json'));
  });

  it('blocks direct Vault API access to private system directories', async () => {
    fs.mkdirSync(path.join(mindRoot, '.plugins', 'sample-plugin'), { recursive: true });
    fs.mkdirSync(path.join(mindRoot, '.obsidian'), { recursive: true });
    fs.mkdirSync(path.join(mindRoot, '.mindos'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.plugins', 'sample-plugin', 'data.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(mindRoot, '.obsidian', 'workspace.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(mindRoot, '.mindos', 'state.json'), '{}', 'utf-8');
    await vault.create('notes/public.md', 'public');

    expect(vault.getFileByPath('.plugins/sample-plugin/data.json')).toBeNull();
    expect(await vault.adapter.exists('.plugins/sample-plugin/data.json')).toBe(false);
    await expect(vault.adapter.list('')).resolves.toEqual({
      files: [],
      folders: ['notes'],
    });
    await expect(vault.adapter.read('.obsidian/workspace.json')).rejects.toThrow(/private/i);
    await expect(vault.create('.plugins/sample-plugin/main.js', 'module.exports = {}')).rejects.toThrow(/private/i);
    await expect(vault.adapter.write('.obsidian/workspace.json', '{"unsafe":true}')).rejects.toThrow(/private/i);
    await expect(vault.adapter.rename('notes/public.md', '.plugins/sample-plugin/public.md')).rejects.toThrow(/private/i);
    await expect(vault.adapter.copy('notes/public.md', '.mindos/public.md')).rejects.toThrow(/private/i);
    await expect(vault.adapter.remove('.mindos/state.json')).rejects.toThrow(/private/i);

    expect(fs.readFileSync(path.join(mindRoot, 'notes', 'public.md'), 'utf-8')).toBe('public');
    expect(fs.readFileSync(path.join(mindRoot, '.obsidian', 'workspace.json'), 'utf-8')).toBe('{}');
    expect(fs.existsSync(path.join(mindRoot, '.mindos', 'state.json'))).toBe(true);
  });

  it('does not expose files through symlinks that point outside the vault', () => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-outside-'));
    try {
      fs.writeFileSync(path.join(outsideRoot, 'secret.md'), 'outside', 'utf-8');
      fs.symlinkSync(outsideRoot, path.join(mindRoot, 'linked-outside'), 'dir');

      const files = vault.getFiles().map((file) => file.path);

      expect(files).not.toContain('linked-outside/secret.md');
      expect(vault.getFileByPath('linked-outside/secret.md')).toBeNull();
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('emits create and modify events', async () => {
    const onCreate = vi.fn();
    const onModify = vi.fn();

    vault.on('create', onCreate);
    vault.on('modify', onModify);

    const created = await vault.create('notes/events.md', 'hello');
    await vault.modify(created, 'updated');

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onModify).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]?.[0]?.path).toBe('notes/events.md');
  });

  it('blocks path traversal when creating files outside mindRoot', async () => {
    await expect(vault.create('../escaped.md', 'nope')).rejects.toThrow();
  });

  it('blocks path traversal when reading files outside mindRoot', () => {
    const escapedPath = path.join(mindRoot, '..', 'escaped.md');
    fs.writeFileSync(escapedPath, 'secret', 'utf-8');

    expect(vault.getFileByPath('../escaped.md')).toBeNull();
  });

  it('blocks adapter writes through symlinked parents outside mindRoot', async () => {
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-obsidian-outside-write-'));
    try {
      fs.symlinkSync(outsideRoot, path.join(mindRoot, 'linked-outside'), 'dir');

      await expect(vault.adapter.write('linked-outside/secret.md', 'nope')).rejects.toThrow(/outside vault/i);
      expect(fs.existsSync(path.join(outsideRoot, 'secret.md'))).toBe(false);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
