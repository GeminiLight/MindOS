import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Tests for packages/mindos/bin/lib/build.js — needsBuild, writeBuildStamp, cleanNextDir, ensureAppDeps.
 *
 * We mock constants.js to point ROOT/BUILD_STAMP/DEPS_STAMP at a temp directory,
 * and mock child_process to avoid real install/probe commands.
 */

let tempDir: string;
let appDir: string;
let nextDir: string;
let buildStamp: string;
let depsStamp: string;
let staticWebIndex: string;
let staticWebStamp: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-build-test-'));
  appDir = path.join(tempDir, 'app');
  nextDir = path.join(appDir, '.next');
  buildStamp = path.join(nextDir, '.mindos-build-version');
  depsStamp = path.join(tempDir, 'deps-hash');
  staticWebIndex = path.join(tempDir, 'static-web', 'index.html');
  staticWebStamp = path.join(tempDir, 'static-web', '.mindos-build-version');

  // Create app dir with a package.json
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0' }));

  // Create root package.json
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'mindos', version: '0.5.12' }));

  vi.resetModules();

  vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
    ROOT: tempDir,
    PACKAGE_ROOT: tempDir,
    PRODUCT_PACKAGE_JSON: path.join(tempDir, 'package.json'),
    WEB_APP_DIR: appDir,
    BUILD_STAMP: buildStamp,
    DEPS_STAMP: depsStamp,
    CONFIG_PATH: path.join(tempDir, 'config.json'),
    MINDOS_DIR: tempDir,
    PID_PATH: path.join(tempDir, 'mindos.pid'),
    LOG_PATH: path.join(tempDir, 'mindos.log'),
    CLI_PATH: '',
    NODE_BIN: process.execPath,
    UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
    STATIC_WEB_ROOT: path.join(tempDir, 'static-web'),
    STATIC_WEB_INDEX: staticWebIndex,
    STATIC_WEB_STAMP: staticWebStamp,
    STANDALONE_SERVER: path.join(tempDir, '_standalone', 'server.js'),
    STANDALONE_STAMP: path.join(tempDir, '_standalone', '.mindos-build-version'),
  }));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function importBuild() {
  return await import('../../packages/mindos/bin/lib/build.js') as {
    needsBuild: () => boolean;
    writeBuildStamp: () => void;
    cleanNextDir: () => void;
    clearBuildLock: () => void;
    ensureAppDeps: () => void;
    hasPrebuiltStaticWeb: () => boolean;
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

  it('returns false when a matching static Web artifact exists', async () => {
    fs.mkdirSync(path.dirname(staticWebIndex), { recursive: true });
    fs.writeFileSync(staticWebIndex, '<html></html>', 'utf-8');
    fs.writeFileSync(staticWebStamp, '0.5.12', 'utf-8');
    const { hasPrebuiltStaticWeb, needsBuild } = await importBuild();
    expect(hasPrebuiltStaticWeb()).toBe(true);
    expect(needsBuild()).toBe(false);
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
  it('uses argv-safe subprocess probes for npm and pnpm availability', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'lib', 'build.js'), 'utf-8');

    expect(source).not.toContain('execSync(');
    expect(source).toContain("execFileSync(command, ['--version']");
    expect(source).toContain("const command = usePnpmWorkspaceInstall ? 'pnpm' : 'npm'");
  });

  it('formats manual dependency repair hints through the shared path-quoting helper', () => {
    const source = fs.readFileSync(path.join(ROOT, 'packages', 'mindos', 'bin', 'lib', 'build.js'), 'utf-8');

    expect(source).toContain('formatManualCdCommand');
    expect(source).not.toContain('Try manually: cd ${ROOT}');
    expect(source).not.toContain('Try manually: cd ${appDir}');
  });

  it('skips install when next is present and deps hash matches', async () => {
    // Create node_modules/next/package.json
    const nextPkg = path.join(appDir, 'node_modules', 'next');
    fs.mkdirSync(nextPkg, { recursive: true });
    fs.writeFileSync(path.join(nextPkg, 'package.json'), '{}');

    // Write matching deps hash
    const { createHash } = await import('crypto');
    const hash = createHash('sha256')
      .update(fs.readFileSync(path.join(tempDir, 'package.json')))
      .update(fs.readFileSync(path.join(appDir, 'package.json')))
      .digest('hex')
      .slice(0, 16);
    fs.writeFileSync(depsStamp, hash, 'utf-8');

    // Mock child_process — should NOT be called for install/probe commands
    const mockExec = vi.fn();
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExec,
    }));
    vi.resetModules();

    // Re-mock constants after resetModules
    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      ROOT: tempDir,
      PACKAGE_ROOT: tempDir,
      PRODUCT_PACKAGE_JSON: path.join(tempDir, 'package.json'),
      WEB_APP_DIR: appDir,
      BUILD_STAMP: buildStamp,
      DEPS_STAMP: depsStamp,
      CONFIG_PATH: path.join(tempDir, 'config.json'),
      MINDOS_DIR: tempDir,
      PID_PATH: path.join(tempDir, 'mindos.pid'),
      LOG_PATH: path.join(tempDir, 'mindos.log'),
      CLI_PATH: '',
      NODE_BIN: process.execPath,
      UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
      STATIC_WEB_ROOT: path.join(tempDir, 'static-web'),
      STATIC_WEB_INDEX: staticWebIndex,
      STATIC_WEB_STAMP: staticWebStamp,
      STANDALONE_SERVER: path.join(tempDir, '_standalone', 'server.js'),
      STANDALONE_STAMP: path.join(tempDir, '_standalone', '.mindos-build-version'),
    }));

    const build = await importBuild();
    build.ensureAppDeps();
    // install/probe commands should not have been called
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('uses pnpm at the workspace root when app dependencies include workspace protocol', async () => {
    fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), "packages:\n  - 'app'\n");
    fs.writeFileSync(
      path.join(appDir, 'package.json'),
      JSON.stringify({
        name: '@mindos/web',
        version: '1.0.0',
        dependencies: {
          '@geminilight/mindos': 'workspace:*',
        },
      }),
    );

    const mockExecFileSync = vi.fn(() => Buffer.from('10.0.0'));
    vi.doMock('node:child_process', () => ({
      execFileSync: mockExecFileSync,
    }));

    const mockNpmInstall = vi.fn();
    const mockRun = vi.fn((_command: string, _args: string[], cwd: string) => {
      expect(cwd).toBe(tempDir);
      for (const dep of ['next', 'react', 'react-dom']) {
        const depDir = path.join(appDir, 'node_modules', dep);
        fs.mkdirSync(depDir, { recursive: true });
        fs.writeFileSync(path.join(depDir, 'package.json'), '{}');
      }
    });
    vi.doMock('../../packages/mindos/bin/lib/shell.js', () => ({
      execInheritedFile: mockRun,
      npmInstall: mockNpmInstall,
    }));

    vi.resetModules();

    vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
      ROOT: tempDir,
      PACKAGE_ROOT: tempDir,
      PRODUCT_PACKAGE_JSON: path.join(tempDir, 'package.json'),
      WEB_APP_DIR: appDir,
      BUILD_STAMP: buildStamp,
      DEPS_STAMP: depsStamp,
      CONFIG_PATH: path.join(tempDir, 'config.json'),
      MINDOS_DIR: tempDir,
      PID_PATH: path.join(tempDir, 'mindos.pid'),
      LOG_PATH: path.join(tempDir, 'mindos.log'),
      CLI_PATH: '',
      NODE_BIN: process.execPath,
      UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
      STATIC_WEB_ROOT: path.join(tempDir, 'static-web'),
      STATIC_WEB_INDEX: staticWebIndex,
      STATIC_WEB_STAMP: staticWebStamp,
      STANDALONE_SERVER: path.join(tempDir, '_standalone', 'server.js'),
      STANDALONE_STAMP: path.join(tempDir, '_standalone', '.mindos-build-version'),
    }));

    const build = await importBuild();
    build.ensureAppDeps();

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['--version'], { stdio: 'pipe' });
    expect(mockRun).toHaveBeenCalledWith('pnpm', ['install', '--no-frozen-lockfile'], tempDir);
    expect(mockNpmInstall).not.toHaveBeenCalled();
  });
});
