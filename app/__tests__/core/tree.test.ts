import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { getFileTree, collectAllFiles, renderTree, buildFileIndex } from '@/lib/core/tree';

describe('tree', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  describe('getFileTree', () => {
    it('returns empty for empty directory', () => {
      expect(getFileTree(mindRoot)).toEqual([]);
    });

    it('includes .md and .csv files', () => {
      seedFile(mindRoot, 'README.md', '# Hi');
      seedFile(mindRoot, 'data.csv', 'a,b');
      const tree = getFileTree(mindRoot);
      expect(tree).toHaveLength(2);
      expect(tree.map(n => n.name).sort()).toEqual(['README.md', 'data.csv']);
    });

    it('excludes non-allowed extensions', () => {
      seedFile(mindRoot, 'test.md', 'md');
      seedFile(mindRoot, 'test.txt', 'txt');
      seedFile(mindRoot, 'test.js', 'js');
      const tree = getFileTree(mindRoot);
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('test.md');
    });

    it('ignores .git and node_modules directories', () => {
      seedFile(mindRoot, '.git/config', 'git');
      seedFile(mindRoot, 'node_modules/pkg/index.md', 'npm');
      seedFile(mindRoot, 'real.md', 'content');
      const tree = getFileTree(mindRoot);
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('real.md');
    });

    it('builds nested directory structure', () => {
      seedFile(mindRoot, 'Profile/Identity.md', 'me');
      seedFile(mindRoot, 'Profile/Goals.md', 'goals');
      const tree = getFileTree(mindRoot);
      expect(tree).toHaveLength(1);
      expect(tree[0].type).toBe('directory');
      expect(tree[0].name).toBe('Profile');
      expect(tree[0].children).toHaveLength(2);
    });

    it('omits empty directories', () => {
      seedFile(mindRoot, 'empty/.gitkeep', '');
      seedFile(mindRoot, 'has-md/file.md', 'content');
      const tree = getFileTree(mindRoot);
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('has-md');
    });

    it('sorts directories before files, then alphabetically', () => {
      seedFile(mindRoot, 'z.md', '');
      seedFile(mindRoot, 'a.md', '');
      seedFile(mindRoot, 'dir/x.md', '');
      const tree = getFileTree(mindRoot);
      expect(tree.map(n => n.name)).toEqual(['dir', 'a.md', 'z.md']);
    });
  });

  describe('collectAllFiles', () => {
    it('collects all relative paths', () => {
      seedFile(mindRoot, 'a.md', '');
      seedFile(mindRoot, 'sub/b.csv', '');
      seedFile(mindRoot, 'sub/c.txt', '');
      const files = collectAllFiles(mindRoot);
      expect(files.sort()).toEqual(['a.md', 'sub/b.csv']);
    });
  });

  describe('renderTree', () => {
    it('renders a simple tree', () => {
      seedFile(mindRoot, 'README.md', '');
      seedFile(mindRoot, 'Profile/Identity.md', '');
      const tree = getFileTree(mindRoot);
      const rendered = renderTree(tree);
      expect(rendered).toContain('Profile/');
      expect(rendered).toContain('Identity.md');
      expect(rendered).toContain('README.md');
    });
  });

  describe('buildFileIndex', () => {
    it('returns empty message for empty KB', () => {
      expect(buildFileIndex(mindRoot)).toBe('(empty knowledge base)');
    });

    it('lists files with directory file counts', () => {
      seedFile(mindRoot, 'Projects/roadmap.md', '');
      seedFile(mindRoot, 'Projects/pricing.md', '');
      seedFile(mindRoot, 'notes.md', '');
      const index = buildFileIndex(mindRoot);
      expect(index).toContain('Projects/ (2 files)');
      expect(index).toContain('  roadmap.md');
      expect(index).toContain('  pricing.md');
      expect(index).toContain('notes.md');
    });

    it('respects maxDepth — collapses deep directories', () => {
      seedFile(mindRoot, 'A/B/C/deep.md', '');
      seedFile(mindRoot, 'A/B/shallow.md', '');

      const index = buildFileIndex(mindRoot, { maxDepth: 1 });
      expect(index).toContain('A/ (2 files)');
      // depth 1 = we expand A/ but B/ should be collapsed
      expect(index).toContain('  B/ (2 files)');
      expect(index).not.toContain('C/');
      expect(index).not.toContain('deep.md');
    });

    it('expands to depth 2 by default', () => {
      seedFile(mindRoot, 'A/B/C/deep.md', '');
      seedFile(mindRoot, 'A/B/mid.md', '');

      const index = buildFileIndex(mindRoot);
      // depth 0: A/, depth 1: B/, depth 2: C/ collapsed
      expect(index).toContain('A/ (2 files)');
      expect(index).toContain('  B/ (2 files)');
      expect(index).toContain('    C/ (1 files)');
      expect(index).toContain('    mid.md');
      expect(index).not.toContain('deep.md');
    });

    it('truncates when directory has more files than maxFilesPerDir', () => {
      for (let i = 0; i < 20; i++) {
        seedFile(mindRoot, `file-${String(i).padStart(2, '0')}.md`, '');
      }
      const index = buildFileIndex(mindRoot, { maxFilesPerDir: 5 });
      const lines = index.split('\n');
      const fileLines = lines.filter(l => l.endsWith('.md'));
      expect(fileLines).toHaveLength(5);
      expect(index).toContain('... (15 more)');
    });

    it('counts nested files in directory totals', () => {
      seedFile(mindRoot, 'Research/papers/a.md', '');
      seedFile(mindRoot, 'Research/papers/b.md', '');
      seedFile(mindRoot, 'Research/notes.md', '');
      const index = buildFileIndex(mindRoot);
      expect(index).toContain('Research/ (3 files)');
    });

    it('handles deeply nested directories at depth limit', () => {
      seedFile(mindRoot, 'L1/L2/L3/L4/L5/deep.md', '');
      const index = buildFileIndex(mindRoot, { maxDepth: 2 });
      expect(index).toContain('L1/ (1 files)');
      expect(index).toContain('  L2/ (1 files)');
      expect(index).toContain('    L3/ (1 files)');
      expect(index).not.toContain('L4');
    });
  });
});
