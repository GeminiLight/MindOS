import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppShim } from '@/lib/obsidian-compat/shims/app';

let mindRoot: string;
let app: AppShim;

describe('FileManagerShim', () => {
  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-file-manager-'));
    app = new AppShim(mindRoot);
  });

  afterEach(() => {
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  it('processes existing YAML frontmatter and triggers metadata updates', async () => {
    const onChanged = vi.fn();
    app.metadataCache.on('changed', onChanged);
    const file = await app.vault.create('notes/today.md', `---\ntitle: Today\ntags:\n  - old\n---\n# Body\n`);

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.title = 'Updated';
      frontmatter.status = 'active';
      frontmatter.tags = ['old', 'new'];
    });

    await expect(app.vault.read(file)).resolves.toBe(`---\ntitle: Updated\ntags:\n  - old\n  - new\nstatus: active\n---\n# Body\n`);
    expect(app.metadataCache.getFileCache(file)?.frontmatter).toEqual({
      title: 'Updated',
      tags: ['old', 'new'],
      status: 'active',
    });
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'notes/today.md' }),
      expect.stringContaining('status: active'),
      expect.objectContaining({
        frontmatter: expect.objectContaining({ status: 'active' }),
      }),
    );
  });

  it('adds frontmatter to files that do not have any', async () => {
    const file = await app.vault.create('plain.md', '# Plain\n');

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.created = '2026-06-14';
    });

    await expect(app.vault.read(file)).resolves.toBe(`---\ncreated: '2026-06-14'\n---\n# Plain\n`);
  });

  it('removes the frontmatter block when the callback deletes every property', async () => {
    const file = await app.vault.create('empty.md', `---\ntitle: Remove me\n---\n\nBody\n`);

    await app.fileManager.processFrontMatter(file, (frontmatter) => {
      delete frontmatter.title;
    });

    await expect(app.vault.read(file)).resolves.toBe('Body\n');
  });

  it('generates markdown links using Obsidian wiki-link syntax', async () => {
    const file = await app.vault.create('notes/Target Note.md', '# Target');

    expect(app.fileManager.generateMarkdownLink(file, 'notes/source.md')).toBe('[[notes/Target Note]]');
    expect(app.fileManager.generateMarkdownLink(file, 'notes/source.md', '#Section', 'Alias')).toBe('[[notes/Target Note#Section|Alias]]');
    expect(app.fileManager.generateMarkdownLink(file, 'notes/source.md', '#Bad|Section', 'A]]B')).toBe('[[notes/Target Note#Bad-Section|AB]]');
  });

  it('resolves the default parent folder for new files from a source path', async () => {
    await app.vault.createFolder('projects/current');

    expect(app.fileManager.getNewFileParent('projects/current/source.md').path).toBe('projects/current');
    expect(app.fileManager.getNewFileParent('missing/source.md').path).toBe('');
    expect(app.fileManager.getNewFileParent('source.md').path).toBe('');
  });

  it('dedupes attachment paths and creates the destination folder', async () => {
    await app.vault.createFolder('notes');
    await app.vault.create('notes/image.png', 'existing');

    await expect(app.fileManager.getAvailablePathForAttachment('image.png', 'notes/source.md')).resolves.toBe('notes/image 1.png');
    await expect(app.fileManager.getAvailablePathForAttachment('diagram.svg', 'drafts/source.md')).resolves.toBe('drafts/diagram.svg');
    expect(app.vault.getFolderByPath('drafts')?.path).toBe('drafts');
  });

  it('returns normalized attachment paths for unsafe filenames and non-canonical source paths', async () => {
    await app.vault.createFolder('notes');
    await app.vault.create('notes/image.png', 'existing');

    await expect(
      app.fileManager.getAvailablePathForAttachment('../assets/../image.png', 'drafts/../notes/source.md'),
    ).resolves.toBe('notes/image 1.png');
    await expect(
      app.fileManager.getAvailablePathForAttachment('..\\..\\diagram.svg', 'notes/../source.md'),
    ).resolves.toBe('diagram.svg');
  });

  it('renames files through the underlying Vault', async () => {
    const file = await app.vault.create('notes/source.md', 'body');

    await app.fileManager.renameFile(file, 'notes/renamed.md');

    expect(file.path).toBe('notes/renamed.md');
    expect(app.vault.getFileByPath('notes/source.md')).toBeNull();
    await expect(app.vault.read(file)).resolves.toBe('body');
  });

  it('confirms and trashes files through the underlying Vault', async () => {
    const file = await app.vault.create('notes/delete-me.md', 'body');

    await expect(app.fileManager.promptForDeletion(file)).resolves.toBe(true);
    await app.fileManager.trashFile(file);

    expect(app.vault.getFileByPath('notes/delete-me.md')).toBeNull();
  });
});
