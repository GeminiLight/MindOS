import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import os from 'os';
import { gzipSync } from 'zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _downloadFile_forTest,
  _extractTarGzSafe_forTest,
  _verifyNodeArchiveSha256_forTest,
  isPrivateNodeCompatible,
  NODE_VERSION,
  removeMacQuarantineAttribute,
} from './node-bootstrap';

const httpsGetMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(process.cwd(), 'tmp-node-bootstrap-home'),
  },
}));

vi.mock('https', () => ({
  default: { get: httpsGetMock },
  get: httpsGetMock,
}));

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  buf.write(text, offset, length, 'ascii');
}

function writeTarString(buf: Buffer, offset: number, length: number, value: string): void {
  buf.write(value.slice(0, length), offset, length, 'utf-8');
}

function tarHeader(name: string, size: number, typeflag: string, options: { mode?: number; linkName?: string } = {}): Buffer {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeOctal(header, 100, 8, options.mode ?? 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(typeflag, 156, 1, 'ascii');
  if (options.linkName) writeTarString(header, 157, 100, options.linkName);
  writeTarString(header, 257, 6, 'ustar ');
  writeTarString(header, 263, 2, ' \0');

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

function paddedData(data: Buffer): Buffer {
  const padding = (512 - (data.length % 512)) % 512;
  return padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding)]);
}

