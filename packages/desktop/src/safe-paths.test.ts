import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getRuntimePaths, validateRuntimePath } from './safe-paths';

const originalHome = process.env.MINDOS_DESKTOP_HOME_DIR;

afterEach(() => {
  if (originalHome === undefined) delete process.env.MINDOS_DESKTOP_HOME_DIR;
  else process.env.MINDOS_DESKTOP_HOME_DIR = originalHome;
});

describe('safe runtime paths', () => {
  it('validates every path returned by getRuntimePaths', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-desktop-home-'));
    process.env.MINDOS_DESKTOP_HOME_DIR = home;

    try {
      const paths = getRuntimePaths();

      expect(validateRuntimePath(paths.runtimeDir)).toBe(paths.runtimeDir);
      expect(validateRuntimePath(paths.downloadDir)).toBe(paths.downloadDir);
      expect(validateRuntimePath(paths.oldDir)).toBe(paths.oldDir);
      expect(validateRuntimePath(paths.tarballPath)).toBe(paths.tarballPath);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('allows runtime paths when the home directory name contains consecutive dots', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos..desktop-home-'));
    process.env.MINDOS_DESKTOP_HOME_DIR = home;

    try {
      const paths = getRuntimePaths();

      expect(validateRuntimePath(paths.runtimeDir)).toBe(paths.runtimeDir);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects paths outside the desktop config directory', () => {
    const home = mkdtempSync(join(tmpdir(), 'mindos-desktop-home-'));
    process.env.MINDOS_DESKTOP_HOME_DIR = home;

    try {
      expect(() => validateRuntimePath(join(home, '.mindos-other', 'runtime'))).toThrow(/outside \.mindos/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
