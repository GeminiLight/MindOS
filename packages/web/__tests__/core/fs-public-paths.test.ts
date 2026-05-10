import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getDirEntries, getSpacePreview, isDirectory } from '@/lib/fs';
import { getTestMindRoot } from '../setup';

function makeSiblingDirectory(): { dir: string; traversalPath: string } {
  const root = getTestMindRoot();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-outside-dir-'));
  return {
    dir,
    traversalPath: path.relative(root, dir),
  };
}

describe('web fs public directory helpers', () => {
  it('does not reveal sibling directories outside MIND_ROOT', () => {
    const { dir, traversalPath } = makeSiblingDirectory();
    try {
      fs.writeFileSync(path.join(dir, 'leak.md'), 'outside', 'utf-8');
      fs.writeFileSync(path.join(dir, 'INSTRUCTION.md'), '# Outside', 'utf-8');
      fs.writeFileSync(path.join(dir, 'README.md'), '# Outside Readme', 'utf-8');

      expect(isDirectory(traversalPath)).toBe(false);
      expect(getDirEntries(traversalPath)).toEqual([]);
      expect(getSpacePreview(traversalPath)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not follow symlinked directories outside MIND_ROOT', () => {
    const root = getTestMindRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-outside-symlink-dir-'));
    const linkPath = path.join(root, 'linked-outside');
    try {
      fs.writeFileSync(path.join(outside, 'leak.md'), 'outside', 'utf-8');
      fs.writeFileSync(path.join(outside, 'INSTRUCTION.md'), '# Outside', 'utf-8');
      fs.writeFileSync(path.join(outside, 'README.md'), '# Outside Readme', 'utf-8');
      fs.symlinkSync(outside, linkPath, 'dir');

      expect(isDirectory('linked-outside')).toBe(false);
      expect(getDirEntries('linked-outside')).toEqual([]);
      expect(getSpacePreview('linked-outside')).toBeNull();
    } finally {
      fs.rmSync(linkPath, { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
