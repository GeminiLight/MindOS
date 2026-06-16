import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { SearchIndex } from '@/lib/core/search-index';
import { writeMindosIgnoreFile } from '@/lib/core/tree';

vi.mock('@/lib/core/pdf-text', () => ({
  extractPdfText: vi.fn(() => 'leaked pdf token'),
}));

describe('SearchIndex', () => {
  let mindRoot: string;
  let index: SearchIndex;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    seedFile(mindRoot, 'Profile/Identity.md', '# My Identity\n\nI am a developer working on MindOS.');
    seedFile(mindRoot, 'Projects/TODO.md', '# TODO\n\n- Fix the bug\n- Add search feature');
    seedFile(mindRoot, 'Resources/data.csv', 'name,value\nfoo,bar\nbaz,qux');
    seedFile(mindRoot, 'Archive/old.md', 'This is archived content about search.');
    index = new SearchIndex();
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
  });

  describe('rebuild', () => {
    it('builds an index from files in mindRoot', () => {
      index.rebuild(mindRoot);
      expect(index.isBuilt()).toBe(true);
    });

    it('indexes all files', () => {
      index.rebuild(mindRoot);
      expect(index.getFileCount()).toBe(4);
    });
  });

  describe('getCandidates', () => {
    it('returns file paths containing the query token', () => {
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('search');
      expect(candidates).toContain('Projects/TODO.md');
      expect(candidates).toContain('Archive/old.md');
    });

    it('returns empty set for non-existent token', () => {
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('xyznonexistent123');
      expect(candidates).toHaveLength(0);
    });

    it('is case-insensitive', () => {
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('DEVELOPER');
      expect(candidates).toContain('Profile/Identity.md');
    });

    it('intersects candidates for multi-word queries', () => {
      index.rebuild(mindRoot);
      // "search feature" should narrow to Projects/TODO.md (has both words)
      const candidates = index.getCandidates('search feature');
      expect(candidates).toContain('Projects/TODO.md');
      // Archive/old.md has "search" but NOT "feature" — must be excluded by intersection
      expect(candidates).not.toContain('Archive/old.md');
    });
  });

  describe('CJK support', () => {
    it('indexes CJK characters as bigrams', () => {
      seedFile(mindRoot, 'Notes/chinese.md', '知识库是一个管理工具');
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('知识');
      expect(candidates).toContain('Notes/chinese.md');
    });

    it('getCandidatesUnion prunes low-overlap CJK files', () => {
      // "知识管理系统" produces many bigrams: 知识, 识管, 管理, 理系, 系统
      // File A has "知识管理系统" (all bigrams match)
      // File B has only "知识" (1 bigram matches)
      // File C has "管理" (1 bigram matches)
      seedFile(mindRoot, 'Notes/full-match.md', '知识管理系统是核心');
      seedFile(mindRoot, 'Notes/partial-a.md', '这是知识的来源');
      seedFile(mindRoot, 'Notes/partial-b.md', '我们要管理好时间');
      index.rebuild(mindRoot);

      const candidates = index.getCandidatesUnion('知识管理系统');
      expect(candidates).not.toBeNull();
      // Full match file should always be included
      expect(candidates).toContain('Notes/full-match.md');
      // Partial matches (only 1 bigram) should be pruned when threshold >= 2
      expect(candidates).not.toContain('Notes/partial-a.md');
      expect(candidates).not.toContain('Notes/partial-b.md');
    });

    it('handles mixed CJK and Latin query', () => {
      seedFile(mindRoot, 'Notes/mixed.md', '这是一个MindOS知识库文件');
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('mindos');
      expect(candidates).toContain('Notes/mixed.md');
    });
  });

  describe('invalidate', () => {
    it('clears the index', () => {
      index.rebuild(mindRoot);
      expect(index.isBuilt()).toBe(true);
      index.invalidate();
      expect(index.isBuilt()).toBe(false);
    });

    it('returns null candidates after invalidation (triggers full scan fallback)', () => {
      index.rebuild(mindRoot);
      index.invalidate();
      expect(index.getCandidates('search')).toBeNull();
    });
  });

  describe('isBuiltFor', () => {
    it('returns true for the root it was built with', () => {
      index.rebuild(mindRoot);
      expect(index.isBuiltFor(mindRoot)).toBe(true);
    });

    it('returns false for a different root', () => {
      index.rebuild(mindRoot);
      expect(index.isBuiltFor('/some/other/root')).toBe(false);
    });

    it('returns false after invalidation', () => {
      index.rebuild(mindRoot);
      index.invalidate();
      expect(index.isBuiltFor(mindRoot)).toBe(false);
    });
  });

  describe('substring queries (no tokens produced)', () => {
    it('returns null for single-char Latin query (falls back to full scan)', () => {
      index.rebuild(mindRoot);
      // "a" is too short to produce tokens → null → caller does full scan
      expect(index.getCandidates('a')).toBeNull();
    });

    it('returns null for partial-word queries that produce no tokens', () => {
      index.rebuild(mindRoot);
      // "x" produces no token → null → preserves indexOf substring matching
      expect(index.getCandidates('x')).toBeNull();
    });
  });

  describe('special characters', () => {
    it('handles query with regex special chars', () => {
      seedFile(mindRoot, 'Notes/special.md', 'price is $100.00 (USD)');
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('$100');
      expect(candidates).toContain('Notes/special.md');
    });

    it('handles empty query', () => {
      index.rebuild(mindRoot);
      expect(index.getCandidates('')).toBeNull();
    });
  });

  describe('large content truncation', () => {
    it('truncates files larger than 50KB for indexing', () => {
      const largeContent = 'uniquetoken '.repeat(10_000); // ~120KB
      seedFile(mindRoot, 'Notes/large.md', largeContent);
      index.rebuild(mindRoot);
      const candidates = index.getCandidates('uniquetoken');
      expect(candidates).toContain('Notes/large.md');
    });
  });

  describe('incremental updates', () => {
    it('updateFile re-indexes a modified file without full rebuild', () => {
      index.rebuild(mindRoot);
      expect(index.getCandidates('quantum')).toHaveLength(0);

      // Modify file to contain new term
      seedFile(mindRoot, 'Profile/Identity.md', '# My Identity\n\nI study quantum computing.');
      index.updateFile(mindRoot, 'Profile/Identity.md');

      const candidates = index.getCandidates('quantum');
      expect(candidates).toContain('Profile/Identity.md');
      // Old term should still be findable in other files
      expect(index.getCandidates('search')).toContain('Projects/TODO.md');
    });

    it('updateFile removes old tokens that no longer exist in file', () => {
      index.rebuild(mindRoot);
      expect(index.getCandidates('developer')).toContain('Profile/Identity.md');

      // Rewrite file without "developer"
      seedFile(mindRoot, 'Profile/Identity.md', '# My Identity\n\nI am a designer.');
      index.updateFile(mindRoot, 'Profile/Identity.md');

      expect(index.getCandidates('developer')).toHaveLength(0);
      expect(index.getCandidates('designer')).toContain('Profile/Identity.md');
    });

    it('updateFile maintains correct fileCount', () => {
      index.rebuild(mindRoot);
      expect(index.getFileCount()).toBe(4);

      seedFile(mindRoot, 'Profile/Identity.md', 'updated content');
      index.updateFile(mindRoot, 'Profile/Identity.md');

      expect(index.getFileCount()).toBe(4); // same file, count unchanged
    });

    it('removeFile removes a file from the index', () => {
      index.rebuild(mindRoot);
      expect(index.getCandidates('archived')).toContain('Archive/old.md');

      index.removeFile('Archive/old.md');

      expect(index.getCandidates('archived')).toHaveLength(0);
      expect(index.getFileCount()).toBe(3);
    });

    it('addFile indexes a new file without full rebuild', () => {
      index.rebuild(mindRoot);
      expect(index.getFileCount()).toBe(4);

      seedFile(mindRoot, 'Notes/fresh.md', 'brand new blockchain content');
      index.addFile(mindRoot, 'Notes/fresh.md');

      expect(index.getFileCount()).toBe(5);
      expect(index.getCandidates('blockchain')).toContain('Notes/fresh.md');
    });

    it('addFile and updateFile ignore dependency and generated paths', () => {
      index.rebuild(mindRoot);
      expect(index.getFileCount()).toBe(4);

      seedFile(mindRoot, 'node_modules/pkg/index.md', 'dependency blockchain content');
      seedFile(mindRoot, 'dist/generated.md', 'generated blockchain content');
      index.addFile(mindRoot, 'node_modules/pkg/index.md');
      index.addFile(mindRoot, 'dist/generated.md');

      expect(index.getFileCount()).toBe(4);
      expect(index.getCandidates('blockchain')).toHaveLength(0);

      seedFile(mindRoot, 'Profile/Identity.md', 'safe before');
      index.updateFile(mindRoot, 'Profile/Identity.md');
      expect(index.getCandidates('safe')).toContain('Profile/Identity.md');
      index.updateFile(mindRoot, 'node_modules/pkg/index.md');

      expect(index.getCandidates('dependency')).toHaveLength(0);
      expect(index.getCandidates('safe')).toContain('Profile/Identity.md');
    });

    it('addFile and updateFile remove paths ignored by .mindosignore', () => {
      index.rebuild(mindRoot);
      writeMindosIgnoreFile(mindRoot, ['Notes/private/']);
      seedFile(mindRoot, 'Notes/private/secret.md', 'classified orchid content');
      index.addFile(mindRoot, 'Notes/private/secret.md');

      expect(index.getCandidates('orchid')).toHaveLength(0);
      expect(index.getFileCount()).toBe(4);

      seedFile(mindRoot, 'Profile/Identity.md', 'safe visible orchid');
      index.updateFile(mindRoot, 'Profile/Identity.md');
      expect(index.getCandidates('orchid')).toEqual(['Profile/Identity.md']);

      index.updateFile(mindRoot, 'Notes/private/secret.md');
      expect(index.getCandidates('classified')).toHaveLength(0);
      expect(index.getCandidates('orchid')).toEqual(['Profile/Identity.md']);
    });

    it('addFile ignores PDF paths that resolve through symlinks outside mindRoot', () => {
      index.rebuild(mindRoot);
      const outsideRoot = `${mindRoot}-outside`;
      fs.mkdirSync(outsideRoot, { recursive: true });
      fs.writeFileSync(path.join(outsideRoot, 'leak.pdf'), 'outside', 'utf-8');
      fs.symlinkSync(path.join(outsideRoot, 'leak.pdf'), path.join(mindRoot, 'Profile', 'leak.pdf'), 'file');

      try {
        index.addFile(mindRoot, 'Profile/leak.pdf');
        expect(index.getFileCount()).toBe(4);
        expect(index.getCandidates('leaked')).toHaveLength(0);
      } finally {
        fs.rmSync(outsideRoot, { recursive: true, force: true });
      }
    });

    it('updateFile updates BM25 docLength stats', () => {
      index.rebuild(mindRoot);
      const oldLen = index.getDocLength('Profile/Identity.md');

      seedFile(mindRoot, 'Profile/Identity.md', 'short');
      index.updateFile(mindRoot, 'Profile/Identity.md');

      expect(index.getDocLength('Profile/Identity.md')).toBe(5);
      expect(index.getDocLength('Profile/Identity.md')).not.toBe(oldLen);
    });

    it('removeFile of an unknown path does not corrupt fileCount', () => {
      index.rebuild(mindRoot);
      index.removeFile('never/indexed.md');
      expect(index.getFileCount()).toBe(4);
    });

    it('updateFile on a not-yet-indexed file adds it with correct fileCount', () => {
      index.rebuild(mindRoot);
      seedFile(mindRoot, 'Notes/brand-new.md', 'velociraptor facts');
      index.updateFile(mindRoot, 'Notes/brand-new.md');
      expect(index.getFileCount()).toBe(5);
      expect(index.getCandidates('velociraptor')).toContain('Notes/brand-new.md');
    });

    it('removePath removes a single file', () => {
      index.rebuild(mindRoot);
      const removed = index.removePath('Archive/old.md');
      expect(removed).toEqual(['Archive/old.md']);
      expect(index.getCandidates('archived')).toHaveLength(0);
    });

    it('removePath removes every file under a directory prefix', () => {
      seedFile(mindRoot, 'Projects/Sub/inner.md', 'nested submarine content');
      index.rebuild(mindRoot);
      const removed = index.removePath('Projects');
      expect(removed.sort()).toEqual(['Projects/Sub/inner.md', 'Projects/TODO.md']);
      expect(index.getCandidates('submarine')).toHaveLength(0);
      expect(index.getFileCount()).toBe(3);
      // Sibling files survive.
      expect(index.getCandidates('archived')).toContain('Archive/old.md');
    });

    it('removePath does not remove files sharing only a name prefix', () => {
      seedFile(mindRoot, 'Projects-extra/other.md', 'prefix collision content');
      index.rebuild(mindRoot);
      index.removePath('Projects');
      expect(index.getCandidates('collision')).toContain('Projects-extra/other.md');
    });
  });

  describe('content cache', () => {
    it('serves content from memory after rebuild (no disk read)', () => {
      index.rebuild(mindRoot);
      const readSpy = vi.spyOn(fs, 'readFileSync');
      const content = index.getContent(mindRoot, 'Archive/old.md');
      expect(content).toContain('archived content');
      const libraryReads = readSpy.mock.calls.filter((c) => String(c[0]).startsWith(mindRoot));
      expect(libraryReads).toHaveLength(0);
      readSpy.mockRestore();
    });

    it('returns pre-lowercased content', () => {
      index.rebuild(mindRoot);
      const lower = index.getLowerContent(mindRoot, 'Profile/Identity.md');
      expect(lower).toContain('# my identity');
    });

    it('returns null for files not in the index', () => {
      index.rebuild(mindRoot);
      expect(index.getContent(mindRoot, 'nope/missing.md')).toBeNull();
      expect(index.getLowerContent(mindRoot, 'nope/missing.md')).toBeNull();
    });

    it('lazily re-reads content after a persisted index is loaded (contents are not persisted)', () => {
      index.rebuild(mindRoot);
      const dir = fs.mkdtempSync(path.join(mindRoot, 'persist-'));
      index.persist(dir);
      const restored = new SearchIndex();
      expect(restored.load(dir, mindRoot)).toBe(true);
      expect(restored.getContent(mindRoot, 'Archive/old.md')).toContain('archived content');
    });

    it('rejects a persisted index when file contents change without a file-count change', () => {
      index.rebuild(mindRoot);
      const dir = fs.mkdtempSync(path.join(mindRoot, 'persist-'));
      index.persist(dir);

      seedFile(mindRoot, 'Archive/old.md', 'same path but a newer index signature');

      const restored = new SearchIndex();
      expect(restored.load(dir, mindRoot)).toBe(false);
    });

    it('refreshes cached content on updateFile', () => {
      index.rebuild(mindRoot);
      expect(index.getContent(mindRoot, 'Archive/old.md')).toContain('archived');
      seedFile(mindRoot, 'Archive/old.md', 'replaced with fresh text');
      index.updateFile(mindRoot, 'Archive/old.md');
      expect(index.getContent(mindRoot, 'Archive/old.md')).toBe('replaced with fresh text');
      expect(index.getLowerContent(mindRoot, 'Archive/old.md')).toBe('replaced with fresh text');
    });

    it('getAllFiles lists indexed files', () => {
      index.rebuild(mindRoot);
      expect(index.getAllFiles().sort()).toEqual([
        'Archive/old.md',
        'Profile/Identity.md',
        'Projects/TODO.md',
        'Resources/data.csv',
      ]);
    });
  });
});