describe('node-bootstrap', () => {
  beforeEach(() => {
    httpsGetMock.mockReset();
  });

  it('bundles the current patched Node.js 22 LTS runtime', () => {
    expect(NODE_VERSION).toBe('22.23.2');

    const manifest = JSON.parse(readFileSync(path.join(__dirname, '../node-runtime-manifest.json'), 'utf-8'));
    const source = readFileSync(path.join(__dirname, '../scripts/prepare-mindos-runtime.mjs'), 'utf-8');
    expect(manifest.version).toBe('22.23.2');
    expect(manifest.sha256).toMatchObject({
      'node-v22.23.2-darwin-arm64.tar.gz': expect.stringMatching(/^[a-f0-9]{64}$/),
      'node-v22.23.2-win-x64.zip': expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(source).toContain("path.join(desktopRoot, 'node-runtime-manifest.json')");
  });

  it('rejects a stale private Node runtime left by an older Desktop release', () => {
    if (process.platform === 'win32') return;
    const tempHome = mkdtempSync(path.join(os.tmpdir(), 'mindos-private-node-version-'));
    const previousHome = process.env.MINDOS_DESKTOP_HOME_DIR;
    const privateNode = path.join(tempHome, '.mindos', 'node', 'bin', 'node');
    try {
      process.env.MINDOS_DESKTOP_HOME_DIR = tempHome;
      mkdirSync(path.dirname(privateNode), { recursive: true });
      writeFileSync(privateNode, '#!/bin/sh\necho v22.16.0\n', { mode: 0o755 });

      expect(isPrivateNodeCompatible()).toBe(false);

      writeFileSync(privateNode, '#!/bin/sh\necho v22.23.2\n', { mode: 0o755 });
      expect(isPrivateNodeCompatible()).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.MINDOS_DESKTOP_HOME_DIR;
      else process.env.MINDOS_DESKTOP_HOME_DIR = previousHome;
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('removes macOS quarantine with argv so quoted paths are safe', () => {
    const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
    const nodeDir = '/Users/test/.mindos/node "quoted" $HOME';

    removeMacQuarantineAttribute(nodeDir, (command, args, options) => {
      calls.push({ command, args, options });
      return '';
    });

    expect(calls).toEqual([{
      command: 'xattr',
      args: ['-dr', 'com.apple.quarantine', nodeDir],
      options: { stdio: 'ignore' },
    }]);

    const source = readFileSync(path.join(__dirname, 'node-bootstrap.ts'), 'utf-8');
    expect(source).not.toContain('execSync(`xattr');
    expect(source).not.toContain('com.apple.quarantine "${NODE_DIR}"');
  });

  it('does not route every Windows bootstrap spawn through the shell', () => {
    const source = readFileSync(path.join(__dirname, 'node-bootstrap.ts'), 'utf-8');

    expect(source).not.toContain('shell: IS_WIN');
    expect(source).toContain('shell: needsWindowsShell(cmd)');
    expect(source).toContain('shell: needsWindowsShell(npmBin)');
  });

  it('extracts downloaded Node.js tarballs with local path containment', () => {
    const source = readFileSync(path.join(__dirname, 'node-bootstrap.ts'), 'utf-8');

    expect(source).not.toContain("spawnAsync('tar', ['xzf', tmpFile");
    expect(source).toContain('import { getDesktopConfigDir } from \'./desktop-home\'');
    expect(source).toContain('const nodeDir = getNodeDir();');
    expect(source).toContain('extractTarGzSafe(tmpFile, nodeDir, 1)');
    expect(source).toContain('function resolveTarEntryPath(destDir: string, entryName: string)');
    expect(source).toContain('function resolveTarSymlinkTarget(destDir: string, entryPath: string, linkName: string)');
    expect(source).toContain('symlinkSync(safeLinkName, entryPath)');
    expect(source).toContain('Node.js tar entry outside extraction directory');
  });

  it('preserves safe Node.js tarball symlinks and executable mode', () => {
    if (process.platform === 'win32') return;

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mindos-node-bootstrap-tar-'));
    const tarball = path.join(tmpDir, 'node.tar.gz');
    const dest = path.join(tmpDir, 'node');
    const nodeData = Buffer.from('#!/bin/sh\n');
    const npmData = Buffer.from('// npm cli\n');
    const chunks = [
      tarHeader('node-v22/bin/', 0, '5', { mode: 0o755 }),
      tarHeader('node-v22/bin/node', nodeData.length, '0', { mode: 0o755 }),
      paddedData(nodeData),
      tarHeader('node-v22/lib/node_modules/npm/bin/npm-cli.js', npmData.length, '0', { mode: 0o644 }),
      paddedData(npmData),
      tarHeader('node-v22/bin/npm', 0, '2', {
        mode: 0o777,
        linkName: '../lib/node_modules/npm/bin/npm-cli.js',
      }),
      Buffer.alloc(1024),
    ];

    try {
      writeFileSync(tarball, gzipSync(Buffer.concat(chunks)));
      _extractTarGzSafe_forTest(tarball, dest, 1);

      const nodePath = path.join(dest, 'bin', 'node');
      expect(existsSync(nodePath)).toBe(true);
      expect(statSync(nodePath).mode & 0o111).not.toBe(0);
      expect(readlinkSync(path.join(dest, 'bin', 'npm'))).toBe('../lib/node_modules/npm/bin/npm-cli.js');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('destroys the active download request when the overall timeout fires', async () => {
    vi.useFakeTimers();
    try {
      const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), setTimeout: vi.fn() });
      httpsGetMock.mockImplementation(() => request);

      const download = _downloadFile_forTest('https://node.example/node.tar.gz', '/tmp/node.tar.gz', undefined, 1000);
      const rejected = expect(download).rejects.toThrow('Download timed out after 1s');

      await vi.advanceTimersByTimeAsync(1000);

      await rejected;
      expect(request.destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves relative redirect locations during Node.js download', async () => {
    const calls: string[] = [];
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mindos-node-download-'));
    const dest = path.join(tmpDir, 'node.tar.gz');

    httpsGetMock.mockImplementation((reqUrl, callback) => {
      calls.push(String(reqUrl));
      const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), setTimeout: vi.fn() });
      process.nextTick(() => {
        if (calls.length === 1) {
          callback({
            statusCode: 302,
            headers: { location: '/mirrors/node.tar.gz' },
            resume: vi.fn(),
          });
          return;
        }
        callback({
          statusCode: 200,
          headers: { 'content-length': '2' },
          pipe: (stream: NodeJS.WritableStream) => {
            stream.end('ok');
            return stream;
          },
        });
      });
      return request;
    });

    try {
      await _downloadFile_forTest('https://node.example/dist/node.tar.gz', dest);
      expect(calls).toEqual([
        'https://node.example/dist/node.tar.gz',
        'https://node.example/mirrors/node.tar.gz',
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('destroys a silently stalled download request via socket inactivity timeout', async () => {
    const request = Object.assign(new EventEmitter(), {
      destroy: vi.fn(),
      destroyed: false,
      setTimeout: vi.fn(),
    });
    httpsGetMock.mockImplementation(() => request);

    // No overall timeout — the stall guard must work on its own
    const download = _downloadFile_forTest('https://node.example/node.tar.gz', '/tmp/node-stall.tar.gz');
    const rejected = expect(download).rejects.toThrow('Download stalled (no data for 60s)');

    expect(request.setTimeout).toHaveBeenCalledWith(60_000, expect.any(Function));
    const onStall = request.setTimeout.mock.calls[0][1] as () => void;
    onStall();

    await rejected;
    expect(request.destroy).toHaveBeenCalledTimes(1);
  });

  it('applies the socket inactivity timeout to every request in the redirect chain', async () => {
    const requests: Array<{ setTimeout: ReturnType<typeof vi.fn> }> = [];
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mindos-node-stall-chain-'));
    const dest = path.join(tmpDir, 'node.tar.gz');

    httpsGetMock.mockImplementation((_reqUrl, callback) => {
      const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), setTimeout: vi.fn() });
      requests.push(request);
      process.nextTick(() => {
        if (requests.length === 1) {
          callback({
            statusCode: 302,
            headers: { location: '/mirrors/node.tar.gz' },
            resume: vi.fn(),
          });
          return;
        }
        callback({
          statusCode: 200,
          headers: { 'content-length': '2' },
          pipe: (stream: NodeJS.WritableStream) => {
            stream.end('ok');
            return stream;
          },
        });
      });
      return request;
    });

    try {
      await _downloadFile_forTest('https://node.example/dist/node.tar.gz', dest);
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.setTimeout).toHaveBeenCalledWith(60_000, expect.any(Function));
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('bounds the npmmirror fallback download with a finite overall timeout', () => {
    const source = readFileSync(path.join(__dirname, 'node-bootstrap.ts'), 'utf-8');

    // Official URL stays fail-fast; the mirror fallback must not hang forever
    expect(source).toMatch(/downloadFile\(url,[\s\S]{0,200}30000\)/);
    expect(source).toMatch(/downloadFile\(mirrorUrl,[\s\S]{0,200}600_000\)/);
  });

  it('rejects downloaded Node.js archives whose SHA-256 does not match the pinned official checksum', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mindos-node-checksum-'));
    const archive = path.join(tmpDir, 'node.tar.gz');

    try {
      writeFileSync(archive, 'not the official Node.js archive', 'utf-8');
      expect(() => {
        _verifyNodeArchiveSha256_forTest(archive, 'node-v22.23.2-linux-x64.tar.gz');
      }).toThrow('Node.js archive checksum mismatch');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
