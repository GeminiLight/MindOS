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
});
