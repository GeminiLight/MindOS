/**
 * Search tokenizer shared by the product search index (standalone server and
 * Web). Moved from `packages/web/lib/core/search-index.ts` so both runtimes
 * segment CJK text the same way.
 *
 * Latin/ASCII: split on non-alphanumeric characters, lowercased; single Latin
 *   characters are noise and excluded.
 * CJK: `Intl.Segmenter('zh', { granularity: 'word' })` for proper word
 *   boundaries ("知识管理" → ["知识", "管理"]) plus every CJK character as a
 *   unigram so single-character queries still resolve. Falls back to
 *   bigrams + unigrams when `Intl.Segmenter` is unavailable.
 * Mixed text: both strategies applied, tokens merged.
 */

/** CJK ranges: Han, Hiragana, Katakana, Hangul syllables. Stateless (no /g). */
export const CJK_CHAR_REGEX = /[一-鿿぀-ゟ゠-ヿ가-힯]/;

const zhSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh', { granularity: 'word' })
  : null;

export function hasCjkWordSegmenter(): boolean {
  return zhSegmenter !== null;
}

export function tokenizeSearchText(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  const words = lower.match(/[a-z0-9_$@#]+/g);
  if (words) {
    for (const word of words) {
      if (word.length >= 2) tokens.add(word);
    }
  }

  if (CJK_CHAR_REGEX.test(lower)) {
    if (zhSegmenter) {
      for (const { segment, isWordLike } of zhSegmenter.segment(lower)) {
        if (!isWordLike) continue;
        const word = segment.trim();
        if (!word) continue;
        tokens.add(word);
        for (const ch of word) {
          if (CJK_CHAR_REGEX.test(ch)) tokens.add(ch);
        }
      }
    } else {
      tokenizeCjkBigrams(lower, tokens);
    }
  }

  return tokens;
}

/** Fallback CJK tokenizer: bigrams + unigrams over each CJK run. Exported for tests. */
export function tokenizeCjkBigrams(lower: string, tokens: Set<string> = new Set()): Set<string> {
  const run: string[] = [];
  const flush = () => {
    for (let i = 0; i < run.length; i += 1) {
      tokens.add(run[i]!);
      if (i + 1 < run.length) tokens.add(run[i]! + run[i + 1]!);
    }
    run.length = 0;
  };
  for (const ch of lower) {
    if (CJK_CHAR_REGEX.test(ch)) run.push(ch);
    else if (run.length > 0) flush();
  }
  if (run.length > 0) flush();
  return tokens;
}

/**
 * Split a query into the terms scored independently by BM25: the whole
 * lowercased query, each whitespace-separated part, and every index token.
 */
export function splitSearchQueryTerms(query: string): string[] {
  const lower = query.toLowerCase().trim();
  if (!lower) return [];
  const terms = new Set<string>();
  terms.add(lower);
  for (const term of lower.split(/\s+/)) {
    if (term.length > 0) terms.add(term);
  }
  for (const token of tokenizeSearchText(lower)) {
    if (token.length > 0) terms.add(token);
  }
  return [...terms];
}
