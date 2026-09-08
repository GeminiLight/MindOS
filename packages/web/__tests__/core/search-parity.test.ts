import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { searchFiles } from '@/lib/core/search';
import fixture from '../../../mindos/src/server/search/__fixtures__/search-parity.json';

/**
 * The Web adapter must reproduce what the pre-consolidation Web search index
 * returned for the same corpus (same fixture the core package verifies), which
 * also proves the Web configuration — `.md`/`.csv` only, root system files and
 * `node_modules` excluded — matches the old behaviour.
 */

const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

describe('Web search parity with the pre-consolidation implementation', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    for (const [rel, content] of Object.entries(fixture.files)) seedFile(mindRoot, rel, content);
  });

  afterEach(() => {
    cleanupMindRoot(mindRoot);
  });

  it('returns the same hits, scores, occurrences and snippets for every parity query', () => {
    if (!hasSegmenter || !fixture.segmenter) return;
    for (const [query, expected] of Object.entries(fixture.queries)) {
      const actual = [...searchFiles(mindRoot, query)]
        .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path));
      expect(actual.map((r) => r.path), query).toEqual(expected.results.map((r) => r.path));
      actual.forEach((hit, i) => {
        expect(hit.score, `${query} → ${hit.path}`).toBeCloseTo(expected.results[i]!.score, 9);
        expect(hit.occurrences, `${query} → ${hit.path}`).toBe(expected.results[i]!.occurrences);
        expect(hit.snippet, `${query} → ${hit.path}`).toBe(expected.results[i]!.snippet);
      });
    }
  });

  it('never returns the root README or ignored directories', () => {
    expect(fs.existsSync(path.join(mindRoot, 'README.md'))).toBe(true);
    expect(searchFiles(mindRoot, 'rootsystem')).toEqual([]);
    expect(searchFiles(mindRoot, 'needle')).toEqual([]);
  });
});
