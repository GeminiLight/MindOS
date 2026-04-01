import { describe, it, expect } from 'vitest';
import { estimateStringTokens } from '@/lib/agent/context';

describe('estimateStringTokens', () => {
  it('estimates pure ASCII at ~4 chars per token', () => {
    const text = 'Hello world, this is a test sentence.';
    const tokens = estimateStringTokens(text);
    // 37 chars / 4 = 9.25 → ceil = 10 tokens
    expect(tokens).toBe(10);
  });

  it('estimates pure CJK at ~1.5 tokens per char', () => {
    const text = '知识管理系统';
    const tokens = estimateStringTokens(text);
    // 6 CJK chars * 1.5 = 9 tokens
    expect(tokens).toBe(9);
  });

  it('handles mixed CJK and ASCII correctly', () => {
    const text = 'MindOS 知识管理';
    const tokens = estimateStringTokens(text);
    // "MindOS " = 7 ASCII chars → 7/4 = 1.75
    // "知识管理" = 4 CJK chars → 4 * 1.5 = 6
    // total = ceil(1.75 + 6) = 8
    expect(tokens).toBe(8);
  });

  it('returns 0 for empty string', () => {
    expect(estimateStringTokens('')).toBe(0);
  });

  it('estimates Japanese Hiragana as CJK', () => {
    const text = 'こんにちは';
    const tokens = estimateStringTokens(text);
    // 5 chars * 1.5 = 7.5 → ceil = 8
    expect(tokens).toBe(8);
  });

  it('estimates Korean Hangul as CJK', () => {
    const text = '안녕하세요';
    const tokens = estimateStringTokens(text);
    // 5 chars * 1.5 = 7.5 → ceil = 8
    expect(tokens).toBe(8);
  });

  it('is more accurate than naive length/4 for Chinese text', () => {
    const chineseText = '这是一个关于人工智能的知识库管理系统';
    const accurate = estimateStringTokens(chineseText);
    const naive = Math.ceil(chineseText.length / 4);
    // Naive: 17/4 = 5, Accurate: 17*1.5 = 26
    // Accurate should be much higher for pure CJK
    expect(accurate).toBeGreaterThan(naive * 3);
  });
});
