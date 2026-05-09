import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'package.json'), 'utf-8')).version;

let tempDir: string;
let fakeBinDir: string;
let fakeHome: string;
let fakeInstallRoot: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-update-root-'));
  fakeBinDir = path.join(tempDir, 'fake-bin');
  fakeHome = path.join(tempDir, 'home');
  fakeInstallRoot = path.join(tempDir, 'new-root');

  fs.mkdirSync(fakeBinDir, { recursive: true });
  fs.mkdirSync(path.join(fakeHome, '.mindos'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, 'packages', 'web', '.next'), { recursive: true });
  fs.mkdirSync(path.join(fakeInstallRoot, '_standalone'), { recursive: true });

  fs.writeFileSync(path.join(fakeBinDir, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.symlinkSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), path.join(fakeBinDir, 'mindos'));
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'package.json'),
    JSON.stringify({ name: '@geminilight/mindos', version: '9.9.9' }),
  );
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'packages', 'web', '.next', '.mindos-build-version'),
    '9.9.9',
  );
  fs.writeFileSync(
    path.join(fakeInstallRoot, 'packages', 'web', 'package.json'),
    JSON.stringify({ name: '@mindos/web', version: '0.1.0' }),
  );
  fs.writeFileSync(path.join(fakeInstallRoot, '_standalone', 'server.js'), '');
  fs.writeFileSync(path.join(fakeInstallRoot, '_standalone', '.mindos-build-version'), '9.9.9');
  fs.writeFileSync(
    path.join(fakeHome, '.mindos', 'config.json'),
    JSON.stringify({ port: 19876, mcpPort: 19877 }),
  );
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('mindos update root resolution', () => {
  it('uses argv command lookup instead of shell strings when finding mindos binaries', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'commands', 'update.js'), 'utf-8');

    expect(source).toContain("execFileSync(process.platform === 'win32' ? 'where' : 'which', ['mindos']");
    expect(source).not.toContain("'where mindos'");
    expect(source).not.toContain("'which mindos'");
  });

  it('uses the resolved installed CLI path instead of falling back to the current repo root', () => {
    const stdout = execFileSync(process.execPath, [CLI, 'update'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(stdout).toContain(`Updated: ${CURRENT_VERSION} → 9.9.9`);
    expect(stdout).not.toContain('Already on the latest version');
  });

  it('uses the resolved installed shim path for the split main package and platform runtime layout', () => {
    fs.rmSync(path.join(fakeInstallRoot, 'bin', 'cli.js'), { force: true });
    fs.rmSync(path.join(fakeInstallRoot, 'packages'), { recursive: true, force: true });
    fs.rmSync(path.join(fakeInstallRoot, '_standalone'), { recursive: true, force: true });
    fs.writeFileSync(path.join(fakeInstallRoot, 'bin', 'mindos-shim.cjs'), '#!/usr/bin/env node\nprocess.exit(0)\n', { mode: 0o755 });
    fs.rmSync(path.join(fakeBinDir, 'mindos'), { force: true });
    fs.symlinkSync(path.join(fakeInstallRoot, 'bin', 'mindos-shim.cjs'), path.join(fakeBinDir, 'mindos'));

    const stdout = execFileSync(process.execPath, [CLI, 'update'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
      },
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    expect(stdout).toContain(`Updated: ${CURRENT_VERSION} → 9.9.9`);
    expect(stdout).not.toContain('Building MindOS');
  });

  it('skips the shell shim under ~/.mindos/bin/ and falls back to current ROOT', () => {
    const shimDir = path.join(fakeHome, '.mindos', 'bin');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(
      path.join(shimDir, 'mindos'),
      '#!/bin/sh\nexec node "$(dirname "$0")/../cli.js" "$@"\n',
      { mode: 0o755 },
    );

    const stdout = execFileSync(process.execPath, [CLI, 'update'], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: `${shimDir}:${fakeBinDir}:${process.env.PATH}`,
      },
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // `which mindos` finds shimDir/mindos first, but getUpdatedRoot() skips it
    // (dirname matches $HOME/.mindos/bin). Falls back to ROOT where
    // package.json has CURRENT_VERSION → reports "already on the latest".
    expect(stdout).toContain('Already on the latest version');
  });
});
