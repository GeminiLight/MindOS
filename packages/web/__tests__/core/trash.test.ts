import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import {
  moveToTrash,
  permanentlyDelete,
  restoreAsCopy,
  restoreFromTrash,
  type TrashMeta,
} from '@/lib/core/trash';

function metaPath(mindRoot: string, id: string): string {
  return path.join(path.dirname(mindRoot), '.trash-meta', `${id}.json`);
}

describe('trash', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
    fs.rmSync(path.join(path.dirname(mindRoot), '.trash'), { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(mindRoot), '.trash-meta'), { recursive: true, force: true });
  });

  it('moves files to sibling trash with recoverable metadata', () => {
    seedFile(mindRoot, 'note.md', 'hello');

    const meta = moveToTrash(mindRoot, 'note.md');

    expect(fs.existsSync(path.join(mindRoot, 'note.md'))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(mindRoot), '.trash', meta.id))).toBe(true);
    expect(JSON.parse(fs.readFileSync(metaPath(mindRoot, meta.id), 'utf-8'))).toMatchObject({
      originalPath: 'note.md',
      fileName: 'note.md',
    });
  });

  it('does not move files through symlinks that resolve outside mindRoot', () => {
    const outsideRoot = fs.mkdtempSync(path.join(path.dirname(mindRoot), 'mindos-trash-outside-'));
    try {
      fs.writeFileSync(path.join(outsideRoot, 'secret.md'), 'outside', 'utf-8');
      fs.symlinkSync(outsideRoot, path.join(mindRoot, 'linked-outside'), 'dir');

      expect(() => moveToTrash(mindRoot, 'linked-outside/secret.md')).toThrow('Access denied');
      expect(fs.readFileSync(path.join(outsideRoot, 'secret.md'), 'utf-8')).toBe('outside');
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not move files into a symlinked trash directory outside the root parent', () => {
    const outsideRoot = fs.mkdtempSync(path.join(path.dirname(mindRoot), 'mindos-trash-target-outside-'));
    const trashPath = path.join(path.dirname(mindRoot), '.trash');
    try {
      seedFile(mindRoot, 'note.md', 'hello');
      fs.symlinkSync(outsideRoot, trashPath, 'dir');

      expect(() => moveToTrash(mindRoot, 'note.md')).toThrow('Access denied');
      expect(fs.existsSync(path.join(mindRoot, 'note.md'))).toBe(true);
      expect(fs.readdirSync(outsideRoot)).toEqual([]);
    } finally {
      try { fs.rmSync(trashPath, { recursive: true, force: true }); } catch {}
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not restore trash items through symlinked original parents outside mindRoot', () => {
    seedFile(mindRoot, 'safe.md', 'hello');
    const meta = moveToTrash(mindRoot, 'safe.md');
    const outsideRoot = fs.mkdtempSync(path.join(path.dirname(mindRoot), 'mindos-trash-restore-outside-'));
    try {
      fs.symlinkSync(outsideRoot, path.join(mindRoot, 'linked-outside'), 'dir');
      const edited: TrashMeta = {
        ...meta,
        originalPath: 'linked-outside/restored.md',
      };
      fs.writeFileSync(metaPath(mindRoot, meta.id), JSON.stringify(edited, null, 2), 'utf-8');

      expect(() => restoreFromTrash(mindRoot, meta.id, true)).toThrow('Access denied');
      expect(fs.existsSync(path.join(outsideRoot, 'restored.md'))).toBe(false);
      expect(fs.existsSync(path.join(path.dirname(mindRoot), '.trash', meta.id))).toBe(true);
    } finally {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('restores copies with POSIX relative paths in nested directories', () => {
    seedFile(mindRoot, 'Folder/note.md', 'hello');
    const meta = moveToTrash(mindRoot, 'Folder/note.md');
    seedFile(mindRoot, 'Folder/note (copy).md', 'existing');

    const result = restoreAsCopy(mindRoot, meta.id);

    expect(result.restoredPath).toBe('Folder/note (copy 2).md');
    expect(fs.existsSync(path.join(mindRoot, 'Folder', 'note (copy 2).md'))).toBe(true);
  });

  it('rejects trash ids with path separators', () => {
    expect(() => permanentlyDelete(mindRoot, '../outside')).toThrow('Invalid trash id');
    expect(() => restoreFromTrash(mindRoot, 'nested/id')).toThrow('Invalid trash id');
  });
});
