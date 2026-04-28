import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Vault } from '@/lib/obsidian-compat/shims/vault';

let mindRoot: string;
let vault: Vault;

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

    await vault.delete(created);
    expect(vault.getFileByPath('notes/today.md')).toBeNull();
  });

  it('renames and copies files', async () => {
    const created = await vault.create('notes/source.md', 'copy me');

    await vault.rename(created, 'notes/renamed.md');
    const renamed = vault.getFileByPath('notes/renamed.md');
    expect(renamed?.path).toBe('notes/renamed.md');

    const copied = await vault.copy(renamed!, 'notes/copied.md');
    expect(copied.path).toBe('notes/copied.md');
    expect(await vault.read(copied)).toBe('copy me');
  });

  it('returns markdown files only from getMarkdownFiles', async () => {
    await vault.create('notes/one.md', 'one');
    await vault.create('notes/two.txt', 'two');

    const markdownFiles = vault.getMarkdownFiles();

    expect(markdownFiles).toHaveLength(1);
    expect(markdownFiles[0]?.path).toBe('notes/one.md');
  });

  it('skips plugin private files under .plugins when listing vault files', async () => {
    await vault.create('notes/one.md', 'one');
    fs.mkdirSync(path.join(mindRoot, '.plugins', 'sample-plugin'), { recursive: true });
    fs.writeFileSync(path.join(mindRoot, '.plugins', 'sample-plugin', 'data.json'), '{}', 'utf-8');

    const files = vault.getFiles().map((file) => file.path);

    expect(files).toContain('notes/one.md');
    expect(files).not.toContain(path.join('.plugins', 'sample-plugin', 'data.json'));
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
});
