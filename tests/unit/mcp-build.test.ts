import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tempDir: string;
let mcpDir: string;
let srcDir: string;
let distDir: string;
let bundlePath: string;
let sdkPkgPath: string;
let esbuildPkgPath: string;
let mockRun: ReturnType<typeof vi.fn>;
let mockInstall: ReturnType<typeof vi.fn>;

function setMtime(targetPath: string, timeMs: number) {
  const time = new Date(timeMs);
  fs.utimesSync(targetPath, time, time);
}

function writeBundle(content = '// bundle') {
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(bundlePath, content);
}

function writeBuildDeps() {
  fs.mkdirSync(path.dirname(sdkPkgPath), { recursive: true });
  fs.writeFileSync(sdkPkgPath, '{}');
  fs.mkdirSync(path.dirname(esbuildPkgPath), { recursive: true });
  fs.writeFileSync(esbuildPkgPath, '{}');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-mcp-build-test-'));
  mcpDir = path.join(tempDir, 'packages', 'protocols', 'mcp-server');
  srcDir = path.join(mcpDir, 'src');
  distDir = path.join(mcpDir, 'dist');
  bundlePath = path.join(distDir, 'index.cjs');
  sdkPkgPath = path.join(mcpDir, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json');
  esbuildPkgPath = path.join(mcpDir, 'node_modules', 'esbuild', 'package.json');

  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export const ok = true;');
  fs.writeFileSync(path.join(mcpDir, 'package.json'), JSON.stringify({ name: '@mindos/mcp-server', version: '1.0.0' }));

  mockInstall = vi.fn(() => {
    writeBuildDeps();
  });
  mockRun = vi.fn((command: string) => {
    if (command === 'npm run build') {
      writeBundle();
    }
  });

  vi.resetModules();
  vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
    ROOT: tempDir,
    PACKAGE_ROOT: tempDir,
    PRODUCT_PACKAGE_JSON: path.join(tempDir, 'package.json'),
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
    execInherited: mockRun,
    npmInstall: mockInstall,
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
    fs.mkdirSync(path.join(tempDir, '_standalone', '__next'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '_standalone', '__node_modules'), { recursive: true });
    const now = Date.now();
    setMtime(bundlePath, now - 20_000);
    setMtime(path.join(srcDir, 'index.ts'), now);

    const { needsMcpBuild } = await importMcpBuild();
    expect(needsMcpBuild()).toBe(false);
  });
});

describe('ensureMcpBundle', () => {
  it('installs build deps and builds when the bundle is missing', async () => {
    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockInstall).toHaveBeenCalledWith(mcpDir, '--no-workspaces');
    expect(mockRun).toHaveBeenCalledWith('npm run build', mcpDir);
    expect(fs.existsSync(bundlePath)).toBe(true);
  });

  it('rebuilds stale bundles without reinstalling build deps', async () => {
    writeBuildDeps();
    writeBundle();
    const now = Date.now();
    setMtime(bundlePath, now - 20_000);
    setMtime(path.join(srcDir, 'index.ts'), now);

    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith('npm run build', mcpDir);
  });

  it('does nothing when the bundle is already current', async () => {
    writeBuildDeps();
    writeBundle();
    const now = Date.now();
    setMtime(srcDir, now - 10_000);
    setMtime(path.join(srcDir, 'index.ts'), now - 10_000);
    setMtime(path.join(mcpDir, 'package.json'), now - 10_000);
    setMtime(bundlePath, now);

    const { ensureMcpBundle } = await importMcpBuild();

    ensureMcpBundle();

    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
  });
});
