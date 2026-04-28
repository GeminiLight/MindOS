import { describe, it, expect } from 'vitest';
import {
  convertToMarkdown,
  sanitizeFileName,
  titleFromFileName,
  ALLOWED_IMPORT_EXTENSIONS,
} from '@/lib/core/file-convert';

describe('sanitizeFileName', () => {
  it('strips path traversal sequences', () => {
    expect(sanitizeFileName('../../etc/passwd')).not.toContain('..');
  });

  it('strips leading slashes', () => {
    expect(sanitizeFileName('/etc/passwd.md')).toBe('passwd.md');
  });

  it('replaces unsafe characters with dashes', () => {
    expect(sanitizeFileName('file:name*test?.md')).toBe('file-name-test-.md');
  });

  it('collapses multiple dashes', () => {
    expect(sanitizeFileName('a---b.md')).toBe('a-b.md');
  });

  it('returns fallback for empty input', () => {
    expect(sanitizeFileName('')).toBe('imported-file');
  });

  it('preserves emoji and unicode', () => {
    const result = sanitizeFileName('🎯 Focus.md');
    expect(result).toContain('🎯');
    expect(result).toContain('.md');
  });

  it('handles backslash paths', () => {
    expect(sanitizeFileName('C:\\Users\\docs\\file.md')).toBe('file.md');
  });
});

describe('titleFromFileName', () => {
  it('derives title from hyphenated filename', () => {
    expect(titleFromFileName('meeting-notes.md')).toBe('Meeting Notes');
  });

  it('derives title from underscored filename', () => {
    expect(titleFromFileName('my_document.txt')).toBe('My Document');
  });

  it('handles filename without extension', () => {
    expect(titleFromFileName('readme')).toBe('Readme');
  });

  it('returns Untitled for truly empty stem', () => {
    expect(titleFromFileName('')).toBe('Untitled');
  });
});

describe('ALLOWED_IMPORT_EXTENSIONS', () => {
  it('includes all expected extensions', () => {
    const expected = ['.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.pdf'];
    for (const ext of expected) {
      expect(ALLOWED_IMPORT_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('does not include unsupported extensions', () => {
    expect(ALLOWED_IMPORT_EXTENSIONS.has('.exe')).toBe(false);
    expect(ALLOWED_IMPORT_EXTENSIONS.has('.zip')).toBe(false);
  });
});

describe('convertToMarkdown', () => {
  it('passes through .md files unchanged', () => {
    const result = convertToMarkdown('notes.md', '# Hello\n\nContent');
    expect(result.content).toBe('# Hello\n\nContent');
    expect(result.targetName).toBe('notes.md');
    expect(result.originalName).toBe('notes.md');
  });

  it('passes through .markdown files unchanged', () => {
    const result = convertToMarkdown('doc.markdown', '# Doc');
    expect(result.content).toBe('# Doc');
    expect(result.targetName).toBe('doc.markdown');
  });

  it('converts .txt to markdown with title', () => {
    const result = convertToMarkdown('meeting-notes.txt', 'Some text');
    expect(result.content).toContain('# Meeting Notes');
    expect(result.content).toContain('Some text');
    expect(result.targetName).toBe('meeting-notes.md');
  });

  it('keeps .csv format as-is', () => {
    const result = convertToMarkdown('data.csv', 'a,b,c\n1,2,3');
    expect(result.content).toBe('a,b,c\n1,2,3');
    expect(result.targetName).toBe('data.csv');
  });

  it('keeps .json format as-is', () => {
    const result = convertToMarkdown('config.json', '{"key": "value"}');
    expect(result.content).toBe('{"key": "value"}');
    expect(result.targetName).toBe('config.json');
  });

  it('wraps .yaml in code block', () => {
    const result = convertToMarkdown('config.yaml', 'key: value');
    expect(result.content).toContain('```yaml');
    expect(result.content).toContain('key: value');
    expect(result.targetName).toBe('config.md');
  });

  it('strips HTML tags from .html files', () => {
    const result = convertToMarkdown('page.html', '<h1>Hello</h1><p>World</p>');
    expect(result.content).not.toContain('<h1>');
    expect(result.content).not.toContain('<p>');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('World');
    expect(result.targetName).toBe('page.md');
  });

  it('strips script and style tags from HTML', () => {
    const html = '<script>alert(1)</script><style>.x{}</style><p>Safe</p>';
    const result = convertToMarkdown('page.html', html);
    expect(result.content).not.toContain('alert');
    expect(result.content).not.toContain('.x{}');
    expect(result.content).toContain('Safe');
  });

  it('wraps .xml in code block', () => {
    const result = convertToMarkdown('data.xml', '<root><item>1</item></root>');
    expect(result.content).toContain('```xml');
    expect(result.content).toContain('<root>');
    expect(result.targetName).toBe('data.md');
  });

  it('handles unknown extensions as plain text', () => {
    const result = convertToMarkdown('file.xyz', 'content');
    expect(result.content).toContain('content');
    expect(result.targetName).toBe('file.md');
  });

  it('handles empty content', () => {
    const result = convertToMarkdown('empty.txt', '');
    expect(result.content).toContain('# Empty');
    expect(result.targetName).toBe('empty.md');
  });
});
