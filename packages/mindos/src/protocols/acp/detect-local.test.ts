import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandHome, resolveDirectCommandPath, resolveExistingPresenceDir } from './detect-local.js';

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
