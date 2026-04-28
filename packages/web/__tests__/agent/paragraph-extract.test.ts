import { describe, it, expect } from 'vitest';
import { extractRelevantContent, splitParagraphs } from '@/lib/agent/paragraph-extract';

describe('splitParagraphs', () => {
  it('splits on double newlines', () => {
    const text = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3';
    expect(splitParagraphs(text)).toEqual(['Paragraph 1', 'Paragraph 2', 'Paragraph 3']);
  });

  it('handles empty string', () => {
    expect(splitParagraphs('')).toEqual([]);
  });

  it('handles single paragraph', () => {
    expect(splitParagraphs('Hello world')).toEqual(['Hello world']);
  });
});

describe('extractRelevantContent', () => {
  it('returns content unchanged if within limit', () => {
    const content = 'Short content';
    const { result, truncated } = extractRelevantContent(content, 1000);
    expect(result).toBe(content);
    expect(truncated).toBe(false);
  });

  it('truncates at paragraph boundary without query', () => {
    const content = 'A'.repeat(100) + '\n\n' + 'B'.repeat(100);
    const { result, truncated } = extractRelevantContent(content, 150);
    expect(truncated).toBe(true);
    expect(result).toContain('A'.repeat(100));
    expect(result).not.toContain('B'.repeat(100));
  });

  it('extracts query-relevant paragraphs', () => {
    const paragraphs = [
      '# Title\n\nThis is the intro.',
      'Paragraph about cats and dogs.',
      'Paragraph about deployment and servers.',
      'Another paragraph about cats playing.',
      'Final paragraph about nothing.',
    ];
    const content = paragraphs.join('\n\n');
    const { result } = extractRelevantContent(content, 200, 'cats');
    // Should include title (always) + cat paragraphs
    expect(result).toContain('Title');
    expect(result).toContain('cats');
  });

  it('preserves original order of extracted paragraphs', () => {
    const content = 'P1 intro\n\nP2 query match\n\nP3 filler\n\nP4 query match again';
    const { result } = extractRelevantContent(content, 100, 'query');
    const idx1 = result.indexOf('P1');
    const idx2 = result.indexOf('P2');
    if (idx1 !== -1 && idx2 !== -1) {
      expect(idx1).toBeLessThan(idx2);
    }
  });

  it('handles very long content with CJK query', () => {
    const intro = '# 知识管理系统';
    const filler = Array.from({ length: 50 }, (_, i) => `段落 ${i}: 一些无关的内容。`).join('\n\n');
    const target = '这是关于部署的重要段落。包含了服务器配置信息。';
    const content = intro + '\n\n' + filler + '\n\n' + target;
    const { result, truncated } = extractRelevantContent(content, 500, '部署');
    expect(truncated).toBe(true);
    expect(result).toContain('部署');
    expect(result).toContain('知识管理');
  });

  it('returns truncated flag when paragraphs are dropped', () => {
    const content = 'Short\n\n' + 'X'.repeat(200);
    const { truncated } = extractRelevantContent(content, 50, 'Short');
    expect(truncated).toBe(true);
  });
});
