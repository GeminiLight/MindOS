import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from '../core/helpers';
import { collectChangedFiles } from '@/lib/compile';

vi.mock('@/lib/fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fs')>();
  let _mindRoot = '';
  return {
    ...actual,
    getMindRoot: () => _mindRoot,
    setMindRootForTest: (p: string) => { _mindRoot = p; },
    collectAllFiles: () => {
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

describe('collectChangedFiles', () => {
  let mindRoot: string;

  beforeEach(() => {
    mindRoot = mkTempMindRoot();
    setMindRootForTest(mindRoot);
  });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  it('returns all files when all are newer than timestamp', () => {
    seedFile(mindRoot, 'Space/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Space/file1.md', '# File 1');
    seedFile(mindRoot, 'Space/file2.md', '# File 2');

    // Use a timestamp from the past
    const pastTime = new Date(Date.now() - 86400_000).toISOString();
    const { changed, total } = collectChangedFiles(mindRoot, 'Space', pastTime);
    expect(changed.length).toBe(2); // file1 + file2 (INSTRUCTION.md excluded)
    expect(total).toBe(2);
  });

  it('returns empty when no files changed since timestamp', () => {
    seedFile(mindRoot, 'Space/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Space/old.md', '# Old');

    // Use a future timestamp
    const futureTime = new Date(Date.now() + 86400_000).toISOString();
    const { changed, total } = collectChangedFiles(mindRoot, 'Space', futureTime);
    expect(changed.length).toBe(0);
    expect(total).toBe(1); // old.md still counted in total
  });

  it('returns only changed files when some are newer', async () => {
    seedFile(mindRoot, 'Space/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Space/old.md', '# Old file');

    // Set old file mtime to past
    const oldPath = path.join(mindRoot, 'Space/old.md');
    const pastTime = new Date(Date.now() - 86400_000);
    fs.utimesSync(oldPath, pastTime, pastTime);

    // Record the "compile" time as slightly before now
    const compileTime = new Date(Date.now() - 1000).toISOString();

    // Create a new file after compile time
    seedFile(mindRoot, 'Space/new.md', '# New file');

    const { changed, total } = collectChangedFiles(mindRoot, 'Space', compileTime);
    expect(total).toBe(2); // old.md + new.md
    expect(changed.length).toBe(1);
    expect(changed[0].name).toBe('new.md');
  });

  it('excludes INSTRUCTION.md and CONFIG.json from results', () => {
    seedFile(mindRoot, 'Space/INSTRUCTION.md', '# Rules');
    seedFile(mindRoot, 'Space/CONFIG.json', '{}');
    seedFile(mindRoot, 'Space/note.md', '# Note');

    const pastTime = new Date(Date.now() - 86400_000).toISOString();
    const { changed, total } = collectChangedFiles(mindRoot, 'Space', pastTime);
    expect(total).toBe(1);
    expect(changed.length).toBe(1);
    expect(changed[0].name).toBe('note.md');
  });

  it('handles Space with no files', () => {
    seedFile(mindRoot, 'Empty/INSTRUCTION.md', '# Rules');
    const pastTime = new Date(Date.now() - 86400_000).toISOString();
    const { changed, total } = collectChangedFiles(mindRoot, 'Empty', pastTime);
    expect(changed.length).toBe(0);
    expect(total).toBe(0);
  });
});
