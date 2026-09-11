/**
 * Obsidian Plugin Compatibility - search result helpers.
 */

import type { SearchResultContainer } from '../types';

/**
 * Sort search result containers by descending match score, in place.
 * Entries without a usable match object keep their relative position.
 */
export function sortSearchResults(results: SearchResultContainer[]): void {
  if (!Array.isArray(results)) return;
  const scored = results.map((entry, index) => ({
    index,
    score: typeof entry?.match?.score === 'number' && Number.isFinite(entry.match.score) ? entry.match.score : -Infinity,
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const original = [...results];
  scored.forEach((entry, position) => {
    results[position] = original[entry.index];
  });
}
