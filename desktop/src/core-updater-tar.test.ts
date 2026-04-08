import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Electron's app module before importing core-updater
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'home' ? '/tmp/mock-home' : `/tmp/mock-${name}`,
    getVersion: () => '0.0.0',
  },
}));

import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

// The function under test — exported via _extractTarGzJs_forTest
import { _extractTarGzJs_forTest as extractTarGzJs } from './core-updater';

const TMP = path.join(os.tmpdir(), `core-updater-tar-test-${process.pid}`);
const SRC_DIR = path.join(TMP, 'src');
const TARBALL = path.join(TMP, 'test.tar.gz');
const DEST_DIR = path.join(TMP, 'dest');

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(SRC_DIR, { recursive: true });
  mkdirSync(DEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Create a tar.gz using system tar (GNU format by default on Linux). */
function createTarGz(srcDir: string, tarball: string, format?: string): void {
  const args = ['czf', tarball];
  if (format) args.push(`--format=${format}`);
  args.push('-C', srcDir, '.');
  execFileSync('tar', args);
}

describe('extractTarGzJs — GNU LongLink support', () => {
  it('extracts files with paths > 100 chars (GNU tar format)', async () => {
    // Create a deeply nested file whose tar-internal path exceeds 100 characters
    // "a{50}/b{50}/file.txt" = 50 + 1 + 50 + 1 + 8 = 110 chars (> 100)
    const longDir = path.join(SRC_DIR, 'a'.repeat(50), 'b'.repeat(50));
    mkdirSync(longDir, { recursive: true });
    writeFileSync(path.join(longDir, 'file.txt'), 'hello-long-path');

    // Also create a short-path file to verify normal extraction still works
    mkdirSync(path.join(SRC_DIR, 'short'), { recursive: true });
    writeFileSync(path.join(SRC_DIR, 'short', 'ok.txt'), 'short-path');

    // Pack with GNU format (default on Linux, explicit here for clarity)
    createTarGz(SRC_DIR, TARBALL, 'gnu');

    await extractTarGzJs(TARBALL, DEST_DIR);

    // Verify short-path file
    const shortContent = readFileSync(path.join(DEST_DIR, 'short', 'ok.txt'), 'utf-8');
    expect(shortContent).toBe('short-path');

    // Verify long-path file
    const longPath = path.join(DEST_DIR, 'a'.repeat(50), 'b'.repeat(50), 'file.txt');
    expect(existsSync(longPath)).toBe(true);
    const longContent = readFileSync(longPath, 'utf-8');
    expect(longContent).toBe('hello-long-path');
  });

  it('extracts files with paths > 100 chars (POSIX/pax format)', async () => {
    const longDir = path.join(SRC_DIR, 'x'.repeat(60), 'y'.repeat(60));
    mkdirSync(longDir, { recursive: true });
    writeFileSync(path.join(longDir, 'data.bin'), Buffer.from([1, 2, 3, 4, 5]));

    createTarGz(SRC_DIR, TARBALL, 'posix');

    await extractTarGzJs(TARBALL, DEST_DIR);

    const outPath = path.join(DEST_DIR, 'x'.repeat(60), 'y'.repeat(60), 'data.bin');
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath)).toEqual(Buffer.from([1, 2, 3, 4, 5]));
  });

  it('handles realistic node_modules deep path (simulates the bug scenario)', async () => {
    // Simulate the exact path structure that triggered the EISDIR bug:
    // app/.next/standalone/node_modules/cli-highlight/node_modules/parse5/lib/extensions/position-tracking/
    const deepDir = path.join(
      SRC_DIR,
      'app', '.next', 'standalone', 'node_modules',
      'cli-highlight', 'node_modules', 'parse5', 'lib',
      'extensions', 'position-tracking',
    );
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(path.join(deepDir, 'preprocessor-mixin.js'), '// mixin code');

    createTarGz(SRC_DIR, TARBALL, 'gnu');

    await extractTarGzJs(TARBALL, DEST_DIR);

    const outFile = path.join(
      DEST_DIR,
      'app', '.next', 'standalone', 'node_modules',
      'cli-highlight', 'node_modules', 'parse5', 'lib',
      'extensions', 'position-tracking', 'preprocessor-mixin.js',
    );
    expect(existsSync(outFile)).toBe(true);
    expect(readFileSync(outFile, 'utf-8')).toBe('// mixin code');
  });

  it('handles empty files with long paths', async () => {
    const longDir = path.join(SRC_DIR, 'deep'.repeat(30));
    mkdirSync(longDir, { recursive: true });
    writeFileSync(path.join(longDir, 'empty.txt'), '');

    createTarGz(SRC_DIR, TARBALL, 'gnu');

    await extractTarGzJs(TARBALL, DEST_DIR);

    const outPath = path.join(DEST_DIR, 'deep'.repeat(30), 'empty.txt');
    expect(existsSync(outPath)).toBe(true);
    expect(readFileSync(outPath, 'utf-8')).toBe('');
  });

  it('extracts ustar format without long-name extensions', async () => {
    // Standard short path — should work with plain ustar
    mkdirSync(path.join(SRC_DIR, 'lib'), { recursive: true });
    writeFileSync(path.join(SRC_DIR, 'lib', 'index.js'), 'module.exports = {};');
    writeFileSync(path.join(SRC_DIR, 'package.json'), '{"name":"test"}');

    createTarGz(SRC_DIR, TARBALL, 'ustar');

    await extractTarGzJs(TARBALL, DEST_DIR);

    expect(readFileSync(path.join(DEST_DIR, 'lib', 'index.js'), 'utf-8')).toBe('module.exports = {};');
    expect(readFileSync(path.join(DEST_DIR, 'package.json'), 'utf-8')).toBe('{"name":"test"}');
  });
});
