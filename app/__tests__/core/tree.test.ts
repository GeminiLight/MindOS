import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { getFileTree, collectAllFiles, renderTree } from '@/lib/core/tree';

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
});
