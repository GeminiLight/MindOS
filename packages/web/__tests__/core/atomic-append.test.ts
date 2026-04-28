import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';
import { appendToFile } from '@/lib/core/lines';
import { readFile } from '@/lib/core/fs-ops';

describe('appendToFile (atomic append)', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  it('appends to non-empty file with newline separator', () => {
    seedFile(mindRoot, 'a.md', 'line1');
    appendToFile(mindRoot, 'a.md', 'line2');
    expect(readFile(mindRoot, 'a.md')).toBe('line1\nline2');
  });

  it('appends to file already ending with double newline', () => {
    seedFile(mindRoot, 'a.md', 'line1\n\n');
    appendToFile(mindRoot, 'a.md', 'line2');
    expect(readFile(mindRoot, 'a.md')).toBe('line1\n\nline2');
  });

  it('appends to empty file without separator', () => {
    seedFile(mindRoot, 'a.md', '');
    appendToFile(mindRoot, 'a.md', 'first line');
    expect(readFile(mindRoot, 'a.md')).toBe('first line');
  });

  it('handles multiple appends', () => {
    seedFile(mindRoot, 'a.md', 'A');
    appendToFile(mindRoot, 'a.md', 'B');
    appendToFile(mindRoot, 'a.md', 'C');
    const content = readFile(mindRoot, 'a.md');
    expect(content).toContain('A');
    expect(content).toContain('B');
    expect(content).toContain('C');
  });

  it('handles CJK content', () => {
    seedFile(mindRoot, 'a.md', '# 知识库');
    appendToFile(mindRoot, 'a.md', '新的内容');
    const content = readFile(mindRoot, 'a.md');
    expect(content).toContain('知识库');
    expect(content).toContain('新的内容');
  });
});
