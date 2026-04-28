import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile, readSeeded } from './helpers';
import {
  readLines,
  insertLines,
  updateLines,
  appendToFile,
  insertAfterHeading,
  updateSection,
} from '@/lib/core/lines';

describe('lines', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  describe('readLines', () => {
    it('splits content into lines', () => {
      seedFile(mindRoot, 'test.md', 'line1\nline2\nline3');
      expect(readLines(mindRoot, 'test.md')).toEqual(['line1', 'line2', 'line3']);
    });

    it('handles single-line files', () => {
      seedFile(mindRoot, 'test.md', 'only line');
      expect(readLines(mindRoot, 'test.md')).toEqual(['only line']);
    });
  });

  describe('insertLines', () => {
    it('inserts after a specific index', () => {
      seedFile(mindRoot, 'test.md', 'line0\nline1\nline2');
      insertLines(mindRoot, 'test.md', 0, ['inserted']);
      expect(readSeeded(mindRoot, 'test.md')).toBe('line0\ninserted\nline1\nline2');
    });

    it('prepends with afterIndex = -1', () => {
      seedFile(mindRoot, 'test.md', 'line0\nline1');
      insertLines(mindRoot, 'test.md', -1, ['prepended']);
      expect(readSeeded(mindRoot, 'test.md')).toBe('prepended\nline0\nline1');
    });

    it('inserts multiple lines', () => {
      seedFile(mindRoot, 'test.md', 'a\nc');
      insertLines(mindRoot, 'test.md', 0, ['b1', 'b2']);
      expect(readSeeded(mindRoot, 'test.md')).toBe('a\nb1\nb2\nc');
    });

    it('throws for out-of-bounds afterIndex', () => {
      seedFile(mindRoot, 'test.md', 'line0');
      expect(() => insertLines(mindRoot, 'test.md', 5, ['x'])).toThrow('Invalid after_index');
    });
  });

  describe('updateLines', () => {
    it('replaces a single line', () => {
      seedFile(mindRoot, 'test.md', 'a\nb\nc');
      updateLines(mindRoot, 'test.md', 1, 1, ['B']);
      expect(readSeeded(mindRoot, 'test.md')).toBe('a\nB\nc');
    });

    it('replaces a range of lines', () => {
      seedFile(mindRoot, 'test.md', 'a\nb\nc\nd');
      updateLines(mindRoot, 'test.md', 1, 2, ['X']);
      expect(readSeeded(mindRoot, 'test.md')).toBe('a\nX\nd');
    });

    it('can expand a range with more lines', () => {
      seedFile(mindRoot, 'test.md', 'a\nb\nc');
      updateLines(mindRoot, 'test.md', 1, 1, ['x', 'y', 'z']);
      expect(readSeeded(mindRoot, 'test.md')).toBe('a\nx\ny\nz\nc');
    });

    it('throws for invalid range (start > end)', () => {
      seedFile(mindRoot, 'test.md', 'a\nb\nc');
      expect(() => updateLines(mindRoot, 'test.md', 2, 1, ['x'])).toThrow('Invalid range');
    });

    it('throws for out-of-bounds start', () => {
      seedFile(mindRoot, 'test.md', 'a');
      expect(() => updateLines(mindRoot, 'test.md', 5, 5, ['x'])).toThrow('Invalid line index');
    });
  });

  describe('appendToFile', () => {
    it('appends to a file with content', () => {
      seedFile(mindRoot, 'test.md', 'existing');
      appendToFile(mindRoot, 'test.md', 'new stuff');
      expect(readSeeded(mindRoot, 'test.md')).toBe('existing\nnew stuff');
    });

    it('appends to empty file without extra separator', () => {
      seedFile(mindRoot, 'test.md', '');
      appendToFile(mindRoot, 'test.md', 'first');
      expect(readSeeded(mindRoot, 'test.md')).toBe('first');
    });
  });

  describe('insertAfterHeading', () => {
    it('inserts content after a heading', () => {
      seedFile(mindRoot, 'test.md', '# Title\n\nOld content\n\n## Other');
      insertAfterHeading(mindRoot, 'test.md', '# Title', 'Inserted text');
      const result = readSeeded(mindRoot, 'test.md');
      expect(result).toContain('Inserted text');
      // Inserted text should appear between Title and Old content
      const lines = result.split('\n');
      const titleIdx = lines.findIndex(l => l === '# Title');
      const insertedIdx = lines.findIndex(l => l === 'Inserted text');
      expect(insertedIdx).toBeGreaterThan(titleIdx);
    });

    it('matches heading without # prefix', () => {
      seedFile(mindRoot, 'test.md', '## Tasks\n\n- item 1');
      insertAfterHeading(mindRoot, 'test.md', 'Tasks', 'New task');
      expect(readSeeded(mindRoot, 'test.md')).toContain('New task');
    });

    it('throws if heading not found', () => {
      seedFile(mindRoot, 'test.md', '# Title\n\nContent');
      expect(() => insertAfterHeading(mindRoot, 'test.md', 'Missing', 'x')).toThrow('Heading not found');
    });
  });

  describe('updateSection', () => {
    it('replaces section content between headings', () => {
      seedFile(mindRoot, 'test.md', '# Title\n\nOld\n\n## Status\n\nActive\n\n## Notes\n\nSome notes');
      updateSection(mindRoot, 'test.md', '## Status', 'Completed');
      const result = readSeeded(mindRoot, 'test.md');
      expect(result).toContain('Completed');
      expect(result).not.toContain('Active');
      expect(result).toContain('## Notes');
      expect(result).toContain('Some notes');
    });

    it('replaces until end of file for last section', () => {
      seedFile(mindRoot, 'test.md', '# Title\n\n## Last\n\nold stuff');
      updateSection(mindRoot, 'test.md', '## Last', 'new stuff');
      const result = readSeeded(mindRoot, 'test.md');
      expect(result).toContain('new stuff');
      expect(result).not.toContain('old stuff');
    });

    it('throws if heading not found', () => {
      seedFile(mindRoot, 'test.md', '# Title\n\nContent');
      expect(() => updateSection(mindRoot, 'test.md', 'Nope', 'x')).toThrow('Heading not found');
    });
  });
});
