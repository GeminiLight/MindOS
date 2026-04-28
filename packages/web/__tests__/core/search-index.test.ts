import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { SearchIndex } from '@/lib/core/search-index';

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

    it('updateFile updates BM25 docLength stats', () => {
      index.rebuild(mindRoot);
      const oldLen = index.getDocLength('Profile/Identity.md');

      seedFile(mindRoot, 'Profile/Identity.md', 'short');
      index.updateFile(mindRoot, 'Profile/Identity.md');

      expect(index.getDocLength('Profile/Identity.md')).toBe(5);
      expect(index.getDocLength('Profile/Identity.md')).not.toBe(oldLen);
    });
  });
});
