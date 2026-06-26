import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectLocalAcpAgents,
  expandHome,
  resolveCommandPath,
  resolveCommandPathCandidates,
  resolveCommandPathSync,
  resolveDirectCommandPath,
  resolveExistingPresenceDir,
} from './detect-local.js';

describe('ACP local detection path expansion', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue('/Users/Ada');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    homedirSpy.mockRestore();
  });

  it('expands Windows-style home-relative direct command paths', () => {
    const expected = path.resolve('/Users/Ada', 'Tools\\claude.exe');
    existsSyncSpy.mockImplementation((filePath: fs.PathLike) => String(filePath) === expected);

    expect(expandHome('~\\Tools\\claude.exe')).toBe(expected);
    expect(resolveDirectCommandPath('~\\Tools\\claude.exe')).toBe(expected);
  });

  it('expands Windows-style home-relative presence directories', () => {
    const expected = path.resolve('/Users/Ada', '.codex\\');
    existsSyncSpy.mockImplementation((filePath: fs.PathLike) => String(filePath) === expected);

    expect(resolveExistingPresenceDir(['~\\.codex\\'])).toBe(expected);
  });
});

describe('ACP local command resolution', () => {
  const originalPath = process.env.PATH;
  const originalPathUpper = process.env.Path;
  const originalPathLower = process.env.path;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  let tempRoots: string[] = [];

  beforeEach(() => {
    process.env.PATH = '';
    delete process.env.Path;
    delete process.env.path;
    tempRoots = [];
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathUpper === undefined) delete process.env.Path;
    else process.env.Path = originalPathUpper;
    if (originalPathLower === undefined) delete process.env.path;
    else process.env.path = originalPathLower;
    homedirSpy?.mockRestore();
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function createTempHome(): string {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'mindos-acp-home-'));
    tempRoots.push(root);
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home);
    return home;
  }

  function writeExecutable(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(filePath, 0o755);
  }

  function findExecutableDir(command: string): string | null {
    const searchDirs = [
      ...(originalPath ?? '').split(path.delimiter),
      '/usr/bin',
      '/bin',
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ].filter(Boolean);

    for (const dir of searchDirs) {
      const candidate = path.join(dir, command);
      if (fs.existsSync(candidate)) return dir;
    }
    return null;
  }

  it('resolves commands from common user bin directories when the server PATH is short', async () => {
    const home = createTempHome();
    const commandPath = path.join(home, '.local', 'bin', 'mindos-path-probe');
    writeExecutable(commandPath);

    await expect(resolveCommandPath('mindos-path-probe')).resolves.toBe(commandPath);
    expect(resolveCommandPathSync('mindos-path-probe')).toBe(commandPath);
  });

  it('includes nvm-managed node bins in command candidates', async () => {
    const home = createTempHome();
    const commandPath = path.join(home, '.nvm', 'versions', 'node', 'v22.1.0', 'bin', 'mindos-nvm-probe');
    writeExecutable(commandPath);

    await expect(resolveCommandPathCandidates('mindos-nvm-probe')).resolves.toContain(commandPath);
  });

  it.runIf(process.platform !== 'win32')('keeps current PATH resolution ahead of supplemental fallback directories', async () => {
    const whichDir = findExecutableDir('which');
    if (!whichDir) throw new Error('Expected a which executable to be available for current PATH resolution');

    const home = createTempHome();
    const envCommandPath = path.join(home, 'env-bin', 'mindos-precedence-probe');
    const fallbackCommandPath = path.join(home, '.local', 'bin', 'mindos-precedence-probe');
    writeExecutable(envCommandPath);
    writeExecutable(fallbackCommandPath);
    process.env.PATH = [path.dirname(envCommandPath), whichDir].join(path.delimiter);

    await expect(resolveCommandPath('mindos-precedence-probe')).resolves.toBe(envCommandPath);
    expect(resolveCommandPathSync('mindos-precedence-probe')).toBe(envCommandPath);

    const candidates = await resolveCommandPathCandidates('mindos-precedence-probe');
    expect(candidates).toEqual(expect.arrayContaining([envCommandPath, fallbackCommandPath]));
    expect(candidates.indexOf(envCommandPath)).toBeLessThan(candidates.indexOf(fallbackCommandPath));
  });

  it('detects custom ACP agents installed in common user bin directories', async () => {
    const home = createTempHome();
    const commandPath = path.join(home, '.local', 'bin', 'custom-acp-probe');
    writeExecutable(commandPath);

    const result = await detectLocalAcpAgents({
      overrides: {
        'custom-acp-probe': {
          name: 'Custom ACP Probe',
          command: 'custom-acp-probe',
          args: ['--acp'],
          installCmd: 'npm install -g custom-acp-probe',
        },
      },
    });

    expect(result.installed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'custom-acp-probe',
        name: 'Custom ACP Probe',
        binaryPath: commandPath,
        resolvedCommand: {
          cmd: 'custom-acp-probe',
          args: ['--acp'],
          source: 'user-override',
        },
      }),
    ]));
  });
});
