import { describe, it, expect } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { getFileContent, invalidateCache } from '../../lib/fs';
import { truncate } from '../../lib/agent/tools';

describe('Ask attached files', () => {
  describe('getFileContent reads KB files', () => {
    it('reads a seeded markdown file', () => {
      seedFile('notes/test.md', '# Test\nHello world');
      invalidateCache();
      const content = getFileContent('notes/test.md');
      expect(content).toBe('# Test\nHello world');
    });

    it('reads a nested file', () => {
      seedFile('deep/nested/dir/file.md', 'nested content');
      invalidateCache();
      const content = getFileContent('deep/nested/dir/file.md');
      expect(content).toBe('nested content');
    });

    it('throws for non-existent file', () => {
      invalidateCache();
      expect(() => getFileContent('does-not-exist.md')).toThrow();
    });

    it('reads CSV files', () => {
      seedFile('data.csv', 'a,b,c\n1,2,3');
      invalidateCache();
      const content = getFileContent('data.csv');
      expect(content).toBe('a,b,c\n1,2,3');
    });
  });

  describe('truncate limits content length', () => {
    it('passes through short content unchanged', () => {
      const short = 'Hello world';
      expect(truncate(short)).toBe(short);
    });

    it('truncates very long content', () => {
      const long = 'x'.repeat(50_000);
      const result = truncate(long);
      expect(result.length).toBeLessThan(long.length);
    });
  });

  describe('attachment pattern builds correct context', () => {
    it('builds context parts for multiple attached files', () => {
      seedFile('file-a.md', '# File A\nContent A');
      seedFile('file-b.md', '# File B\nContent B');
      invalidateCache();

      const attachedFiles = ['file-a.md', 'file-b.md'];
      const contextParts: string[] = [];
      const seen = new Set<string>();

      for (const filePath of attachedFiles) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* simulate route.ts pattern */ }
      }

      expect(contextParts).toHaveLength(2);
      expect(contextParts[0]).toContain('## Attached: file-a.md');
      expect(contextParts[0]).toContain('Content A');
      expect(contextParts[1]).toContain('## Attached: file-b.md');
      expect(contextParts[1]).toContain('Content B');
    });

    it('deduplicates attached files', () => {
      seedFile('dup.md', 'content');
      invalidateCache();

      const attachedFiles = ['dup.md', 'dup.md', 'dup.md'];
      const contextParts: string[] = [];
      const seen = new Set<string>();

      for (const filePath of attachedFiles) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* */ }
      }

      expect(contextParts).toHaveLength(1);
    });

    it('skips missing files without crashing', () => {
      seedFile('exists.md', 'good');
      invalidateCache();

      const attachedFiles = ['exists.md', 'missing.md', 'also-missing.md'];
      const contextParts: string[] = [];
      const seen = new Set<string>();

      for (const filePath of attachedFiles) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* silently skip */ }
      }

      expect(contextParts).toHaveLength(1);
      expect(contextParts[0]).toContain('exists.md');
    });

    it('handles empty attachedFiles array', () => {
      const attachedFiles: string[] = [];
      const contextParts: string[] = [];
      const seen = new Set<string>();

      for (const filePath of attachedFiles) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* */ }
      }

      expect(contextParts).toHaveLength(0);
    });

    it('currentFile is included when not in attachedFiles', () => {
      seedFile('attached.md', 'attached content');
      seedFile('current.md', 'current content');
      invalidateCache();

      const attachedFiles = ['attached.md'];
      const currentFile = 'current.md';
      const contextParts: string[] = [];
      const seen = new Set<string>();

      for (const filePath of attachedFiles) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* */ }
      }

      if (currentFile && !seen.has(currentFile)) {
        seen.add(currentFile);
        try {
          const content = truncate(getFileContent(currentFile));
          contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
        } catch { /* */ }
      }

      expect(contextParts).toHaveLength(2);
      expect(contextParts[0]).toContain('## Attached: attached.md');
      expect(contextParts[1]).toContain('## Current file: current.md');
    });

    it('currentFile is not duplicated when already in attachedFiles', () => {
      seedFile('same.md', 'same content');
      invalidateCache();

      const attachedFiles = ['same.md'];
      const currentFile = 'same.md';
      const contextParts: string[] = [];
      const seen = new Set<string>();

      for (const filePath of attachedFiles) {
        if (seen.has(filePath)) continue;
        seen.add(filePath);
        try {
          const content = truncate(getFileContent(filePath));
          contextParts.push(`## Attached: ${filePath}\n\n${content}`);
        } catch { /* */ }
      }

      if (currentFile && !seen.has(currentFile)) {
        seen.add(currentFile);
        try {
          const content = truncate(getFileContent(currentFile));
          contextParts.push(`## Current file: ${currentFile}\n\n${content}`);
        } catch { /* */ }
      }

      expect(contextParts).toHaveLength(1);
      expect(contextParts[0]).toContain('## Attached: same.md');
    });
  });
});
