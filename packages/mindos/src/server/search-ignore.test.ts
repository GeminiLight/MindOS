import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCachedMindosSearchIgnoreMatcher,
  createMindosIgnoreRuleMatcher,
  createMindosSearchIgnoreMatcher,
  normalizeSearchIgnoredPaths,
  parseMindosIgnoreContent,
  writeMindosIgnoreFile,
} from './search-ignore.js';

const IGNORED_DIRS = new Set(['.git', 'node_modules']);

describe('.mindosignore rule matching', () => {
  const match = (rules: string[]) => createMindosIgnoreRuleMatcher(IGNORED_DIRS, rules);

  it('always excludes built-in ignored directory segments', () => {
    const isIgnored = match([]);
    expect(isIgnored('node_modules/pkg/index.md')).toBe(true);
    expect(isIgnored('Space/.git/config')).toBe(true);
    expect(isIgnored('Space/note.md')).toBe(false);
    expect(isIgnored('')).toBe(false);
    expect(isIgnored('.')).toBe(false);
  });

  it('matches plain names as any path segment and slash paths as prefixes', () => {
    const isIgnored = match(['Archive', 'Private Notes/2026']);
    expect(isIgnored('Archive/old.md')).toBe(true);
    expect(isIgnored('Space/Archive/old.md')).toBe(true);
    expect(isIgnored('Archived/old.md')).toBe(false);
    expect(isIgnored('Private Notes/2026/secret.md')).toBe(true);
    expect(isIgnored('Private Notes/2026')).toBe(true);
    expect(isIgnored('Private Notes/2025/ok.md')).toBe(false);
    expect(isIgnored('Other/Private Notes/2026/x.md')).toBe(false);
  });

  it('matches globs with **, *, ?, character classes and basename semantics', () => {
    const isIgnored = match(['Scratch/*.md', 'Drafts/**', '*.tmp', 'draft?.md', '[ab].md', 'a/**/b.md']);
    expect(isIgnored('Scratch/draft.md')).toBe(true);
    expect(isIgnored('Scratch/sub/draft.md')).toBe(false);
    expect(isIgnored('Drafts')).toBe(true);
    expect(isIgnored('Drafts/x/y.md')).toBe(true);
    expect(isIgnored('deep/dir/file.tmp')).toBe(true);
    expect(isIgnored('deep/dir/file.tmp.md')).toBe(false);
    expect(isIgnored('draft1.md')).toBe(true);
    expect(isIgnored('draft12.md')).toBe(false);
    expect(isIgnored('a.md')).toBe(true);
    expect(isIgnored('c.md')).toBe(false);
    expect(isIgnored('a/b.md')).toBe(true);
    expect(isIgnored('a/x/y/b.md')).toBe(true);
  });

  it('normalizes separators, leading ./ and trailing slashes on both sides', () => {
    const isIgnored = match(['./Archive/', '/Scratch/*.md']);
    expect(isIgnored('Archive\\old.md')).toBe(true);
    expect(isIgnored('/Scratch/draft.md')).toBe(true);
    expect(isIgnored('Scratch/draft.md/')).toBe(true);
  });

  it('handles unicode and emoji paths literally', () => {
    const isIgnored = match(['笔记/私密', '🚀/*.md']);
    expect(isIgnored('笔记/私密/x.md')).toBe(true);
    expect(isIgnored('笔记/公开/x.md')).toBe(false);
    expect(isIgnored('🚀/launch.md')).toBe(true);
  });
});

describe('rule normalization', () => {
  it('drops comments, negations, unsafe paths and duplicates', () => {
    expect(parseMindosIgnoreContent([
      '# generated folders',
      'Archive/',
      './Archive',
      '../outside',
      '!Archive',
      'Scratch/*.md',
      'a/../b',
      '',
      '   ',
    ].join('\n'))).toEqual(['Archive', 'Scratch/*.md']);
    expect(normalizeSearchIgnoredPaths(['x', 42, null, 'x'])).toEqual(['x']);
    expect(normalizeSearchIgnoredPaths('not-an-array')).toEqual([]);
  });
});

describe('file-backed matchers', () => {
  const roots: string[] = [];

  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  function makeRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'mindos-search-ignore-'));
    roots.push(root);
    return root;
  }

  it('reads .mindosignore plus extra rules', () => {
    const root = makeRoot();
    writeMindosIgnoreFile(root, ['Archive/']);
    const isIgnored = createMindosSearchIgnoreMatcher(root, IGNORED_DIRS, ['Scratch']);
    expect(isIgnored('Archive/old.md')).toBe(true);
    expect(isIgnored('Scratch/draft.md')).toBe(true);
    expect(isIgnored('Visible/real.md')).toBe(false);
  });

  it('caches the matcher per root until the ignore file changes', () => {
    const root = makeRoot();
    const first = createCachedMindosSearchIgnoreMatcher(root, IGNORED_DIRS);
    expect(createCachedMindosSearchIgnoreMatcher(root, IGNORED_DIRS)).toBe(first);
    expect(first('Archive/old.md')).toBe(false);

    writeFileSync(join(root, '.mindosignore'), 'Archive/\n');
    const second = createCachedMindosSearchIgnoreMatcher(root, IGNORED_DIRS);
    expect(second).not.toBe(first);
    expect(second('Archive/old.md')).toBe(true);
  });
});
