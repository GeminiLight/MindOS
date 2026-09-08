import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindosSearchIndex, type MindosSearchHit } from './index.js';
import { hasCjkWordSegmenter } from './tokenizer.js';
import fixture from './__fixtures__/search-parity.json';

/**
 * Parity contract: the consolidated core index must return what the previous
 * Web implementation (`packages/web/lib/core/search-index.ts` + `search.ts`)
 * returned for the same corpus. The fixture was generated against the old code
 * before it was deleted; regenerate only with an explicit decision to change
 * ranking behaviour.
 */

const ROOT_SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md', 'CONFIG.json', 'CHANGELOG.md']);

type FixtureHit = { path: string; score: number; occurrences: number; snippet: string };

function normalize(results: MindosSearchHit[]): FixtureHit[] {
  return [...results]
    .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
    .map((r) => ({ path: r.path, score: r.score, occurrences: r.occurrences, snippet: r.snippet }));
}

function webLikeIndex(root: string): MindosSearchIndex {
  return new MindosSearchIndex(root, {
    textExtensions: ['.md', '.csv'],
    shouldIndex: (path) => !(ROOT_SYSTEM_FILES.has(path) && !path.includes('/')),
  });
}

describe('search parity with the pre-consolidation Web index', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-search-parity-'));
    for (const [rel, content] of Object.entries(fixture.files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('indexes the same file set and average document length', () => {
    const index = webLikeIndex(root);
    index.refresh();
    expect([...index.getAllFiles()].sort()).toEqual([...fixture.indexedFiles].sort());
    expect(index.getAvgDocLength()).toBeCloseTo(fixture.avgDocLength, 9);
  });

  it('returns the same hits, scores, occurrences and snippets for every parity query', () => {
    if (!hasCjkWordSegmenter() || !fixture.segmenter) return;
    const index = webLikeIndex(root);
    for (const [query, expected] of Object.entries(fixture.queries)) {
      const actual = normalize(index.search(query));
      expect(actual.map((r) => r.path), query).toEqual(expected.results.map((r) => r.path));
      for (let i = 0; i < actual.length; i += 1) {
        expect(actual[i]!.score, `${query} → ${actual[i]!.path} score`).toBeCloseTo(expected.results[i]!.score, 9);
        expect(actual[i]!.occurrences, `${query} → ${actual[i]!.path} occurrences`).toBe(expected.results[i]!.occurrences);
        expect(actual[i]!.snippet, `${query} → ${actual[i]!.path} snippet`).toBe(expected.results[i]!.snippet);
      }
    }
  });

  it('produces the same intersection and union candidates', () => {
    if (!hasCjkWordSegmenter() || !fixture.segmenter) return;
    const index = webLikeIndex(root);
    index.refresh();
    for (const [query, expected] of Object.entries(fixture.queries)) {
      const candidates = index.getCandidates(query);
      const union = index.getCandidatesUnion(query);
      expect(candidates ? [...candidates].sort() : null, `${query} candidates`).toEqual(expected.candidates);
      expect(union ? [...union].sort() : null, `${query} union`).toEqual(expected.union);
    }
  });
});
