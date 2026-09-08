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
  resetCommandPathLookupCache,
} from './detect-local.js';

// Wrap child_process so tests can observe (and, when needed, short-circuit) the
// expensive `<shell> -lic` login-shell lookups without touching `which`.
const childProcessSpy = vi.hoisted(() => ({
  spawns: [] as Array<{ command: string; args: string[] }>,
  /** undefined = run the real shell, null = fail fast, string = pretend the shell printed it */
  fakeLoginShellOutput: undefined as string | null | undefined,
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const isLoginShell = (args: unknown): args is string[] => Array.isArray(args) && args.includes('-lic');
  const record = (params: unknown[]) => {
    const [command, args] = params as [string, unknown];
    childProcessSpy.spawns.push({ command, args: Array.isArray(args) ? [...args] : [] });
    return args;
  };
  return {
    ...actual,
    execFile: ((...params: unknown[]) => {
      const args = record(params);
      if (childProcessSpy.fakeLoginShellOutput !== undefined && isLoginShell(args)) {
        const callback = params[params.length - 1] as (error: Error | null, stdout: string, stderr: string) => void;
        const output = childProcessSpy.fakeLoginShellOutput;
        setImmediate(() => (output === null
          ? callback(new Error('fake login shell miss'), '', '')
          : callback(null, `${output}\n`, '')));
        return {} as ReturnType<typeof actual.execFile>;
      }
      return (actual.execFile as unknown as (...a: unknown[]) => unknown)(...params);
    }) as typeof actual.execFile,
    execFileSync: ((...params: unknown[]) => {
      const args = record(params);
      if (childProcessSpy.fakeLoginShellOutput !== undefined && isLoginShell(args)) {
        if (childProcessSpy.fakeLoginShellOutput === null) throw new Error('fake login shell miss');
        return `${childProcessSpy.fakeLoginShellOutput}\n`;
      }
      return (actual.execFileSync as unknown as (...a: unknown[]) => unknown)(...params);
    }) as typeof actual.execFileSync,
  };
});

const loginShellSpawns = () => childProcessSpy.spawns.filter((spawn) => spawn.args.includes('-lic'));

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
    resetCommandPathLookupCache();
    childProcessSpy.spawns.length = 0;
    childProcessSpy.fakeLoginShellOutput = undefined;
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

  it('does not spawn a login shell when a well-known install directory has the command', async () => {
    const home = createTempHome();
    const commandPath = path.join(home, '.local', 'bin', 'mindos-no-shell-probe');
    writeExecutable(commandPath);

    await expect(resolveCommandPath('mindos-no-shell-probe')).resolves.toBe(commandPath);
    expect(resolveCommandPathSync('mindos-no-shell-probe')).toBe(commandPath);
    await expect(resolveCommandPathCandidates('mindos-no-shell-probe')).resolves.toEqual([commandPath]);
    expect(loginShellSpawns()).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('falls back to a login shell only for unknown commands and memoises the miss', async () => {
    createTempHome();
    childProcessSpy.fakeLoginShellOutput = null;

    await expect(resolveCommandPath('mindos-missing-probe')).resolves.toBeNull();
    const spawnsAfterFirst = loginShellSpawns().length;
    expect(spawnsAfterFirst).toBeGreaterThan(0);

    await expect(resolveCommandPath('mindos-missing-probe')).resolves.toBeNull();
    expect(resolveCommandPathSync('mindos-missing-probe')).toBeNull();
    await expect(resolveCommandPathCandidates('mindos-missing-probe')).resolves.toEqual([]);
    // The candidates lookup uses a different shell script, so it is allowed one
    // more pass; nothing beyond that may spawn a shell within the TTL.
    const spawnsAfterCandidates = loginShellSpawns().length;
    expect(spawnsAfterCandidates).toBeLessThanOrEqual(spawnsAfterFirst * 2);
    await expect(resolveCommandPathCandidates('mindos-missing-probe')).resolves.toEqual([]);
    expect(loginShellSpawns().length).toBe(spawnsAfterCandidates);
  });

  it.runIf(process.platform !== 'win32')('shares one login-shell spawn between concurrent callers and the sync lookup', async () => {
    const home = createTempHome();
    const commandPath = path.join(home, 'shell-only-bin', 'mindos-shell-probe');
    writeExecutable(commandPath);
    childProcessSpy.fakeLoginShellOutput = commandPath;

    const [first, second] = await Promise.all([
      resolveCommandPath('mindos-shell-probe'),
      resolveCommandPath('mindos-shell-probe'),
    ]);
    expect(first).toBe(commandPath);
    expect(second).toBe(commandPath);
    expect(loginShellSpawns().length).toBe(1);

    expect(resolveCommandPathSync('mindos-shell-probe')).toBe(commandPath);
    expect(loginShellSpawns().length).toBe(1);
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
    // Every other descriptor is missing here; keep their login-shell probes fast.
    childProcessSpy.fakeLoginShellOutput = null;

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

  it.runIf(process.platform !== 'win32')('probes all missing commands with one login shell per shell binary', async () => {
    const home = createTempHome();
    const commandPath = path.join(home, 'shell-only-bin', 'custom-shell-probe');
    writeExecutable(commandPath);
    childProcessSpy.fakeLoginShellOutput = `custom-shell-probe\t${commandPath}`;

    const result = await detectLocalAcpAgents({
      overrides: {
        'custom-shell-probe': {
          name: 'Custom Shell Probe',
          command: 'custom-shell-probe',
          args: [],
          installCmd: 'npm install -g custom-shell-probe',
        },
      },
    });

    expect(result.installed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-shell-probe', binaryPath: commandPath }),
    ]));
    // ~17 probe commands, at most one spawn per login shell ($SHELL, zsh, bash, sh).
    expect(loginShellSpawns().length).toBeGreaterThan(0);
    expect(loginShellSpawns().length).toBeLessThanOrEqual(4);
    // The first shell resolves the probe; later shells only re-probe the misses.
    const [firstSpawn, ...laterSpawns] = loginShellSpawns();
    expect(firstSpawn.args[1]).toContain("command -v -- 'custom-shell-probe'");
    expect(firstSpawn.args[1]).toContain("command -v -- 'codex'");
    for (const spawn of laterSpawns) {
      expect(spawn.args[1]).not.toContain("'custom-shell-probe'");
    }

    // A second detection within the TTL reuses the memoised misses and hit.
    const spawnsBefore = loginShellSpawns().length;
    await detectLocalAcpAgents({ overrides: { 'custom-shell-probe': { name: 'x', command: 'custom-shell-probe', args: [] } } });
    expect(loginShellSpawns().length).toBe(spawnsBefore);
  });
});
