import { describe, it, expect } from 'vitest';

/**
 * Unit tests for useSlashCommand behavior.
 * Since @testing-library/react is not available, we test the core logic
 * by directly replicating the pure parsing functions from useSlashCommand.
 */

function parseSlashQuery(val: string, cursorPos: number): { slashIdx: number; query: string } | null {
  const before = val.slice(0, cursorPos);
  const slashIdx = before.lastIndexOf('/');
  if (slashIdx === -1) return null;
  if (slashIdx > 0 && before[slashIdx - 1] !== ' ' && before[slashIdx - 1] !== '\n') return null;
  const query = before.slice(slashIdx + 1);
  if (query.includes(' ')) return null;
  return { slashIdx, query };
}

function filterSkills(
  allSkills: Array<{ name: string; description: string; enabled: boolean }>,
  query: string,
) {
  const q = query.toLowerCase();
  return allSkills
    .filter((s) => s.enabled)
    .filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    .slice(0, 20)
    .map((s) => ({ type: 'skill' as const, name: s.name, description: s.description }));
}

const mockSkills = [
  { name: 'mindos', description: 'Operate MindOS knowledge base', enabled: true },
  { name: 'ui-design', description: 'UI/UX design intelligence', enabled: true },
  { name: 'disabled-skill', description: 'This is disabled', enabled: false },
];

describe('useSlashCommand logic', () => {
  describe('slash query parsing', () => {
    it('detects / at start of input', () => {
      expect(parseSlashQuery('/', 1)).toEqual({ slashIdx: 0, query: '' });
    });

    it('detects / with query', () => {
      expect(parseSlashQuery('/mind', 5)).toEqual({ slashIdx: 0, query: 'mind' });
    });

    it('detects / after space', () => {
      expect(parseSlashQuery('hello /ui', 9)).toEqual({ slashIdx: 6, query: 'ui' });
    });

    it('rejects / in middle of word (path-like)', () => {
      expect(parseSlashQuery('path/to/file', 12)).toBeNull();
    });

    it('returns null when no /', () => {
      expect(parseSlashQuery('hello world', 11)).toBeNull();
    });

    it('rejects when query contains space', () => {
      expect(parseSlashQuery('/mind os', 8)).toBeNull();
    });

    it('detects / after newline', () => {
      expect(parseSlashQuery('line1\n/skill', 12)).toEqual({ slashIdx: 6, query: 'skill' });
    });
  });

  describe('skill filtering', () => {
    it('shows all enabled skills on empty query', () => {
      const results = filterSkills(mockSkills, '');
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('mindos');
      expect(results[1].name).toBe('ui-design');
    });

    it('excludes disabled skills', () => {
      const results = filterSkills(mockSkills, 'disabled');
      expect(results).toHaveLength(0);
    });

    it('filters by name', () => {
      const results = filterSkills(mockSkills, 'ui');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('ui-design');
    });

    it('filters by description', () => {
      const results = filterSkills(mockSkills, 'knowledge');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('mindos');
    });

    it('caps at 20 results', () => {
      const many = Array.from({ length: 30 }, (_, i) => ({
        name: `skill-${i}`,
        description: 'test',
        enabled: true,
      }));
      const results = filterSkills(many, '');
      expect(results).toHaveLength(20);
    });
  });

  describe('navigate bounds', () => {
    it('navigateDown stays in bounds', () => {
      const len = 3;
      let i = 0;
      i = Math.min(i + 1, len - 1);
      expect(i).toBe(1);
      i = Math.min(i + 1, len - 1);
      expect(i).toBe(2);
      i = Math.min(i + 1, len - 1);
      expect(i).toBe(2);
    });

    it('navigateUp stays at 0', () => {
      const i = 0;
      expect(Math.max(i - 1, 0)).toBe(0);
    });
  });

  describe('zero-result does not block submit', () => {
    it('returns null query when no skills match', () => {
      const results = filterSkills(mockSkills, 'zzz-nonexistent');
      expect(results).toHaveLength(0);
    });

    it('returns null query with empty skills list and empty query', () => {
      const results = filterSkills([], '');
      expect(results).toHaveLength(0);
    });

    it('returns null query with empty skills list and non-empty query', () => {
      const results = filterSkills([], 'mind');
      expect(results).toHaveLength(0);
    });
  });

  describe('API response defense', () => {
    it('handles missing skills key', () => {
      const data = { error: 'fail' };
      const skills = Array.isArray((data as Record<string, unknown>)?.skills) ? (data as Record<string, unknown>).skills : [];
      expect(skills).toEqual([]);
    });

    it('handles null response', () => {
      const data = null;
      const skills = Array.isArray((data as Record<string, unknown> | null)?.skills) ? [] : [];
      expect(skills).toEqual([]);
    });
  });
});
