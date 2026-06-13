import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;
let mcpDir: string;
let srcDir: string;
let distDir: string;
let bundlePath: string;
let protocolsBuilderPath: string;
let mockRun: ReturnType<typeof vi.fn>;

function setMtime(targetPath: string, timeMs: number) {
  const time = new Date(timeMs);
  fs.utimesSync(targetPath, time, time);
}

function writeBundle(content = '// bundle') {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(bundlePath, content);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-build-test-'));
  // Mirror the monorepo layout: PACKAGE_ROOT two levels below the repo root,
  // so `../../scripts/build-product-protocols.mjs` resolves inside the sandbox.
  mcpDir = path.join(tempDir, 'packages', 'mindos');
  srcDir = path.join(mcpDir, 'src', 'protocols', 'mcp-server');
  distDir = path.join(mcpDir, 'dist', 'protocols', 'mcp-server');
  bundlePath = path.join(distDir, 'index.cjs');
  protocolsBuilderPath = path.join(tempDir, 'scripts', 'build-product-protocols.mjs');

  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export const ok = true;');
  fs.writeFileSync(path.join(mcpDir, 'package.json'), JSON.stringify({ name: '@geminilight/mindos', version: '1.0.0' }));
  // Dev-checkout default: the monorepo protocols builder exists.
  fs.mkdirSync(path.dirname(protocolsBuilderPath), { recursive: true });
  fs.writeFileSync(protocolsBuilderPath, '// esbuild protocols builder');

  mockRun = vi.fn((args: string[]) => {
    if (args.join(' ') === 'run build:protocols') {
      writeBundle();
    }
  });

  vi.resetModules();
  vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
    ROOT: tempDir,
    PACKAGE_ROOT: mcpDir,
    PRODUCT_PACKAGE_JSON: path.join(mcpDir, 'package.json'),
    BUILD_STAMP: path.join(tempDir, 'app', '.next', '.mindos-build-version'),
    DEPS_STAMP: path.join(tempDir, 'deps-hash'),
    CONFIG_PATH: path.join(tempDir, 'config.json'),
    MINDOS_DIR: tempDir,
    PID_PATH: path.join(tempDir, 'mindos.pid'),
    LOG_PATH: path.join(tempDir, 'mindos.log'),
    CLI_PATH: path.join(tempDir, 'bin', 'cli.js'),
    NODE_BIN: process.execPath,
    UPDATE_CHECK_PATH: path.join(tempDir, 'update-check.json'),
    STANDALONE_SERVER: path.join(tempDir, '_standalone', 'server.js'),
    STANDALONE_STAMP: path.join(tempDir, '_standalone', '.mindos-build-version'),
  }));
  vi.doMock('../../packages/mindos/bin/lib/shell.js', () => ({
    execNpmInherited: mockRun,
  }));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function importMcpBuild() {
  return await import('../../packages/mindos/bin/lib/mcp-build.js') as {
    needsMcpBuild: () => boolean;
    ensureMcpBundle: () => void;
  };
}

describe('needsMcpBuild', () => {
  it('returns true when the MCP bundle is missing', async () => {
    const { needsMcpBuild } = await importMcpBuild();
    expect(needsMcpBuild()).toBe(true);
  });

  it('returns false when the bundle is newer than source inputs', async () => {
    writeBundle();
    const now = Date.now();
    setMtime(srcDir, now - 10_000);
    setMtime(path.join(srcDir, 'index.ts'), now - 10_000);
    setMtime(path.join(mcpDir, 'package.json'), now - 10_000);
    setMtime(bundlePath, now);

    const { needsMcpBuild } = await importMcpBuild();
    expect(needsMcpBuild()).toBe(false);
  });

  it('returns true when source changes after the bundle was built', async () => {
    writeBundle();
    const now = Date.now();
    setMtime(bundlePath, now - 20_000);
    setMtime(path.join(srcDir, 'index.ts'), now);

    const { needsMcpBuild } = await importMcpBuild();
    expect(needsMcpBuild()).toBe(true);
  });

  it('uses the prebuilt bundle in packaged npm installs even when source mtimes are newer', async () => {
    writeBundle();
    fs.mkdirSync(path.join(mcpDir, '_standalone', '__next'), { recursive: true });
    fs.mkdirSync(path.join(mcpDir, '_standalone', '__node_modules'), { recursive: true });
    const now = Date.now();
    setMtime(bundlePath, now - 20_000);
    setMtime(path.join(srcDir, 'index.ts'), now);

    const { needsMcpBuild } = await importMcpBuild();
    expect(needsMcpBuild()).toBe(false);
  });
});

describe('ensureMcpBundle', () => {
  it('builds from product protocol sources when the bundle is missing', async () => {
    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockRun).toHaveBeenCalledWith(['run', 'build:protocols'], mcpDir);
    expect(fs.existsSync(bundlePath)).toBe(true);
  });

  it('rebuilds stale bundles', async () => {
    writeBundle();
    const now = Date.now();
    setMtime(bundlePath, now - 20_000);
    setMtime(path.join(srcDir, 'index.ts'), now);

    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockRun).toHaveBeenCalledWith(['run', 'build:protocols'], mcpDir);
  });

  it('does nothing when the bundle is already current', async () => {
    writeBundle();
    const now = Date.now();
    setMtime(srcDir, now - 10_000);
    setMtime(path.join(srcDir, 'index.ts'), now - 10_000);
    setMtime(path.join(mcpDir, 'package.json'), now - 10_000);
    setMtime(bundlePath, now);

    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('uses the shipped bundle in packaged runtimes (no monorepo builder) even when package.json looks newer', async () => {
    // The Desktop runtime copy under ~/.mindos/runtime ships src/ + bundle but
    // not the monorepo build script; deployment can stamp package.json a few
    // ms after the bundle, which must NOT trigger a doomed rebuild.
    writeBundle();
    fs.rmSync(protocolsBuilderPath);
    const now = Date.now();
    setMtime(bundlePath, now - 1_000);
    setMtime(path.join(mcpDir, 'package.json'), now);

    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockRun).not.toHaveBeenCalled();
    expect(fs.existsSync(bundlePath)).toBe(true);
  });

  it('throws a clear error when neither the bundle nor the monorepo builder exists', async () => {
    fs.rmSync(protocolsBuilderPath);

    const { ensureMcpBundle } = await importMcpBuild();

    expect(() => ensureMcpBundle()).toThrow(/protocols builder missing/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('prints rebuild progress to stderr so a stdio JSON-RPC stream stays clean', async () => {
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ensureMcpBundle } = await importMcpBuild();
    ensureMcpBundle(); // bundle missing → rebuild path

    expect(mockRun).toHaveBeenCalledWith(['run', 'build:protocols'], mcpDir);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Building MCP bundle'));
  });
});
