import { describe, expect, it } from 'vitest';
import { getMarkdownStyles, markdownStylesByVariant } from '@/lib/markdown-styles';

describe('markdown-styles', () => {
  it('exposes document and bubble variants', () => {
    expect(Object.keys(markdownStylesByVariant).sort()).toEqual(['bubble', 'document']);
  });

  it('returns stable style objects for each variant', () => {
    expect(getMarkdownStyles('document')).toBe(markdownStylesByVariant.document);
    expect(getMarkdownStyles('bubble')).toBe(markdownStylesByVariant.bubble);
  });

  it('defines core markdown keys for document variant', () => {
    const styles = getMarkdownStyles('document');
    expect(styles).toHaveProperty('body');
    expect(styles).toHaveProperty('heading1');
    expect(styles).toHaveProperty('code_inline');
    expect(styles).toHaveProperty('blockquote');
  });

  it('defines compact markdown keys for bubble variant', () => {
    const styles = getMarkdownStyles('bubble');
    expect(styles).toHaveProperty('body');
    expect(styles).toHaveProperty('code_inline');
    expect(styles).toHaveProperty('blockquote');
    expect(styles).toHaveProperty('link');
  });
});
