import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile, readSeeded } from './helpers';
import {
  readFile,
  writeFile,
  createFile,
  deleteFile,
  renameFile,
  renameSpaceDirectory,
} from '@/lib/core/fs-ops';
import fs from 'fs';
import path from 'path';

describe('fs-ops', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  describe('readFile', () => {
    it('reads an existing file', () => {
      seedFile(mindRoot, 'test.md', 'hello world');
      expect(readFile(mindRoot, 'test.md')).toBe('hello world');
    });

    it('reads files in subdirectories', () => {
      seedFile(mindRoot, 'sub/dir/file.md', 'nested content');
      expect(readFile(mindRoot, 'sub/dir/file.md')).toBe('nested content');
    });

    it('throws for non-existent files', () => {
      expect(() => readFile(mindRoot, 'nope.md')).toThrow();
    });

    it('throws for path traversal', () => {
      expect(() => readFile(mindRoot, '../../../etc/passwd')).toThrow('Access denied');
    });
  });

  describe('writeFile', () => {
    it('writes to an existing file atomically', () => {
      seedFile(mindRoot, 'test.md', 'old');
      writeFile(mindRoot, 'test.md', 'new content');
      expect(readSeeded(mindRoot, 'test.md')).toBe('new content');
    });

    it('creates parent directories if needed', () => {
      writeFile(mindRoot, 'new/dir/file.md', 'content');
      expect(readSeeded(mindRoot, 'new/dir/file.md')).toBe('content');
    });

    it('no temp file left behind on success', () => {
      seedFile(mindRoot, 'test.md', 'old');
      writeFile(mindRoot, 'test.md', 'new');
      const files = fs.readdirSync(mindRoot);
      expect(files.filter(f => f.startsWith('.tmp-'))).toHaveLength(0);
    });
  });

  describe('createFile', () => {
    it('creates a new file', () => {
      createFile(mindRoot, 'new.md', 'initial');
      expect(readSeeded(mindRoot, 'new.md')).toBe('initial');
    });

    it('creates parent directories', () => {
      createFile(mindRoot, 'a/b/c.md', 'deep');
      expect(readSeeded(mindRoot, 'a/b/c.md')).toBe('deep');
    });

    it('throws if file already exists', () => {
      seedFile(mindRoot, 'exists.md', 'content');
      expect(() => createFile(mindRoot, 'exists.md', 'new')).toThrow('already exists');
    });

    it('defaults to empty content', () => {
      createFile(mindRoot, 'empty.md');
      expect(readSeeded(mindRoot, 'empty.md')).toBe('');
    });
  });

  describe('deleteFile', () => {
    it('deletes an existing file', () => {
      seedFile(mindRoot, 'del.md', 'bye');
      deleteFile(mindRoot, 'del.md');
      expect(fs.existsSync(path.join(mindRoot, 'del.md'))).toBe(false);
    });

    it('throws for non-existent files', () => {
      expect(() => deleteFile(mindRoot, 'nope.md')).toThrow('not found');
    });
  });

  describe('renameFile', () => {
    it('renames a file within same directory', () => {
      seedFile(mindRoot, 'old.md', 'content');
      const newPath = renameFile(mindRoot, 'old.md', 'new.md');
      expect(newPath).toBe('new.md');
      expect(readSeeded(mindRoot, 'new.md')).toBe('content');
      expect(fs.existsSync(path.join(mindRoot, 'old.md'))).toBe(false);
    });

    it('renames in subdirectory', () => {
      seedFile(mindRoot, 'sub/old.md', 'content');
      const newPath = renameFile(mindRoot, 'sub/old.md', 'renamed.md');
      expect(newPath).toBe(path.join('sub', 'renamed.md'));
    });

    it('throws if new name has path separators', () => {
      seedFile(mindRoot, 'file.md', 'x');
      expect(() => renameFile(mindRoot, 'file.md', 'sub/file.md')).toThrow('path separators');
    });

    it('throws if target name already exists', () => {
      seedFile(mindRoot, 'a.md', 'a');
      seedFile(mindRoot, 'b.md', 'b');
      expect(() => renameFile(mindRoot, 'a.md', 'b.md')).toThrow('already exists');
    });
  });

  describe('renameSpaceDirectory', () => {
    it('renames a top-level space directory', () => {
      fs.mkdirSync(path.join(mindRoot, 'SpaceA'), { recursive: true });
      seedFile(mindRoot, 'SpaceA/README.md', '# A');
      const newPath = renameSpaceDirectory(mindRoot, 'SpaceA', 'SpaceB');
      expect(path.normalize(newPath)).toBe(path.normalize('SpaceB'));
      expect(fs.existsSync(path.join(mindRoot, 'SpaceB', 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(mindRoot, 'SpaceA'))).toBe(false);
    });

    it('renames nested space under parent', () => {
      fs.mkdirSync(path.join(mindRoot, 'Parent', 'Child'), { recursive: true });
      seedFile(mindRoot, 'Parent/Child/README.md', '# c');
      const newPath = renameSpaceDirectory(mindRoot, 'Parent/Child', 'Kid');
      expect(path.normalize(newPath)).toBe(path.normalize(path.join('Parent', 'Kid')));
      expect(fs.existsSync(path.join(mindRoot, 'Parent', 'Kid', 'README.md'))).toBe(true);
    });

    it('throws if path is not a directory', () => {
      seedFile(mindRoot, 'only-file.md', 'x');
      expect(() => renameSpaceDirectory(mindRoot, 'only-file.md', 'Dir')).toThrow('Not a directory');
    });

    it('throws if new_name contains path separators', () => {
      fs.mkdirSync(path.join(mindRoot, 'S'), { recursive: true });
      seedFile(mindRoot, 'S/README.md', 'x');
      expect(() => renameSpaceDirectory(mindRoot, 'S', 'a/b')).toThrow('path separators');
    });

    it('throws if target directory already exists', () => {
      fs.mkdirSync(path.join(mindRoot, 'A'), { recursive: true });
      fs.mkdirSync(path.join(mindRoot, 'B'), { recursive: true });
      seedFile(mindRoot, 'A/README.md', 'x');
      seedFile(mindRoot, 'B/README.md', 'y');
      expect(() => renameSpaceDirectory(mindRoot, 'A', 'B')).toThrow('already exists');
    });

    it('throws for empty space path', () => {
      expect(() => renameSpaceDirectory(mindRoot, '', 'X')).toThrow('Space path');
    });
  });
});
