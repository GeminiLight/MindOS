import { CJK_CHAR_REGEX } from './tokenizer.js';

/* ── BM25 parameters ── */
const BM25_K1 = 1.2; // term-frequency saturation
const BM25_B = 0.75; // document-length normalisation

/**
 * BM25 score for one term in one document.
 *
 * @param tf           raw term frequency in the document
 * @param df           number of documents containing the term
 * @param docLength    document length in characters
 * @param avgDocLength average document length across the corpus
 * @param totalDocs    corpus size
 */
export function bm25Score(
  tf: number,
  df: number,
  docLength: number,
  avgDocLength: number,
  totalDocs: number,
): number {
  if (tf === 0 || totalDocs === 0 || avgDocLength === 0) return 0;
  // The +1 keeps IDF positive for terms present in more than half the corpus.
  const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
  const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docLength / avgDocLength));
  return idf * tfNorm;
}

/**
 * Count occurrences of a term. Latin terms use `\b` word boundaries; CJK terms
 * are counted as substrings (CJK has no word boundaries in JS regexes).
 * Compiled expressions are cached per term with a bounded size.
 */
const termRegexCache = new Map<string, RegExp>();

function termRegex(term: string): RegExp {
  let cached = termRegexCache.get(term);
  if (cached) return cached;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cached = CJK_CHAR_REGEX.test(term)
    ? new RegExp(escaped, 'g')
    : new RegExp(`\\b${escaped}\\b`, 'g');
  if (termRegexCache.size > 500) termRegexCache.clear();
  termRegexCache.set(term, cached);
  return cached;
}

export function countTermOccurrences(term: string, lowerText: string): number {
  const regex = termRegex(term);
  regex.lastIndex = 0;
  const matches = lowerText.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Paragraph-aware snippet around the first match: expand to the enclosing
 * blank-line boundaries but never more than 200 characters on either side,
 * with `...` markers when the snippet is cut.
 */
export function buildSearchSnippet(content: string, anchor: number, queryLength: number): string {
  let start = content.lastIndexOf('\n\n', anchor);
  if (start === -1) start = Math.max(0, anchor - 200);
  else start += 2;

  let end = content.indexOf('\n\n', anchor);
  if (end === -1) end = Math.min(content.length, anchor + queryLength + 200);

  if (anchor - start > 200) start = anchor - 200;
  if (end - anchor > 200) end = anchor + queryLength + 200;

  let snippet = content.slice(start, end).trim();
  snippet = snippet.replace(/\n{3,}/g, '\n\n');
  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet += '...';
  return snippet;
}

export type ScoredSearchHit = { path: string; snippet: string; score: number; occurrences: number };

/** Insert into a score-descending top-N list; equal scores keep insertion order. */
export function insertTopSearchHit<T extends { score: number }>(results: T[], result: T, limit: number): void {
  if (results.length === limit && result.score <= results[results.length - 1]!.score) return;
  let insertAt = results.length;
  while (insertAt > 0 && results[insertAt - 1]!.score < result.score) insertAt -= 1;
  results.splice(insertAt, 0, result);
  if (results.length > limit) results.length = limit;
}
