import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFileGet } from './file.js';

function baseServices(mindRoot: string) {
  return {
    mindRoot,
    readTextFile: () => '',
    readLines: () => [],
    listSpaces: () => [],
    listDirectories: () => [],
  };
}

describe('file handler listings', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-file-listing-'));
    mkdirSync(join(root, 'Notes', 'Daily'), { recursive: true });
    writeFileSync(join(root, 'Notes', 'INSTRUCTION.md'), '# Notes');
    writeFileSync(join(root, 'Notes', 'a.md'), 'a');
    writeFileSync(join(root, 'Notes', 'Daily', 'b.md'), 'b');
    mkdirSync(join(root, 'Scratch', 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'Scratch', 'INSTRUCTION.md'), '# Scratch');
    mkdirSync(join(root, 'Scratch', 'build'), { recursive: true });
    writeFileSync(join(root, '.mindosignore'), 'Scratch/build\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('counts space files from the cached file list instead of walking each space', () => {
    const collectAllFiles = vi.fn(() => ['Notes/INSTRUCTION.md', 'Notes/a.md', 'Notes/Daily/b.md', 'Scratch/INSTRUCTION.md', 'TODO.md']);
    const res = handleFileGet(new URLSearchParams('op=list_spaces'), { ...baseServices(root), collectAllFiles });
    expect(res.status).toBe(200);
    expect(collectAllFiles).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({
      spaces: [
        expect.objectContaining({ name: 'Notes', path: 'Notes', fileCount: 3 }),
        expect.objectContaining({ name: 'Scratch', path: 'Scratch', fileCount: 1 }),
      ],
    });
  });

  it('falls back to walking spaces when no cached list is available', () => {
    const res = handleFileGet(new URLSearchParams('op=list_spaces'), baseServices(root));
    expect(res.body).toEqual({
      spaces: [
        expect.objectContaining({ name: 'Notes', fileCount: 3 }),
        expect.objectContaining({ name: 'Scratch', fileCount: 1 }),
      ],
    });
  });

  it('applies the shared ignore rules to list_dirs', () => {
    const res = handleFileGet(new URLSearchParams('op=list_dirs'), baseServices(root));
    expect(res.body).toEqual({ dirs: ['Notes', 'Notes/Daily', 'Scratch'] });
  });
});
