// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateInsightPath, cleanInsightContent, formatInsightMarkdown } from '@/components/ask/save-insight-utils';

describe('generateInsightPath', () => {
  it('generates a path with Inbox prefix and date slug', () => {
    const result = generateInsightPath('Some analysis about AI agents', new Date('2026-04-09'));
    expect(result).toBe('Inbox/insight-2026-04-09.md');
  });

  it('generates a consistent path format for any content', () => {
    const result = generateInsightPath('Short', new Date('2026-01-15'));
    expect(result).toBe('Inbox/insight-2026-01-15.md');
  });

  it('handles empty content gracefully', () => {
    const result = generateInsightPath('', new Date('2026-04-09'));
    expect(result).toBe('Inbox/insight-2026-04-09.md');
  });

  it('appends counter when path would collide with existing files', () => {
    const existing = new Set(['Inbox/insight-2026-04-09.md']);
    const result = generateInsightPath('content', new Date('2026-04-09'), existing);
    expect(result).toBe('Inbox/insight-2026-04-09-2.md');
  });

  it('increments counter for multiple collisions', () => {
    const existing = new Set([
      'Inbox/insight-2026-04-09.md',
      'Inbox/insight-2026-04-09-2.md',
    ]);
    const result = generateInsightPath('content', new Date('2026-04-09'), existing);
    expect(result).toBe('Inbox/insight-2026-04-09-3.md');
  });
});

describe('cleanInsightContent', () => {
  it('strips thinking tags from content', () => {
    const input = '<thinking>some reasoning</thinking>The actual answer is 42.';
    expect(cleanInsightContent(input)).toBe('The actual answer is 42.');
  });

  it('preserves normal markdown content', () => {
    const input = '# Title\n\nSome **bold** text and a [link](url).';
    expect(cleanInsightContent(input)).toBe(input);
  });

  it('returns empty string for content that is only thinking', () => {
    const input = '<thinking>all thinking</thinking>';
    expect(cleanInsightContent(input)).toBe('');
  });

  it('handles content with no thinking tags', () => {
    const input = 'Just regular text';
    expect(cleanInsightContent(input)).toBe('Just regular text');
  });

  it('trims whitespace after stripping', () => {
    const input = '<thinking>blah</thinking>  \n  Real content  ';
    expect(cleanInsightContent(input)).toBe('Real content');
  });
});

describe('formatInsightMarkdown', () => {
  it('wraps content with metadata header', () => {
    const result = formatInsightMarkdown('Analysis content here', new Date('2026-04-09T10:30:00Z'));
    expect(result).toContain('Analysis content here');
    expect(result).toContain('2026-04-09');
    expect(result).toMatch(/^> Saved from MindOS Ask/m);
  });

  it('handles multi-line content', () => {
    const content = '# Title\n\n- Point 1\n- Point 2';
    const result = formatInsightMarkdown(content, new Date('2026-04-09'));
    expect(result).toContain('- Point 1');
    expect(result).toContain('- Point 2');
  });

  it('produces valid markdown', () => {
    const result = formatInsightMarkdown('test', new Date('2026-04-09'));
    expect(result.startsWith('>')).toBe(true);
    expect(result).toContain('\n\ntest');
  });
});
