import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedFile, testMindRoot } from '../setup';
import { GET } from '../../app/api/export/route';
import { collectExportFiles } from '../../lib/core/export';

const archiverSpy = vi.hoisted(() => ({
  abort: null as null | ReturnType<typeof vi.fn>,
}));

// Passthrough wrapper so tests can observe archive.abort() on the instance the
// route created without changing archiver behaviour.
vi.mock('archiver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('archiver')>();
  const factory = actual.default;
  const wrapped = ((...args: Parameters<typeof factory>) => {
    const instance = factory(...args);
    archiverSpy.abort = vi.spyOn(instance, 'abort') as unknown as ReturnType<typeof vi.fn>;
    return instance;
  }) as typeof factory;
  return { ...actual, default: wrapped };
});

async function readAll(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe('GET /api/export', () => {
  afterEach(() => {
    archiverSpy.abort = null;
    vi.restoreAllMocks();
  });

  it('exports files whose names legitimately contain double dots', async () => {
    seedFile('notes..md', '# Dotted');

    const res = await GET(new NextRequest('http://localhost/api/export?path=notes..md&format=md'));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# Dotted');
  });

  it('still blocks actual traversal through the core safe resolver', async () => {
    const res = await GET(new NextRequest('http://localhost/api/export?path=../secret.md&format=md'));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Access denied') });
  });

  describe('zip export', () => {
    function seedSpace() {
      seedFile('Space/a.md', '# A\n\nSee [[b]]');
      seedFile('Space/sub/b.md', '# B');
      seedFile('Space/sub/data.csv', 'x,y\n1,2');
      seedFile('Space/INSTRUCTION.md', 'skipped system file');
      seedFile('Space/.hidden.md', 'skipped dotfile');
      seedFile('Space/image.png', 'binary not exported');
    }

    it('lists exportable files with absolute paths instead of pre-reading their content', () => {
      seedSpace();

      const files = collectExportFiles(testMindRoot, 'Space');

      expect(files.map((f) => f.relativePath).sort()).toEqual(['a.md', 'sub/b.md', 'sub/data.csv']);
      for (const file of files) {
        expect(path.isAbsolute(file.absPath)).toBe(true);
        expect(fs.existsSync(file.absPath)).toBe(true);
        expect(file).not.toHaveProperty('content');
      }
    });

    it('streams a zip archive containing the space files', async () => {
      seedSpace();
      const readSpy = vi.spyOn(fs, 'readFileSync');

      const res = await GET(new NextRequest('http://localhost/api/export?path=Space&format=zip'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toContain('Space-');
      const body = await readAll(res);

      // Plain zip export must not buffer whole files through readFileSync;
      // archiver streams them from disk.
      const roots = [testMindRoot, fs.realpathSync(testMindRoot)];
      const bufferedReads = readSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((target) => roots.some((root) => target.startsWith(root)) && /\.(md|csv)$/.test(target));
      expect(bufferedReads).toEqual([]);

      expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      const text = body.toString('latin1');
      expect(text).toContain('a.md');
      expect(text).toContain('sub/b.md');
      expect(text).toContain('sub/data.csv');
      expect(text).not.toContain('INSTRUCTION.md');
      expect(text).not.toContain('.hidden.md');
      expect(text).not.toContain('image.png');
      expect(archiverSpy.abort).not.toHaveBeenCalled();
    });

    it('converts markdown to html entries for zip-html', async () => {
      seedSpace();

      const res = await GET(new NextRequest('http://localhost/api/export?path=Space&format=zip-html'));
      expect(res.status).toBe(200);
      const text = (await readAll(res)).toString('latin1');

      expect(text).toContain('a.html');
      expect(text).toContain('sub/b.html');
      expect(text).toContain('sub/data.csv');
      expect(text).not.toContain('a.md');
    });

    it('returns 404 when the directory has nothing exportable', async () => {
      seedFile('Empty/INSTRUCTION.md', 'only system files');

      const res = await GET(new NextRequest('http://localhost/api/export?path=Empty&format=zip'));

      expect(res.status).toBe(404);
    });

    it('aborts the archive when the client disconnects', async () => {
      seedSpace();
      const controller = new AbortController();
      controller.abort();

      const res = await GET(new NextRequest('http://localhost/api/export?path=Space&format=zip', {
        signal: controller.signal,
      }));

      expect(archiverSpy.abort).toHaveBeenCalledTimes(1);
      // The response stream must settle instead of hanging on a dead client.
      const settled = await Promise.race([
        readAll(res).then(() => 'ended', () => 'errored'),
        new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 5_000)),
      ]);
      expect(settled).not.toBe('hung');
    });

    it('aborts an in-flight archive when the signal fires mid-stream', async () => {
      seedSpace();
      const controller = new AbortController();

      const res = await GET(new NextRequest('http://localhost/api/export?path=Space&format=zip', {
        signal: controller.signal,
      }));
      expect(res.status).toBe(200);
      controller.abort();

      expect(archiverSpy.abort).toHaveBeenCalledTimes(1);
      const settled = await Promise.race([
        readAll(res).then(() => 'ended', () => 'errored'),
        new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 5_000)),
      ]);
      expect(settled).not.toBe('hung');
    });
  });
});
