import { describe, it, expect } from 'vitest';
import { estimateStringTokens } from '../../lib/agent/context';

describe('Context estimation', () => {
  describe('estimateStringTokens', () => {
    it('estimates ASCII text tokens (~0.25 per char)', () => {
      const text = 'Hello, this is a test sentence with some words.';
      const tokens = estimateStringTokens(text);
      // ~48 chars → ~12 tokens
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(25);
    });

    it('estimates CJK text tokens (~1.5 per char)', () => {
      const text = '你好世界这是测试';
      const tokens = estimateStringTokens(text);
      // 8 CJK chars → ~12 tokens
      expect(tokens).toBeGreaterThan(8);
      expect(tokens).toBeLessThan(20);
    });

    it('handles mixed CJK and ASCII', () => {
      const text = 'Hello 你好 World 世界';
      const tokens = estimateStringTokens(text);
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(20);
    });

    it('returns 0 for empty string', () => {
      expect(estimateStringTokens('')).toBe(0);
    });

    it('estimates a typical system prompt size', () => {
      // Simulate a moderate system prompt
      const prompt = 'You are a helpful assistant.\n'.repeat(100);
      const tokens = estimateStringTokens(prompt);
      // ~2800 chars → ~700 tokens
      expect(tokens).toBeGreaterThan(500);
      expect(tokens).toBeLessThan(1000);
    });

    it('estimates large content (20K chars) reasonably', () => {
      const large = 'a'.repeat(20_000);
      const tokens = estimateStringTokens(large);
      // 20000 ASCII chars → ~5000 tokens
      expect(tokens).toBeGreaterThanOrEqual(4000);
      expect(tokens).toBeLessThanOrEqual(6000);
    });
  });
});
