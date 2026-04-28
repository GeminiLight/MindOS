import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from '../core/helpers';
import { collectSpaceFiles } from '@/lib/compile';

vi.mock('@/lib/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fs')>();
  let _mindRoot = '';
  return {
    ...actual,
    getMindRoot: () => _mindRoot,
    setMindRootForTest: (p: string) => { _mindRoot = p; },
    collectAllFiles: () => {
      const fs = require('fs');
      const path = require('path');
      const results: string[] = [];
      function walk(dir: string, prefix: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
          else results.push(rel);
        }
      }
      walk(_mindRoot, '');
      return results;
    },
  };
});

const { setMindRootForTest } = await import('@/lib/fs') as any;

describe('collectSpaceFiles', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    setMindRootForTest(mindRoot);
  });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  it('returns empty for Space with no files', () => {
    seedFile(mindRoot, 'Research/INSTRUCTION.md', '# Rules');
    const files = collectSpaceFiles(mindRoot, 'Research');
    expect(files).toEqual([]);
  });

  it('collects .md files but excludes INSTRUCTION.md and CONFIG.json', () => {
    seedFile(mindRoot, 'Research/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Research/README.md', '# Overview');
    seedFile(mindRoot, 'Research/CONFIG.json', '{}');
    seedFile(mindRoot, 'Research/paper1.md', '# Paper 1\nContent here');
    seedFile(mindRoot, 'Research/paper2.md', '# Paper 2\nMore content');
    const files = collectSpaceFiles(mindRoot, 'Research');
    expect(files.length).toBe(3);
    const names = files.map(f => f.name).sort();
    expect(names).toEqual(['README.md', 'paper1.md', 'paper2.md']);
  });

  it('includes nested files with relative paths', () => {
    seedFile(mindRoot, 'Research/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Research/sub/deep.md', '# Deep');
    const files = collectSpaceFiles(mindRoot, 'Research');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('sub/deep.md');
  });

  it('truncates long file content', () => {
    const longContent = 'x'.repeat(2000);
    seedFile(mindRoot, 'Research/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Research/big.md', longContent);
    const files = collectSpaceFiles(mindRoot, 'Research');
    expect(files[0].preview.length).toBeLessThan(longContent.length);
    expect(files[0].preview).toContain('...(truncated)');
  });

  it('respects max file limit', () => {
    seedFile(mindRoot, 'Huge/INSTRUCTION.md', '# Rules');
    for (let i = 0; i < 100; i++) {
      seedFile(mindRoot, `Huge/file${String(i).padStart(3, '0')}.md`, `# File ${i}`);
    }
    const files = collectSpaceFiles(mindRoot, 'Huge');
    expect(files.length).toBeLessThanOrEqual(80);
  });

  it('includes .csv files', () => {
    seedFile(mindRoot, 'Data/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Data/records.csv', 'name,value\nfoo,1\nbar,2');
    const files = collectSpaceFiles(mindRoot, 'Data');
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('records.csv');
  });

  it('handles Space with trailing slash', () => {
    seedFile(mindRoot, 'Notes/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Notes/idea.md', '# Idea');
    const files = collectSpaceFiles(mindRoot, 'Notes/');
    expect(files).toHaveLength(1);
  });
});
