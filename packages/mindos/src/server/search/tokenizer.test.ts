import { describe, expect, it } from 'vitest';
import {
  CJK_CHAR_REGEX,
  hasCjkWordSegmenter,
  splitSearchQueryTerms,
  tokenizeCjkBigrams,
  tokenizeSearchText,
} from './tokenizer.js';
import fixture from './__fixtures__/search-parity.json';

const sorted = (tokens: Iterable<string>) => [...tokens].sort();

describe('tokenizeSearchText', () => {
  it('lowercases Latin words and drops single characters', () => {
    expect(sorted(tokenizeSearchText('Hello World a B'))).toEqual(['hello', 'world']);
    expect(sorted(tokenizeSearchText('a b c'))).toEqual([]);
  });

  it('keeps $ @ # and _ inside Latin tokens', () => {
    expect(sorted(tokenizeSearchText('NLP_v2 $100 test@example.com #tag'))).toEqual(['#tag', '$100', 'com', 'nlp_v2', 'test@example']);
  });

  it('segments CJK words and always adds unigrams', () => {
    const tokens = tokenizeSearchText('知识管理系统');
    expect(tokens.has('知')).toBe(true);
    expect(tokens.has('识')).toBe(true);
    expect(tokens.has('知识')).toBe(true);
    if (hasCjkWordSegmenter()) {
      // Intl.Segmenter: no cross-word bigram such as 识管.
      expect(tokens.has('识管')).toBe(false);
    }
  });

  it('handles mixed scripts, emoji and empty input', () => {
    const tokens = tokenizeSearchText('MindOS 是一款知识管理工具 🚀');
    expect(tokens.has('mindos')).toBe(true);
    expect(tokens.has('知识')).toBe(true);
    expect(tokens.has('🚀')).toBe(false);
    expect(tokenizeSearchText('').size).toBe(0);
    expect(tokenizeSearchText('🚀 🎉').size).toBe(0);
  });

  it('matches the pre-consolidation Web tokenizer on the parity samples', () => {
    if (!hasCjkWordSegmenter() || !fixture.segmenter) return;
    for (const [sample, expected] of Object.entries(fixture.tokens)) {
      expect(sorted(tokenizeSearchText(sample)), sample).toEqual(expected);
    }
  });
});

describe('tokenizeCjkBigrams (fallback)', () => {
  it('emits unigrams plus adjacent bigrams per CJK run', () => {
    expect(sorted(tokenizeCjkBigrams('知识管理'))).toEqual(['理', '知', '知识', '管', '管理', '识', '识管']);
    expect(sorted(tokenizeCjkBigrams('知识 管理'))).toEqual(['理', '知', '知识', '管', '管理', '识']);
    expect(sorted(tokenizeCjkBigrams('abc'))).toEqual([]);
  });
});

describe('splitSearchQueryTerms', () => {
  it('returns the whole query, whitespace parts and tokens once each', () => {
    expect(splitSearchQueryTerms('  Search Feature ')).toEqual(['search feature', 'search', 'feature']);
    expect(splitSearchQueryTerms('')).toEqual([]);
    expect(splitSearchQueryTerms('a')).toEqual(['a']);
    const cjk = splitSearchQueryTerms('知识管理');
    expect(cjk[0]).toBe('知识管理');
    expect(cjk).toContain('知识');
  });
});

describe('CJK_CHAR_REGEX', () => {
  it('covers Han, Hiragana, Katakana and Hangul', () => {
    for (const ch of ['知', 'ひ', 'カ', '한']) expect(CJK_CHAR_REGEX.test(ch)).toBe(true);
    for (const ch of ['a', '1', '🚀', ' ']) expect(CJK_CHAR_REGEX.test(ch)).toBe(false);
  });
});
