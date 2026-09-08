import { describe, expect, it } from 'vitest';
import { createGlobMatcher, isGlobPattern } from './glob.js';

describe('isGlobPattern', () => {
  it('detects glob metacharacters', () => {
    expect(isGlobPattern('*.md')).toBe(true);
    expect(isGlobPattern('Scratch/**')).toBe(true);
    expect(isGlobPattern('draft?.md')).toBe(true);
    expect(isGlobPattern('[abc].md')).toBe(true);
    expect(isGlobPattern('Archive')).toBe(false);
    expect(isGlobPattern('Private Notes/2026')).toBe(false);
    expect(isGlobPattern('')).toBe(false);
  });
});

describe('createGlobMatcher', () => {
  it('matches ** across directories and * within one segment', () => {
    const deep = createGlobMatcher('Templates/**');
    expect(deep('Templates/base/note.md')).toBe(true);
    expect(deep('Templates/note.md')).toBe(true);
    expect(deep('Other/Templates/note.md')).toBe(false);

    const shallow = createGlobMatcher('Scratch/*.md');
    expect(shallow('Scratch/draft.md')).toBe(true);
    expect(shallow('Scratch/sub/draft.md')).toBe(false);

    const everything = createGlobMatcher('**');
    expect(everything('Notes/today.md')).toBe(true);
    expect(everything('.hidden/x.md')).toBe(true);
  });

  it('matches dotfiles, ? and character classes', () => {
    expect(createGlobMatcher('*')('.obsidian')).toBe(true);
    expect(createGlobMatcher('draft?.md')('draft1.md')).toBe(true);
    expect(createGlobMatcher('draft?.md')('draft12.md')).toBe(false);
    expect(createGlobMatcher('[abc].md')('a.md')).toBe(true);
    expect(createGlobMatcher('[abc].md')('d.md')).toBe(false);
  });

  it('normalizes Windows separators on both sides', () => {
    expect(createGlobMatcher('Scratch\\*.md')('Scratch\\draft.md')).toBe(true);
    expect(createGlobMatcher('Scratch/*.md')('Scratch\\draft.md')).toBe(true);
  });

  it('supports basename matching for slash-less patterns', () => {
    const md = createGlobMatcher('*.md', { matchBase: true });
    expect(md('b.md')).toBe(true);
    expect(md('a/b.md')).toBe(true);
    expect(md('a/b.txt')).toBe(false);
    const literal = createGlobMatcher('*.md');
    expect(literal('a/b.md')).toBe(false);
  });

  it('handles unicode and spaces literally', () => {
    expect(createGlobMatcher('Private Notes/*.md')('Private Notes/秘密 文件.md')).toBe(true);
    expect(createGlobMatcher('笔记/**')('笔记/2026/今天.md')).toBe(true);
  });

  it('never matches the empty path', () => {
    expect(createGlobMatcher('**')('')).toBe(false);
    expect(createGlobMatcher('*')('')).toBe(false);
  });
});
