import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for bin/lib/build.js — needsBuild, writeBuildStamp, cleanNextDir, ensureAppDeps.
 *
 * We mock constants.js to point ROOT/BUILD_STAMP/DEPS_STAMP at a temp directory,
 * and mock execSync to avoid real npm install.
 */

let tempDir: string;
let appDir: string;
let nextDir: string;
let buildStamp: string;
let depsStamp: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-build-test-'));
  appDir = path.join(tempDir, 'app');
  nextDir = path.join(appDir, '.next');
  buildStamp = path.join(nextDir, '.mindos-build-version');
  depsStamp = path.join(tempDir, 'deps-hash');

  // Create app dir with a package.json
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0' }));

  // Create root package.json
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'mindos', version: '0.5.12' }));

  vi.resetModules();

  vi.doMock('../../bin/lib/constants.js', () => ({
    ROOT: tempDir,
    BUILD_STAMP: buildStamp,
    DEPS_STAMP: depsStamp,
    CONFIG_PATH: path.join(tempDir, 'config.json'),
    MINDOS_DIR: tempDir,
    PID_PATH: path.join(tempDir, 'mindos.pid'),
    LOG_PATH: path.join(tempDir, 'mindos.log'),
    CLI_PATH: '',
    NODE_BIN: process.execPath,
    UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
  }));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function importBuild() {
  return await import('../../bin/lib/build.js') as {
    needsBuild: () => boolean;
    writeBuildStamp: () => void;
    cleanNextDir: () => void;
    clearBuildLock: () => void;
    ensureAppDeps: () => void;
  };
}

// ── needsBuild ──────────────────────────────────────────────────────────────

describe('needsBuild', () => {
  it('returns true when .next directory does not exist', async () => {
    const { needsBuild } = await importBuild();
    expect(needsBuild()).toBe(true);
  });

  it('returns true when .next exists but no build stamp', async () => {
    fs.mkdirSync(nextDir, { recursive: true });
    const { needsBuild } = await importBuild();
    expect(needsBuild()).toBe(true);
  });

  it('returns false when stamp version matches package.json', async () => {
    fs.mkdirSync(nextDir, { recursive: true });
    fs.writeFileSync(buildStamp, '0.5.12', 'utf-8');
    const { needsBuild } = await importBuild();
    expect(needsBuild()).toBe(false);
  });

  it('returns true when stamp version does not match', async () => {
    fs.mkdirSync(nextDir, { recursive: true });
    fs.writeFileSync(buildStamp, '0.4.0', 'utf-8');
    const { needsBuild } = await importBuild();
    expect(needsBuild()).toBe(true);
  });
});

// ── writeBuildStamp ─────────────────────────────────────────────────────────

describe('writeBuildStamp', () => {
  it('writes current version so needsBuild returns false', async () => {
    fs.mkdirSync(nextDir, { recursive: true });
    const { writeBuildStamp, needsBuild } = await importBuild();
    writeBuildStamp();
    expect(needsBuild()).toBe(false);
    expect(fs.readFileSync(buildStamp, 'utf-8')).toBe('0.5.12');
  });
});

// ── cleanNextDir ────────────────────────────────────────────────────────────

describe('cleanNextDir', () => {
  it('removes .next directory', async () => {
    fs.mkdirSync(nextDir, { recursive: true });
    fs.writeFileSync(path.join(nextDir, 'test.js'), 'x');
    const { cleanNextDir } = await importBuild();
    cleanNextDir();
    expect(fs.existsSync(nextDir)).toBe(false);
  });

  it('does not throw when .next does not exist', async () => {
    const { cleanNextDir } = await importBuild();
    expect(() => cleanNextDir()).not.toThrow();
  });
});

// ── clearBuildLock ──────────────────────────────────────────────────────────

describe('clearBuildLock', () => {
  it('removes .next/lock file', async () => {
    fs.mkdirSync(nextDir, { recursive: true });
    const lockFile = path.join(nextDir, 'lock');
    fs.writeFileSync(lockFile, '');
    const { clearBuildLock } = await importBuild();
    clearBuildLock();
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});

// ── ensureAppDeps ───────────────────────────────────────────────────────────

describe('ensureAppDeps', () => {
  it('skips install when next is present and deps hash matches', async () => {
    // Create node_modules/next/package.json
    const nextPkg = path.join(appDir, 'node_modules', 'next');
    fs.mkdirSync(nextPkg, { recursive: true });
    fs.writeFileSync(path.join(nextPkg, 'package.json'), '{}');

    // Write matching deps hash
    const { createHash } = await import('crypto');
    const pkgContent = fs.readFileSync(path.join(appDir, 'package.json'));
    const hash = createHash('sha256').update(pkgContent).digest('hex').slice(0, 16);
    fs.writeFileSync(depsStamp, hash, 'utf-8');

    // Mock execSync — should NOT be called for npm install
    const mockExec = vi.fn();
    vi.doMock('node:child_process', () => ({
      execSync: mockExec,
    }));
    vi.resetModules();

    // Re-mock constants after resetModules
    vi.doMock('../../bin/lib/constants.js', () => ({
      ROOT: tempDir,
      BUILD_STAMP: buildStamp,
      DEPS_STAMP: depsStamp,
      CONFIG_PATH: path.join(tempDir, 'config.json'),
      MINDOS_DIR: tempDir,
      PID_PATH: path.join(tempDir, 'mindos.pid'),
      LOG_PATH: path.join(tempDir, 'mindos.log'),
      CLI_PATH: '',
      NODE_BIN: process.execPath,
      UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
    }));

    const build = await importBuild();
    build.ensureAppDeps();
    // npm install should not have been called
    expect(mockExec).not.toHaveBeenCalled();
  });
});
