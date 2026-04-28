import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Electron's app module before importing core-updater
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => name === 'home' ? '/tmp/mock-home' : `/tmp/mock-${name}`,
    getVersion: () => '0.0.0',
  },
}));

import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'fs';
import path from 'path';
import os from 'os';
import { gzipSync } from 'zlib';

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

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  buf.write(text, offset, length, 'ascii');
}

function writeTarString(buf: Buffer, offset: number, length: number, value: string): void {
  buf.write(value.slice(0, length), offset, length, 'utf-8');
}

function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156, 1, 'ascii');
  writeTarString(header, 257, 6, 'ustar ');
  writeTarString(header, 263, 2, ' \0');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, '0') + '\0 ';
  header.write(checksumText, 148, 8, 'ascii');
  return header;
}

function paddedData(data: Buffer): Buffer {
  const padding = (512 - (data.length % 512)) % 512;
  return padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding)]);
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      out.push(...listFiles(fullPath, base));
    } else if (stat.isFile()) {
      out.push(path.relative(base, fullPath).split(path.sep).join('/'));
    }
  }
  return out;
}

function createGnuLongLinkTarGz(srcDir: string, tarball: string): void {
  const chunks: Buffer[] = [];
  for (const relPath of listFiles(srcDir)) {
    const data = readFileSync(path.join(srcDir, relPath));
    if (Buffer.byteLength(relPath) > 100) {
      const longName = Buffer.from(`${relPath}\0`, 'utf-8');
      chunks.push(tarHeader('././@LongLink', longName.length, 'L'));
      chunks.push(paddedData(longName));
    }
    chunks.push(tarHeader(relPath, data.length, '0'));
    chunks.push(paddedData(data));
  }
  chunks.push(Buffer.alloc(1024));
  writeFileSync(tarball, gzipSync(Buffer.concat(chunks)));
}

/** Create a tar.gz fixture. GNU LongLink fixtures are written in JS for macOS/BSD tar compatibility. */
function createTarGz(srcDir: string, tarball: string, format?: string): void {
  if (format === 'gnu') {
    createGnuLongLinkTarGz(srcDir, tarball);
    return;
  }

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
