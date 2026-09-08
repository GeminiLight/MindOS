import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeMindosIgnoreFile } from '../search-ignore.js';
import { MindosSearchIndex, getMindosSearchIndex, resetMindosSearchIndexesForTests } from './index.js';

function seed(root: string, rel: string, content: string, mtimeSeconds?: number): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  if (mtimeSeconds !== undefined) utimesSync(abs, mtimeSeconds, mtimeSeconds);
}

describe('MindosSearchIndex', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-search-index-'));
    seed(root, 'Profile/Identity.md', '# My Identity\n\nI am a developer working on MindOS.');
    seed(root, 'Projects/TODO.md', '# TODO\n\n- Fix the bug\n- Add search feature');
    seed(root, 'Resources/data.csv', 'name,value\nfoo,bar\nbaz,qux');
    seed(root, 'Archive/old.md', 'This is archived content about search.');
  });

  afterEach(() => {
    resetMindosSearchIndexesForTests();
    rmSync(root, { recursive: true, force: true });
  });

  describe('refresh', () => {
    it('builds once and reports a hit while the tree version is unchanged', () => {
      const index = new MindosSearchIndex(root);
      expect(index.refresh({ treeVersion: 1 })).toEqual({ cacheState: 'built', deferred: [] });
      expect(index.getFileCount()).toBe(4);
      seed(root, 'Profile/Identity.md', 'silently changed');
      // Same tree version: trusts the caller, no stat walk.
      expect(index.refresh({ treeVersion: 1 }).cacheState).toBe('hit');
      expect(index.getContent('Profile/Identity.md')).toContain('developer');
      // New tree version: only the changed file is re-read.
      expect(index.refresh({ treeVersion: 2 }).cacheState).toBe('built');
      expect(index.getContent('Profile/Identity.md')).toBe('silently changed');
    });

    it('re-indexes only changed files and drops deleted ones without a hint', () => {
      const index = new MindosSearchIndex(root);
      index.refresh();
      expect(index.refresh().cacheState).toBe('hit');
      rmSync(join(root, 'Archive', 'old.md'));
      expect(index.refresh().cacheState).toBe('built');
      expect(index.getAllFiles()).not.toContain('Archive/old.md');
      expect(index.getFileCount()).toBe(3);
    });

    it('takes file stats from an injected listFiles source', () => {
      const listFiles = vi.fn(() => [{ path: 'Projects/TODO.md', mtime: 1, size: 1 }]);
      const index = new MindosSearchIndex(root, { listFiles });
      index.refresh();
      expect(listFiles).toHaveBeenCalledTimes(1);
      expect(index.getAllFiles()).toEqual(['Projects/TODO.md']);
    });

    it('only indexes text extensions and extractor-backed files', () => {
      seed(root, 'Notes/image.png', 'binary');
      seed(root, 'Notes/config.json', '{"needle": true}');
      const index = new MindosSearchIndex(root, { textExtensions: ['.md', '.csv'] });
      index.refresh();
      expect(index.getAllFiles()).toEqual(['Archive/old.md', 'Profile/Identity.md', 'Projects/TODO.md', 'Resources/data.csv']);
      const withJson = new MindosSearchIndex(root);
      withJson.refresh();
      expect(withJson.getAllFiles()).toContain('Notes/config.json');
    });

    it('applies shouldIndex, built-in ignored directories and .mindosignore rules', () => {
      seed(root, 'node_modules/pkg/index.md', 'dependency needle');
      seed(root, 'dist/generated.md', 'generated needle');
      seed(root, 'Private/secret.md', 'classified needle');
      seed(root, 'README.md', 'root readme needle');
      writeMindosIgnoreFile(root, ['Private/']);
      const index = new MindosSearchIndex(root, { shouldIndex: (path) => path !== 'README.md' });
      index.refresh();
      const files = index.getAllFiles();
      expect(files).not.toContain('node_modules/pkg/index.md');
      expect(files).not.toContain('dist/generated.md');
      expect(files).not.toContain('Private/secret.md');
      expect(files).not.toContain('README.md');
      expect(files).toContain('Projects/TODO.md');
    });

    it('defers extractor-backed files past the time budget and indexes them by path', () => {
      seed(root, 'docs-report.pdf', '%PDF-1.4 dummy');
      seed(root, 'docs-slides.pdf', '%PDF-1.4 dummy');
      const extract = vi.fn(() => 'pdfwombat extracted body');
      const index = new MindosSearchIndex(root, { extractors: { '.pdf': extract } });

      const result = index.refresh({}, { extractionBudgetMs: 0 });
      expect(result.deferred.sort()).toEqual(['docs-report.pdf', 'docs-slides.pdf']);
      expect(extract).not.toHaveBeenCalled();
      expect(index.search('pdfwombat')).toEqual([]);
      expect(index.getCandidates('docs')?.sort()).toEqual(['docs-report.pdf', 'docs-slides.pdf']);

      for (const pdf of result.deferred) expect(index.updateFile(pdf)).toBe('indexed');
      expect(extract).toHaveBeenCalledTimes(2);
      expect(index.search('pdfwombat').map((hit) => hit.path).sort()).toEqual(['docs-report.pdf', 'docs-slides.pdf']);
      // Fully indexed now: another refresh must not re-extract.
      index.markStale();
      index.refresh();
      expect(extract).toHaveBeenCalledTimes(2);
    });

    it('drops extractor-backed files whose extraction fails or is empty', () => {
      seed(root, 'broken.pdf', '%PDF-1.4');
      seed(root, 'empty.pdf', '%PDF-1.4');
      const index = new MindosSearchIndex(root, {
        extractors: {
          '.pdf': (abs) => {
            if (abs.endsWith('broken.pdf')) throw new Error('corrupt');
            return '';
          },
        },
      });
      index.refresh();
      expect(index.getAllFiles()).not.toContain('broken.pdf');
      expect(index.getAllFiles()).not.toContain('empty.pdf');
      expect(index.getFileCount()).toBe(4);
    });
  });

  describe('incremental updates', () => {
    it('updateFile re-indexes a modified file and maintains stats', () => {
      const index = new MindosSearchIndex(root);
      index.refresh();
      expect(index.getCandidates('quantum')).toEqual([]);
      const oldLength = index.getDocLength('Profile/Identity.md');

      seed(root, 'Profile/Identity.md', 'I study quantum computing.');
      expect(index.updateFile('Profile/Identity.md')).toBe('indexed');
      expect(index.getCandidates('quantum')).toEqual(['Profile/Identity.md']);
      expect(index.getCandidates('developer')).toEqual([]);
      expect(index.getDocLength('Profile/Identity.md')).toBe('I study quantum computing.'.length);
      expect(index.getDocLength('Profile/Identity.md')).not.toBe(oldLength);
      expect(index.getFileCount()).toBe(4);
      expect(index.getCandidates('search')).toContain('Projects/TODO.md');
    });

    it('updateFile adds new files, removes vanished or ignored ones, and skips unknown paths', () => {
      const index = new MindosSearchIndex(root);
      index.refresh();
      seed(root, 'Notes/fresh.md', 'brand new blockchain content');
      expect(index.updateFile('Notes/fresh.md')).toBe('indexed');
      expect(index.getFileCount()).toBe(5);
      expect(index.getAllFiles()).toContain('Notes/fresh.md');

      rmSync(join(root, 'Notes', 'fresh.md'));
      expect(index.updateFile('Notes/fresh.md')).toBe('removed');
      expect(index.getFileCount()).toBe(4);

      seed(root, 'node_modules/pkg/index.md', 'dependency blockchain');
      expect(index.updateFile('node_modules/pkg/index.md')).toBe('skipped');
      expect(index.updateFile('never/indexed.md')).toBe('skipped');
      expect(index.getFileCount()).toBe(4);

      writeMindosIgnoreFile(root, ['Archive/']);
      expect(index.updateFile('Archive/old.md')).toBe('removed');
      expect(index.getCandidates('archived')).toEqual([]);
    });

    it('updateFile refuses paths that escape the root through symlinks', () => {
      const outside = mkdtempSync(join(tmpdir(), 'mindos-search-outside-'));
      try {
        writeFileSync(join(outside, 'leak.md'), 'leaked secret', 'utf-8');
        const { symlinkSync } = require('node:fs') as typeof import('node:fs');
        symlinkSync(join(outside, 'leak.md'), join(root, 'Profile', 'leak.md'), 'file');
        const index = new MindosSearchIndex(root);
        index.refresh();
        expect(index.updateFile('Profile/leak.md')).toBe('skipped');
        expect(index.getCandidates('leaked')).toEqual([]);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('removePath removes a file or a whole directory prefix without name-prefix false positives', () => {
      seed(root, 'Projects/Sub/inner.md', 'nested submarine content');
      seed(root, 'Projects-extra/other.md', 'prefix collision content');
      const index = new MindosSearchIndex(root);
      index.refresh();

      expect(index.removePath('Archive/old.md')).toEqual(['Archive/old.md']);
      expect(index.removePath('Projects').sort()).toEqual(['Projects/Sub/inner.md', 'Projects/TODO.md']);
      expect(index.getCandidates('submarine')).toEqual([]);
      expect(index.getCandidates('collision')).toEqual(['Projects-extra/other.md']);
      expect(index.removePath('missing')).toEqual([]);
      expect(index.getFileCount()).toBe(3);
    });

    it('invalidate drops everything and markStale forces a stat walk', () => {
      const index = new MindosSearchIndex(root);
      index.refresh({ treeVersion: 7 });
      index.invalidate();
      expect(index.isBuilt()).toBe(false);
      expect(index.getFileCount()).toBe(0);
      expect(index.getCandidates('search')).toEqual([]);
      expect(index.refresh({ treeVersion: 7 }).cacheState).toBe('built');
      index.markStale();
      expect(index.refresh({ treeVersion: 7 }).cacheState).toBe('hit');
    });
  });

  describe('search', () => {
    it('returns BM25-ranked hits with snippets and honours limit / scope / file_type', () => {
      const index = new MindosSearchIndex(root);
      const all = index.search('search');
      expect(all.map((hit) => hit.path).sort()).toEqual(['Archive/old.md', 'Projects/TODO.md']);
      expect(all[0]!.snippet.toLowerCase()).toContain('search');
      expect(all[0]!.score).toBeGreaterThan(0);
      expect(all[0]!.occurrences).toBeGreaterThan(0);

      expect(index.search('search', { limit: 1 })).toHaveLength(1);
      expect(index.search('search', { scope: 'Projects/' }).map((hit) => hit.path)).toEqual(['Projects/TODO.md']);
      expect(index.search('search', { scope: 'Projects' }).map((hit) => hit.path)).toEqual(['Projects/TODO.md']);
      expect(index.search('foo', { file_type: 'csv' }).map((hit) => hit.path)).toEqual(['Resources/data.csv']);
      expect(index.search('foo', { file_type: 'md' })).toEqual([]);
    });

    it('filters by modified_after using cached stats and returns [] for blank queries', () => {
      seed(root, 'Archive/old.md', 'This is archived content about search.', 1_600_000_000);
      const index = new MindosSearchIndex(root);
      expect(index.search('search', { modified_after: '2099-01-01T00:00:00Z' })).toEqual([]);
      const recent = index.search('search', { modified_after: '2021-01-01T00:00:00Z' }).map((hit) => hit.path);
      expect(recent).toEqual(['Projects/TODO.md']);
      expect(index.search('search', { modified_after: 'not a date' })).toHaveLength(2);
      expect(index.search('')).toEqual([]);
      expect(index.search('   ')).toEqual([]);
      expect(index.search('search', { limit: 0 })).toEqual([]);
    });

    it('answers single-character and unicode queries without the inverted index', () => {
      seed(root, 'Notes/single.md', 'a b c');
      seed(root, 'Notes/笔记.md', '量子计算研究进展 🚀');
      const index = new MindosSearchIndex(root);
      expect(index.getCandidates('a')).toBeNull();
      expect(index.search('a').map((hit) => hit.path)).toContain('Notes/single.md');
      expect(index.search('量子').map((hit) => hit.path)).toEqual(['Notes/笔记.md']);
      expect(index.search('xyznonexistent')).toEqual([]);
    });

    it('ranks rare terms and shorter documents higher', () => {
      seed(root, 'Notes/common.md', 'search is a common search feature for search');
      seed(root, 'Notes/rare.md', 'search and CRDT algorithms are interesting');
      seed(root, 'Notes/short.md', 'The algorithm works well.');
      seed(root, 'Notes/long.md', `The algorithm ${'uses many words to describe things. '.repeat(50)}`);
      const index = new MindosSearchIndex(root);
      expect(index.search('CRDT').map((hit) => hit.path)).toEqual(['Notes/rare.md']);
      expect(index.search('algorithm')[0]!.path).toBe('Notes/short.md');
      const multi = index.search('vector search');
      expect(multi.length).toBeGreaterThan(0);
    });
  });

  describe('registry', () => {
    it('shares one instance per resolved root', () => {
      const a = getMindosSearchIndex(root);
      const b = getMindosSearchIndex(`${root}/`);
      expect(a).toBe(b);
      expect(a.mindRoot).toBe(root);
    });
  });
});
