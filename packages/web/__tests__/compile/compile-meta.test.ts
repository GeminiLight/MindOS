import { describe, it, expect } from 'vitest';
import {
  parseCompileMeta,
  stripCompileMeta,
  appendCompileMeta,
} from '@/lib/compile';

describe('parseCompileMeta', () => {
  it('parses valid compile metadata comment', () => {
    const content = '# Hello\n\nSome content\n\n<!-- mindos:compiled 2026-04-10T12:00:00Z files:25 -->\n';
    const meta = parseCompileMeta(content);
    expect(meta).toEqual({ timestamp: '2026-04-10T12:00:00Z', fileCount: 25 });
  });

  it('returns null for content without metadata', () => {
    const content = '# Hello\n\nNo metadata here.';
    expect(parseCompileMeta(content)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCompileMeta('')).toBeNull();
  });

  it('parses metadata with different file counts', () => {
    const content = '<!-- mindos:compiled 2026-01-01T00:00:00Z files:0 -->';
    const meta = parseCompileMeta(content);
    expect(meta).toEqual({ timestamp: '2026-01-01T00:00:00Z', fileCount: 0 });
  });

  it('parses metadata embedded in content', () => {
    const content = '# Title\n\nBody text.\n\n## Section\n\nMore text.\n\n<!-- mindos:compiled 2026-04-10T08:30:00.000Z files:42 -->\n';
    const meta = parseCompileMeta(content);
    expect(meta).toEqual({ timestamp: '2026-04-10T08:30:00.000Z', fileCount: 42 });
  });
});

describe('stripCompileMeta', () => {
  it('removes trailing compile metadata', () => {
    const content = '# Hello\n\nContent\n\n<!-- mindos:compiled 2026-04-10T12:00:00Z files:25 -->\n';
    const result = stripCompileMeta(content);
    // trimEnd in appendCompileMeta handles trailing whitespace, stripCompileMeta just removes the comment
    expect(result).not.toContain('mindos:compiled');
    expect(result.trim()).toBe('# Hello\n\nContent');
  });

  it('returns content unchanged when no metadata', () => {
    const content = '# Hello\n\nContent';
    expect(stripCompileMeta(content)).toBe(content);
  });

  it('handles empty string', () => {
    expect(stripCompileMeta('')).toBe('');
  });
});

describe('appendCompileMeta', () => {
  it('appends metadata to clean content', () => {
    const content = '# Hello\n\nContent';
    const result = appendCompileMeta(content, { timestamp: '2026-04-10T12:00:00Z', fileCount: 10 });
    expect(result).toBe('# Hello\n\nContent\n\n<!-- mindos:compiled 2026-04-10T12:00:00Z files:10 -->\n');
  });

  it('replaces existing metadata', () => {
    const content = '# Hello\n\nContent\n\n<!-- mindos:compiled 2026-01-01T00:00:00Z files:5 -->\n';
    const result = appendCompileMeta(content, { timestamp: '2026-04-10T12:00:00Z', fileCount: 20 });
    expect(result).toBe('# Hello\n\nContent\n\n<!-- mindos:compiled 2026-04-10T12:00:00Z files:20 -->\n');
  });

  it('handles content with trailing whitespace', () => {
    const content = '# Hello\n\nContent\n\n  ';
    const result = appendCompileMeta(content, { timestamp: '2026-04-10T12:00:00Z', fileCount: 3 });
    expect(result).toContain('<!-- mindos:compiled 2026-04-10T12:00:00Z files:3 -->');
  });
});
