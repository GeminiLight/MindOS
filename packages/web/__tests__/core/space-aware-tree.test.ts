import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import fs from 'fs';
import path from 'path';

describe('space-aware file tree', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  describe('buildFileTree — isSpace detection', () => {
    it('marks directory with INSTRUCTION.md as isSpace', async () => {
      seedFile(mindRoot, 'Notes/INSTRUCTION.md', '# Notes Instruction\n\n- Rule 1\n- Rule 2');
      seedFile(mindRoot, 'Notes/README.md', '# Notes\n\nDescription of notes.');
      seedFile(mindRoot, 'Notes/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const notes = tree.find(n => n.name === 'Notes');
      expect(notes).toBeDefined();
      expect(notes!.isSpace).toBe(true);
    });

    it('does not mark directory without INSTRUCTION.md as isSpace', async () => {
      seedFile(mindRoot, 'Archive/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const archive = tree.find(n => n.name === 'Archive');
      expect(archive).toBeDefined();
      expect(archive!.isSpace).toBeUndefined();
    });

    it('detects nested spaces (subdirectory with INSTRUCTION.md)', async () => {
      seedFile(mindRoot, 'Projects/INSTRUCTION.md', '# Projects');
      seedFile(mindRoot, 'Projects/sub/INSTRUCTION.md', '# Sub');
      seedFile(mindRoot, 'Projects/sub/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const projects = tree.find(n => n.name === 'Projects');
      expect(projects!.isSpace).toBe(true);
      const sub = projects!.children?.find(n => n.name === 'sub');
      expect(sub!.isSpace).toBe(true);
    });

    it('ignores directories in IGNORED_DIRS (.git, node_modules, etc.)', async () => {
      seedFile(mindRoot, '.git/INSTRUCTION.md', '# Git');
      seedFile(mindRoot, '.git/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const git = tree.find(n => n.name === '.git');
      expect(git).toBeUndefined();
    });
  });

  describe('buildSpacePreview', () => {
    it('extracts body lines from INSTRUCTION.md and README.md', async () => {
      seedFile(mindRoot, 'Notes/INSTRUCTION.md',
        '# Notes Instruction\n\n## Goal\n\n- Define rules.\n- Keep structured.\n- Trace changes.\n\n## Boundary\n\n- Root wins.'
      );
      seedFile(mindRoot, 'Notes/README.md',
        '# Notes\n\nPersonal learning notes.\n\n## Structure\n\nSome structure info.'
      );
      seedFile(mindRoot, 'Notes/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const notes = tree.find(n => n.name === 'Notes');
      expect(notes!.spacePreview).toBeDefined();
      expect(notes!.spacePreview!.instructionLines).toEqual([
        '- Define rules.',
        '- Keep structured.',
        '- Trace changes.',
      ]);
      expect(notes!.spacePreview!.readmeLines).toEqual([
        'Personal learning notes.',
        'Some structure info.',
      ]);
    });

    it('returns empty arrays when files are empty', async () => {
      seedFile(mindRoot, 'Empty/INSTRUCTION.md', '');
      seedFile(mindRoot, 'Empty/README.md', '');
      seedFile(mindRoot, 'Empty/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const empty = tree.find(n => n.name === 'Empty');
      expect(empty!.spacePreview!.instructionLines).toEqual([]);
      expect(empty!.spacePreview!.readmeLines).toEqual([]);
    });

    it('returns empty readmeLines when README.md does not exist', async () => {
      seedFile(mindRoot, 'NoReadme/INSTRUCTION.md', '# Inst\n\n- Rule 1');
      seedFile(mindRoot, 'NoReadme/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const noReadme = tree.find(n => n.name === 'NoReadme');
      expect(noReadme!.spacePreview!.instructionLines).toEqual(['- Rule 1']);
      expect(noReadme!.spacePreview!.readmeLines).toEqual([]);
    });

    it('skips headings and blank lines, takes at most 3 body lines', async () => {
      seedFile(mindRoot, 'Long/INSTRUCTION.md',
        '# Title\n\n## Section\n\n- Line 1\n- Line 2\n- Line 3\n- Line 4\n- Line 5'
      );
      seedFile(mindRoot, 'Long/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const long = tree.find(n => n.name === 'Long');
      expect(long!.spacePreview!.instructionLines).toHaveLength(3);
      expect(long!.spacePreview!.instructionLines).toEqual([
        '- Line 1',
        '- Line 2',
        '- Line 3',
      ]);
    });

    it('does not set spacePreview for non-space directories', async () => {
      seedFile(mindRoot, 'Plain/file.md', 'content');

      const { buildFileTreeForTest } = await import('@/lib/fs');
      const tree = buildFileTreeForTest(mindRoot);
      const plain = tree.find(n => n.name === 'Plain');
      expect(plain!.spacePreview).toBeUndefined();
    });
  });

  describe('deleteDirectory', () => {
    it('recursively deletes a directory and all contents', async () => {
      seedFile(mindRoot, 'ToDelete/sub/file.md', 'content');
      seedFile(mindRoot, 'ToDelete/README.md', '# ToDelete');
      seedFile(mindRoot, 'ToDelete/INSTRUCTION.md', '# Inst');

      const { deleteDirectory } = await import('@/lib/core/fs-ops');
      deleteDirectory(mindRoot, 'ToDelete');
      expect(fs.existsSync(path.join(mindRoot, 'ToDelete'))).toBe(false);
    });

    it('throws for non-existent directory', async () => {
      const { deleteDirectory } = await import('@/lib/core/fs-ops');
      expect(() => deleteDirectory(mindRoot, 'NonExistent')).toThrow('not found');
    });

    it('throws for path traversal attempts', async () => {
      const { deleteDirectory } = await import('@/lib/core/fs-ops');
      expect(() => deleteDirectory(mindRoot, '../../../tmp')).toThrow('Access denied');
    });

    it('throws when target is a file, not a directory', async () => {
      seedFile(mindRoot, 'file.md', 'content');

      const { deleteDirectory } = await import('@/lib/core/fs-ops');
      expect(() => deleteDirectory(mindRoot, 'file.md')).toThrow('Not a directory');
    });
  });
});
