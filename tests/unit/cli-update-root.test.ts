import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;

let tempDir: string;
let fakeBinDir: string;
let fakeInstallRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-update-root-'));
  fakeBinDir = path.join(tempDir, 'fake-bin');
  fakeInstallRoot = path.join(tempDir, 'new-root');

  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, 'app', '.next'), { recursive: true });

  fs.writeFileSync(path.join(fakeBinDir, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.symlinkSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), path.join(fakeBinDir, 'mindos'));
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'package.json'),
    JSON.stringify({ name: '@geminilight/mindos', version: '9.9.9' }),
  );
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'app', '.next', '.mindos-build-version'),
    '9.9.9',
  );
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'app', 'package.json'),
    JSON.stringify({ name: 'wiki-app', version: '0.1.0' }),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('mindos update root resolution', () => {
  it('uses the resolved installed CLI path instead of falling back to the current repo root', () => {
    const stdout = execFileSync(process.execPath, [CLI, 'update'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(stdout).toContain(`Updated: ${CURRENT_VERSION} → 9.9.9`);
    expect(stdout).not.toContain('Already on the latest version');
  });
});
