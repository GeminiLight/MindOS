import { describe, expect, it } from 'vitest';
import {
  parseFrontMatterEntry,
  parseFrontMatterStringArray,
} from '@/lib/obsidian-compat/shims/frontmatter';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

describe('obsidian parseFrontMatterEntry shim', () => {
  it('returns the raw value for a string key without falsy collapsing', () => {
    const frontmatter = { title: 'Note', done: false, count: 0, tags: ['a', 'b'] };
    expect(parseFrontMatterEntry(frontmatter, 'title')).toBe('Note');
    expect(parseFrontMatterEntry(frontmatter, 'done')).toBe(false);
    expect(parseFrontMatterEntry(frontmatter, 'count')).toBe(0);
    expect(parseFrontMatterEntry(frontmatter, 'tags')).toEqual(['a', 'b']);
  });

  it('returns null for absent keys and empty frontmatter', () => {
    expect(parseFrontMatterEntry({ title: 'Note' }, 'missing')).toBeNull();
    expect(parseFrontMatterEntry(null, 'title')).toBeNull();
    expect(parseFrontMatterEntry(undefined, 'title')).toBeNull();
    expect(parseFrontMatterEntry({}, 'title')).toBeNull();
  });

  it('matches RegExp keys against frontmatter keys in declaration order', () => {
    const frontmatter = { 'tags.work': 1, tagline: 'x', tags: ['a'] };
    expect(parseFrontMatterEntry(frontmatter, /^tags$/)).toEqual(['a']);
    expect(parseFrontMatterEntry(frontmatter, /tag/)).toBe(1);
    expect(parseFrontMatterEntry(frontmatter, /^nope$/)).toBeNull();
  });

  it('treats stateful global regexes as stateless across calls', () => {
    const frontmatter = { a: 1, b: 2 };
    const pattern = /[ab]/g;
    expect(parseFrontMatterEntry(frontmatter, pattern)).toBe(1);
    expect(parseFrontMatterEntry(frontmatter, pattern)).toBe(1);
  });
});

describe('obsidian parseFrontMatterStringArray shim', () => {
  it('normalizes array entries to strings entry by entry', () => {
    expect(parseFrontMatterStringArray({ list: ['a', 2, true] }, 'list')).toEqual(['a', '2', 'true']);
  });

  it('wraps a plain string once without comma splitting', () => {
    expect(parseFrontMatterStringArray({ aliases: 'A, B' }, 'aliases')).toEqual(['A, B']);
    expect(parseFrontMatterStringArray({ single: 'A' }, 'single')).toEqual(['A']);
  });

  it('returns null for non-string non-array values and missing keys', () => {
    expect(parseFrontMatterStringArray({ count: 5 }, 'count')).toBeNull();
    expect(parseFrontMatterStringArray({ done: true }, 'done')).toBeNull();
    expect(parseFrontMatterStringArray({ tags: ['a'] }, 'missing')).toBeNull();
    expect(parseFrontMatterStringArray(null, 'tags')).toBeNull();
  });

  it('supports RegExp keys through parseFrontMatterEntry', () => {
    expect(parseFrontMatterStringArray({ cssclasses: ['x'], other: 1 }, /^css/)).toEqual(['x']);
  });

  it('registers both helpers on the obsidian module', () => {
    const obsidian = createObsidianModule();
    expect(obsidian.parseFrontMatterEntry).toBe(parseFrontMatterEntry);
    expect(obsidian.parseFrontMatterStringArray).toBe(parseFrontMatterStringArray);
  });
});
