import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(__dirname, '../..');
const shimPath = path.join(root, 'packages/mindos/bin/mindos-shim.cjs');

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-shim-runtime-fallback-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('mindos npm shim runtime fallback', () => {
  it('downloads and reuses the runtime archive when no platform package is installed', async () => {
    const runtimeRoot = path.join(tempDir, 'runtime-root');
    const binDir = path.join(runtimeRoot, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(binDir, 'cli.js'),
      "console.log('fallback-runtime ' + process.argv.slice(2).join(' '));\n",
      'utf-8',
    );
    fs.writeFileSync(path.join(runtimeRoot, 'package.json'), JSON.stringify({
      name: '@geminilight/mindos-runtime',
      version: '9.9.9',
    }), 'utf-8');

    const archivePath = path.join(tempDir, 'mindos-runtime-9.9.9.tar.gz');
    execFileSync('tar', ['czf', archivePath, '-C', runtimeRoot, '.']);
    const archive = fs.readFileSync(archivePath);
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const manifestPath = path.join(tempDir, 'latest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: '9.9.9',
      size: archive.length,
      sha256,
      urls: [pathToFileURL(archivePath).toString()],
    }), 'utf-8');

    const cacheDir = path.join(tempDir, 'cache');
    const run = () => spawnSync(process.execPath, [shimPath, '--version'], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        MINDOS_RUNTIME_MANIFEST_URL: pathToFileURL(manifestPath).toString(),
        MINDOS_RUNTIME_CACHE_DIR: cacheDir,
        MINDOS_DISABLE_PLATFORM_PACKAGE_LOOKUP: '1',
      },
    });

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout.trim()).toBe('fallback-runtime --version');
    expect(fs.existsSync(path.join(cacheDir, '9.9.9', 'bin', 'cli.js'))).toBe(true);

    fs.rmSync(manifestPath);
    fs.rmSync(archivePath);

    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout.trim()).toBe('fallback-runtime --version');
  });
});
