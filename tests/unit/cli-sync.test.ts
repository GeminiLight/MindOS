import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempDir: string;
let mindosDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-sync-test-'));
  mindosDir = path.join(tempDir, '.mindos');
  configPath = path.join(mindosDir, 'config.json');

  vi.resetModules();
  vi.doMock('../../packages/mindos/bin/lib/constants.js', () => ({
    CONFIG_PATH: configPath,
    MINDOS_DIR: mindosDir,
  }));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function importSync() {
  return await import('../../packages/mindos/bin/lib/sync.js') as {
    setSyncEnabled: (enabled: boolean) => void;
    getSyncStatus: (mindRoot?: string) => {
      enabled: boolean;
      provider?: string;
    };
    getSyncConflictBackupPath: (mindRoot: string, file: string) => string;
    getSyncGitignorePath: (mindRoot: string) => string;
  };
}

describe('mindos sync config persistence', () => {
  it('creates the config directory before writing sync settings', async () => {
    const { setSyncEnabled } = await importSync();

    expect(() => setSyncEnabled(true)).not.toThrow();
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).sync.enabled).toBe(true);
  });

  it('reads sync settings from a BOM-prefixed config file', async () => {
    fs.mkdirSync(mindosDir, { recursive: true });
    fs.writeFileSync(configPath, `\uFEFF${JSON.stringify({ sync: { enabled: true, provider: 'git' } })}`, 'utf-8');

    const { getSyncStatus } = await importSync();

    expect(getSyncStatus(undefined)).toMatchObject({ enabled: true, provider: 'git' });
  });

  it('rejects conflict backup paths outside the knowledge base', async () => {
    const { getSyncConflictBackupPath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    fs.mkdirSync(mindRoot);

    expect(() => getSyncConflictBackupPath(mindRoot, '../secret.md')).toThrow('Access denied');
    expect(getSyncConflictBackupPath(mindRoot, 'notes/a.md')).toBe(path.join(mindRoot, 'notes', 'a.md.sync-conflict'));
  });

  it('rejects .gitignore writes through symlinks outside the knowledge base', async () => {
    const { getSyncGitignorePath } = await importSync();
    const mindRoot = path.join(tempDir, 'mind');
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(mindRoot);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, '.gitignore'), 'outside\n', 'utf-8');
    fs.symlinkSync(path.join(outside, '.gitignore'), path.join(mindRoot, '.gitignore'));

    expect(() => getSyncGitignorePath(mindRoot)).toThrow('Access denied');
    expect(fs.readFileSync(path.join(outside, '.gitignore'), 'utf-8')).toBe('outside\n');
  });
});
