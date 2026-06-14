import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMentionSearchIndex,
  parseMentionQueryFromInput,
  searchMentionFiles,
} from '@/hooks/useMention';

describe('useMention logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mention query parsing', () => {
    it('detects @ at start of input', () => {
      expect(parseMentionQueryFromInput('@readme')).toBe('readme');
    });

    it('detects @ after space or newline', () => {
      expect(parseMentionQueryFromInput('hello @file')).toBe('file');
      expect(parseMentionQueryFromInput('hello\n@file')).toBe('file');
    });

    it('uses the cursor position instead of text after the cursor', () => {
      expect(parseMentionQueryFromInput('ask @readme trailing', 'ask @readme'.length)).toBe('readme');
    });

    it('rejects @ in middle of word or completed mentions with whitespace', () => {
      expect(parseMentionQueryFromInput('user@host')).toBeNull();
      expect(parseMentionQueryFromInput('hello @file done')).toBeNull();
      expect(parseMentionQueryFromInput('hello world')).toBeNull();
    });
  });

  describe('mention file search', () => {
    it('returns the first candidates for an empty query', () => {
      const index = createMentionSearchIndex(['README.md', 'TODO.md']);

      expect(searchMentionFiles(index, '')).toEqual(['README.md', 'TODO.md']);
    });

    it('ranks basename prefix matches above basename and path substring matches without full sorting', () => {
      const files = [
        ...Array.from({ length: 100 }, (_, index) => `space/folder-target-${index}.md`),
        ...Array.from({ length: 35 }, (_, index) => `space/target-${index}.md`),
        ...Array.from({ length: 10 }, (_, index) => `target-space/misc-${index}.md`),
      ];
      const index = createMentionSearchIndex(files);
      const sortSpy = vi.spyOn(Array.prototype, 'sort');

      const results = searchMentionFiles(index, 'target');

      expect(sortSpy).not.toHaveBeenCalled();
      expect(results).toHaveLength(30);
      expect(results.every((path) => path.startsWith('space/target-'))).toBe(true);
    });

    it('returns an empty result when no candidate matches', () => {
      const index = createMentionSearchIndex(['README.md', 'TODO.md']);

      expect(searchMentionFiles(index, 'nonexistentfile')).toEqual([]);
    });
  });
});
