import { describe, expect, it } from 'vitest';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';
import type { SearchResultContainer } from '@/lib/obsidian-compat/types';
import { analyzePluginCompatibility } from '@/lib/obsidian-compat/compatibility-report';

function container(score: number): SearchResultContainer {
  return { match: { score, matches: [] } };
}

describe('Obsidian sortSearchResults compatibility', () => {
  it('sorts containers by descending match score in place', () => {
    const { sortSearchResults } = createObsidianModule();
    const results = [container(3), container(10), container(7)];
    sortSearchResults(results);
    expect(results.map(result => result.match.score)).toEqual([10, 7, 3]);
  });

  it('keeps stable ordering for equal scores', () => {
    const { sortSearchResults } = createObsidianModule();
    const first = container(5);
    const second = container(5);
    const third = container(5);
    const results = [first, second, third];
    sortSearchResults(results);
    expect(results[0]).toBe(first);
    expect(results[1]).toBe(second);
    expect(results[2]).toBe(third);
  });

  it('handles empty arrays and missing match objects without throwing', () => {
    const { sortSearchResults } = createObsidianModule();
    expect(() => sortSearchResults([])).not.toThrow();
    const sparse = [{}, container(1)] as SearchResultContainer[];
    expect(() => sortSearchResults(sparse)).not.toThrow();
    // The usable entry surfaces first; the matchless entry sinks to the end.
    expect(sparse[0].match.score).toBe(1);
    expect(sparse[1].match).toBeUndefined();
  });

  it('classifies sortSearchResults as a supported API', () => {
    const report = analyzePluginCompatibility('const { sortSearchResults } = require("obsidian"); sortSearchResults(r);');
    expect(report.obsidianApis).toContain('sortSearchResults');
    expect(report.unsupportedApis).not.toContain('sortSearchResults');
  });
});
