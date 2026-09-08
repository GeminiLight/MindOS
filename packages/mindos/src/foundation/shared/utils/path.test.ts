import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expandHome, expandWindowsEnvVars } from './path.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('expandHome', () => {
  it('expands ~, ~/ and ~\\ against the given home directory', () => {
    expect(expandHome('~', '/home/ada')).toBe('/home/ada');
    expect(expandHome('~/.claude.json', '/home/ada')).toBe(path.resolve('/home/ada', '.claude.json'));
    expect(expandHome('~\\.agent\\skills', '/home/ada')).toBe(path.resolve('/home/ada', '.agent\\skills'));
  });

  it('leaves other paths untouched', () => {
    expect(expandHome('/abs/path', '/home/ada')).toBe('/abs/path');
    expect(expandHome('relative/file.md', '/home/ada')).toBe('relative/file.md');
    expect(expandHome('~user/file', '/home/ada')).toBe('~user/file');
    expect(expandHome('', '/home/ada')).toBe('');
    expect(expandHome('文件/~/x', '/home/ada')).toBe('文件/~/x');
  });

  it('reads os.homedir() lazily so test spies apply', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/Ada');
    expect(expandHome('~/Tools')).toBe(path.resolve('/Users/Ada', 'Tools'));
  });
});

describe('expandWindowsEnvVars', () => {
  it('expands %VAR% from the provided environment and keeps unknown names', () => {
    expect(expandWindowsEnvVars('%APPDATA%\\Code', { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' }))
      .toBe('C:\\Users\\Ada\\AppData\\Roaming\\Code');
    expect(expandWindowsEnvVars('%MISSING%/x', {})).toBe('%MISSING%/x');
    expect(expandWindowsEnvVars('50% off', {})).toBe('50% off');
  });
});
