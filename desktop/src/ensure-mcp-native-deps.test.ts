import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, afterEach, vi } from 'vitest';

const created: string[] = [];

function makeTemp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function scaffold(root: string, opts: { nodeModules?: boolean; sdkPkg?: boolean; lockfile?: boolean } = {}) {
  const mcpDir = path.join(root, 'mcp');
  mkdirSync(mcpDir, { recursive: true });
  writeFileSync(path.join(mcpDir, 'package.json'), JSON.stringify({
    name: 'mindos-mcp', dependencies: { '@modelcontextprotocol/sdk': '^1.25.0', tsx: '^4', zod: '^3' },
  }));
  if (opts.lockfile) {
    writeFileSync(path.join(mcpDir, 'package-lock.json'), '{}');
  }
  if (opts.nodeModules) {
    mkdirSync(path.join(mcpDir, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(path.join(mcpDir, 'node_modules', '.bin', 'tsx'), '');
  }
  if (opts.sdkPkg) {
    const sdkDir = path.join(mcpDir, 'node_modules', '@modelcontextprotocol', 'sdk');
    mkdirSync(sdkDir, { recursive: true });
    writeFileSync(path.join(sdkDir, 'package.json'), '{}');
  }
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (created.length) {
    const d = created.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0, stdout: null, stderr: null, signal: null, pid: 0, output: [] })),
  };
});

import { ensureBundledMcpNodeModules } from './ensure-mcp-native-deps';
import { spawnSync } from 'child_process';

describe('ensureBundledMcpNodeModules', () => {
  it('does nothing when mcp/package.json is absent', () => {
    const root = makeTemp('mindos-no-mcp-');
    mkdirSync(path.join(root, 'mcp'), { recursive: true });
    ensureBundledMcpNodeModules(root, '/usr/bin/node', {});
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('runs npm install when node_modules is completely missing (bug repro)', () => {
    const root = scaffold(makeTemp('mindos-fresh-'));
    ensureBundledMcpNodeModules(root, '/usr/bin/node', {});
    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['install', '--omit=dev']),
      expect.objectContaining({ cwd: path.join(root, 'mcp') }),
    );
  });

  it('runs npm install when node_modules exists but SDK is missing', () => {
    const root = scaffold(makeTemp('mindos-partial-'), { nodeModules: true });
    ensureBundledMcpNodeModules(root, '/usr/bin/node', {});
    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['install', '--omit=dev']),
      expect.objectContaining({ cwd: path.join(root, 'mcp') }),
    );
  });

  it('does nothing when SDK package.json exists and no lockfile (npm-installed, deps complete)', () => {
    const root = scaffold(makeTemp('mindos-ok-'), { nodeModules: true, sdkPkg: true });
    ensureBundledMcpNodeModules(root, '/usr/bin/node', {});
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('does nothing when SDK exists with lockfile and platform matches', () => {
    const root = scaffold(makeTemp('mindos-bundled-ok-'), { nodeModules: true, sdkPkg: true, lockfile: true });
    ensureBundledMcpNodeModules(root, '/usr/bin/node', {});
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('falls back to online install when --prefer-offline fails', () => {
    const root = scaffold(makeTemp('mindos-offline-fail-'));
    const mock = vi.mocked(spawnSync);
    mock.mockReturnValueOnce({ status: 1, stdout: null, stderr: null, signal: null, pid: 0, output: [] } as any);
    mock.mockReturnValueOnce({ status: 0, stdout: null, stderr: null, signal: null, pid: 0, output: [] } as any);
    ensureBundledMcpNodeModules(root, '/usr/bin/node', {});
    expect(mock).toHaveBeenCalledTimes(2);
    const secondCall = mock.mock.calls[1][1] as string[];
    expect(secondCall).not.toContain('--prefer-offline');
    expect(secondCall).toContain('install');
  });

  it('throws when both offline and online install fail', () => {
    const root = scaffold(makeTemp('mindos-all-fail-'));
    const mock = vi.mocked(spawnSync);
    mock.mockReturnValue({ status: 1, stdout: null, stderr: null, signal: null, pid: 0, output: [] } as any);
    expect(() => ensureBundledMcpNodeModules(root, '/usr/bin/node', {})).toThrow(/MCP dependency install failed/);
  });
});
