import { describe, expect, it } from 'vitest';
import { extractMarkdownSection, stripFrontmatter } from './markdown-section.js';

const DOC = `---
title: Doc
---
intro text

# One

one body

## One A

one a body

# Two

two body

- item with id ^block-1
- plain item

final paragraph ^block-2
`;

describe('stripFrontmatter', () => {
  it('removes leading frontmatter', () => {
    expect(stripFrontmatter('---\na: 1\n---\nbody')).toBe('body');
  });

  it('leaves content without frontmatter untouched', () => {
    expect(stripFrontmatter('# Title\nbody')).toBe('# Title\nbody');
  });

  it('does not treat a later --- as frontmatter', () => {
    expect(stripFrontmatter('body\n---\nmore')).toBe('body\n---\nmore');
  });

  it('handles an unterminated frontmatter block', () => {
    expect(stripFrontmatter('---\na: 1\nno end')).toBe('');
  });

  it('handles empty input', () => {
    expect(stripFrontmatter('')).toBe('');
  });
});

describe('extractMarkdownSection', () => {
  describe('normal paths', () => {
    it('returns the whole body without frontmatter when there is no subpath', () => {
      const section = extractMarkdownSection(DOC, undefined);
      expect(section).toContain('intro text');
      expect(section).not.toContain('title: Doc');
    });

    it('extracts a heading section up to the next same-level heading', () => {
      const section = extractMarkdownSection(DOC, { type: 'heading', value: 'One' });
      expect(section).toContain('# One');
      expect(section).toContain('one body');
      expect(section).toContain('## One A');
      expect(section).toContain('one a body');
      expect(section).not.toContain('# Two');
    });

    it('extracts a nested heading section up to the next heading of same or higher level', () => {
      const section = extractMarkdownSection(DOC, { type: 'heading', value: 'One A' });
      expect(section).toContain('## One A');
      expect(section).toContain('one a body');
      expect(section).not.toContain('# Two');
      expect(section).not.toContain('one body');
    });

    it('extracts the last heading section through end of document', () => {
      const section = extractMarkdownSection(DOC, { type: 'heading', value: 'Two' });
      expect(section).toContain('two body');
      expect(section).toContain('block-2');
    });

    it('extracts a block by id and drops the id marker', () => {
      const section = extractMarkdownSection(DOC, { type: 'block', value: 'block-1' });
      expect(section).toBe('- item with id');
    });

    it('extracts a trailing paragraph block by id', () => {
      expect(extractMarkdownSection(DOC, { type: 'block', value: 'block-2' })).toBe('final paragraph');
    });

    it('matches headings case-insensitively', () => {
      expect(extractMarkdownSection(DOC, { type: 'heading', value: 'one a' })).toContain('one a body');
    });
  });

  describe('boundary cases', () => {
    it('ignores a heading inside a fenced code block', () => {
      const doc = '```\n# Fake\n```\n\n# Real\n\nreal body';
      const section = extractMarkdownSection(doc, { type: 'heading', value: 'Fake' });
      expect(section).toBeNull();
      expect(extractMarkdownSection(doc, { type: 'heading', value: 'Real' })).toContain('real body');
    });

    it('returns an empty-bodied section for a heading with no content', () => {
      const section = extractMarkdownSection('# A\n# B\n\nb body', { type: 'heading', value: 'A' });
      expect(section).toBe('# A');
    });

    it('trims surrounding blank lines', () => {
      const section = extractMarkdownSection('# A\n\n\nbody\n\n\n# B', { type: 'heading', value: 'A' });
      expect(section).toBe('# A\n\n\nbody');
    });

    it('handles unicode and emoji headings', () => {
      const doc = '# 中文标题 🎉\n\nbody';
      expect(extractMarkdownSection(doc, { type: 'heading', value: '中文标题 🎉' })).toContain('body');
    });

    it('matches the first of two identical headings', () => {
      const doc = '# Dup\n\nfirst\n\n# Dup\n\nsecond';
      const section = extractMarkdownSection(doc, { type: 'heading', value: 'Dup' });
      expect(section).toContain('first');
      expect(section).not.toContain('second');
    });

    it('handles an empty document', () => {
      expect(extractMarkdownSection('', undefined)).toBe('');
      expect(extractMarkdownSection('', { type: 'heading', value: 'A' })).toBeNull();
    });

    it('ignores a block id that only appears inside a code fence', () => {
      const doc = '```\nfoo ^bid\n```';
      expect(extractMarkdownSection(doc, { type: 'block', value: 'bid' })).toBeNull();
    });
  });

  describe('error paths', () => {
    it('returns null for a missing heading', () => {
      expect(extractMarkdownSection(DOC, { type: 'heading', value: 'Nope' })).toBeNull();
    });

    it('returns null for a missing block id', () => {
      expect(extractMarkdownSection(DOC, { type: 'block', value: 'nope' })).toBeNull();
    });

    it('returns null for an empty subpath value', () => {
      expect(extractMarkdownSection(DOC, { type: 'heading', value: '' })).toBeNull();
      expect(extractMarkdownSection(DOC, { type: 'block', value: '' })).toBeNull();
    });

    it('does not throw on odd input', () => {
      for (const odd of ['#', '---', '\n\n\n', '```']) {
        expect(() => extractMarkdownSection(odd, { type: 'heading', value: 'x' })).not.toThrow();
      }
    });
  });
});
