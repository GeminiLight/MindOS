import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { collectExportFiles } from '@/lib/core/export';
import { mkTempMindRoot, cleanupMindRoot, seedFile } from './helpers';

describe('export helpers', () => {
  let mindRoot: string;

  beforeEach(() => { mindRoot = mkTempMindRoot(); });
  afterEach(() => { cleanupMindRoot(mindRoot); });

  describe('collectExportFiles', () => {
    it('collects markdown and csv files under the selected directory', () => {
      seedFile(mindRoot, 'Space/README.md', '# Space');
      seedFile(mindRoot, 'Space/data.csv', 'name,value');
      seedFile(mindRoot, 'Space/private.json', '{"skip":true}');
      seedFile(mindRoot, 'Space/Nested/note.md', 'hello');

      const files = collectExportFiles(mindRoot, 'Space')
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      // Entries carry the on-disk path so the export route can stream them;
      // contents are no longer buffered up front.
      expect(files.map((file) => file.relativePath)).toEqual(['data.csv', 'Nested/note.md', 'README.md']);
      expect(files.map((file) => fs.readFileSync(file.absPath, 'utf-8'))).toEqual(['name,value', 'hello', '# Space']);
      for (const file of files) {
        expect(path.isAbsolute(file.absPath)).toBe(true);
        expect(file).not.toHaveProperty('content');
      }
    });

    it('skips files the process cannot read instead of failing the export', () => {
      seedFile(mindRoot, 'Space/ok.md', 'readable');
      seedFile(mindRoot, 'Space/locked.md', 'unreadable');
      fs.chmodSync(path.join(mindRoot, 'Space/locked.md'), 0o000);

      try {
        const files = collectExportFiles(mindRoot, 'Space');
        // Root can read anything regardless of mode bits; only assert when the
        // permission actually applies.
        if (process.getuid?.() !== 0) {
          expect(files.map((file) => file.relativePath)).toEqual(['ok.md']);
        } else {
          expect(files.map((file) => file.relativePath).sort()).toEqual(['locked.md', 'ok.md']);
        }
      } finally {
        fs.chmodSync(path.join(mindRoot, 'Space/locked.md'), 0o644);
      }
    });

    it('rejects traversal before checking directories outside mindRoot', () => {
      const outsideDir = path.join(path.dirname(mindRoot), `mindos-export-outside-${Date.now()}`);
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(path.join(outsideDir, 'leak.md'), 'outside', 'utf-8');

      try {
        expect(() => collectExportFiles(mindRoot, path.relative(mindRoot, outsideDir))).toThrow('Access denied');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects export roots that resolve through symlinks outside mindRoot', () => {
      const outsideDir = path.join(path.dirname(mindRoot), `mindos-export-linked-${Date.now()}`);
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(path.join(outsideDir, 'leak.md'), 'outside', 'utf-8');
      fs.symlinkSync(outsideDir, path.join(mindRoot, 'Linked'), 'dir');

      try {
        expect(() => collectExportFiles(mindRoot, 'Linked')).toThrow('Access denied');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
