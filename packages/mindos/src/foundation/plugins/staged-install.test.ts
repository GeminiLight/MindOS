import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stagedDirectorySwap } from './staged-install.js';

let root: string;
let targetDir: string;

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

function populateBasic(stageDir: string): void {
  write(path.join(stageDir, 'manifest.json'), '{"id":"demo"}');
  write(path.join(stageDir, 'main.js'), 'console.log(1);');
}

function stagedEntries(prefix: string): string[] {
  return fs.readdirSync(root).filter((entry) => entry.startsWith(prefix));
}

describe('stagedDirectorySwap', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-staged-install-'));
    targetDir = path.join(root, 'target');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('stages, populates, and renames into place', () => {
    const result = stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.installing-demo-',
    });

    expect(result.targetDir).toBe(targetDir);
    expect(result.replaced).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toBe('{"id":"demo"}');
    expect(stagedEntries('.installing-demo-')).toEqual([]);
  });

  it('creates the stage directory with the requested prefix inside stageParentDir', () => {
    const seen: string[] = [];
    stagedDirectorySwap(targetDir, (stageDir) => {
      seen.push(stageDir);
      populateBasic(stageDir);
    }, { stageParentDir: root, stagePrefix: '.updating-demo-' });

    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith(path.join(root, '.updating-demo-'))).toBe(true);
  });

  it('refuses to touch an existing target when replace is false', () => {
    write(path.join(targetDir, 'keep.txt'), 'original');

    expect(() => stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.installing-demo-',
      existsMessage: 'already installed: demo',
    })).toThrow('already installed: demo');

    expect(fs.readFileSync(path.join(targetDir, 'keep.txt'), 'utf-8')).toBe('original');
    expect(stagedEntries('.installing-demo-')).toEqual([]);
  });

  it('backs up and replaces an existing target when replace is true', () => {
    write(path.join(targetDir, 'old.txt'), 'old');

    const result = stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.staging-',
      backupPrefix: '.previous-',
      replace: true,
    });

    expect(result.replaced).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'old.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toBe('{"id":"demo"}');
    expect(stagedEntries('.previous-')).toEqual([]);
  });

  it('cleans the staging directory when the final rename fails', () => {
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    expect(() => stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.installing-demo-',
    })).toThrow('rename failed');

    expect(fs.existsSync(targetDir)).toBe(false);
    expect(stagedEntries('.installing-demo-')).toEqual([]);
  });

  it('restores the backup when the publish rename fails mid-swap', () => {
    write(path.join(targetDir, 'main.js'), 'local main');
    const originalRename = fs.renameSync;
    let renameCalls = 0;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        throw new Error('publish failed');
      }
      return originalRename(from, to);
    });

    expect(() => stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.updating-demo-',
      backupPrefix: '.previous-demo-',
      replace: true,
    })).toThrow('publish failed');

    expect(fs.readFileSync(path.join(targetDir, 'main.js'), 'utf-8')).toBe('local main');
    expect(stagedEntries('.updating-demo-')).toEqual([]);
    expect(stagedEntries('.previous-demo-')).toEqual([]);
  });

  it('runs beforeSwap after populate and before any rename, and cleans up when it throws', () => {
    write(path.join(targetDir, 'old.txt'), 'old');
    const order: string[] = [];
    stagedDirectorySwap(targetDir, (stageDir) => {
      order.push('populate');
      populateBasic(stageDir);
    }, {
      stageParentDir: root,
      stagePrefix: '.updating-demo-',
      backupPrefix: '.previous-demo-',
      replace: true,
      beforeSwap: () => {
        order.push('beforeSwap');
        expect(fs.existsSync(targetDir)).toBe(true);
      },
      onSwapped: () => {
        order.push('onSwapped');
      },
    });

    expect(order).toEqual(['populate', 'beforeSwap', 'onSwapped']);

    expect(() => stagedDirectorySwap(path.join(root, 'second'), populateBasic, {
      stageParentDir: root,
      stagePrefix: '.updating-second-',
      beforeSwap: () => {
        throw new Error('host disabled the plugin');
      },
    })).toThrow('host disabled the plugin');
    expect(stagedEntries('.updating-second-')).toEqual([]);
    expect(fs.existsSync(path.join(root, 'second'))).toBe(false);
  });

  it('runs validate against the staged directory and aborts the swap when it throws', () => {
    expect(() => stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.installing-demo-',
      validate: (stageDir) => {
        if (!fs.existsSync(path.join(stageDir, 'styles.css'))) {
          throw new Error('staged package is incomplete');
        }
      },
    })).toThrow('staged package is incomplete');

    expect(fs.existsSync(targetDir)).toBe(false);
    expect(stagedEntries('.installing-demo-')).toEqual([]);
  });

  it('lets onSwapped observe the published target and return a result payload', () => {
    const result = stagedDirectorySwap<{ preserved: boolean }>(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.updating-demo-',
      onSwapped: (publishedDir) => ({ preserved: fs.existsSync(path.join(publishedDir, 'manifest.json')) }),
    });

    expect(result.payload).toEqual({ preserved: true });
  });

  it('tolerates backup cleanup failures when asked to and keeps the published target', () => {
    write(path.join(targetDir, 'old.txt'), 'old');
    vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw new Error('EBUSY: backup pinned');
    });

    const tolerated = stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.updating-demo-',
      backupPrefix: '.previous-demo-',
      replace: true,
      tolerateBackupCleanupFailure: true,
    });

    expect(tolerated.replaced).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toBe('{"id":"demo"}');
    // The stale hidden backup survives but the published target is intact.
    expect(stagedEntries('.previous-demo-')).toHaveLength(1);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
  });

  it('rethrows backup cleanup failures when tolerance is off but keeps the published swap', () => {
    write(path.join(targetDir, 'old.txt'), 'old');
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('EBUSY: backup pinned');
    });

    expect(() => stagedDirectorySwap(targetDir, populateBasic, {
      stageParentDir: root,
      stagePrefix: '.updating-demo-',
      backupPrefix: '.previous-demo-',
      replace: true,
    })).toThrow('EBUSY: backup pinned');

    // Mirrors the runtime-extensions rollback branch: the target still exists,
    // so no restore happens and the published content stays; the pinned backup
    // survives because cleanup itself is what failed.
    expect(fs.readFileSync(path.join(targetDir, 'manifest.json'), 'utf-8')).toBe('{"id":"demo"}');
    expect(stagedEntries('.previous-demo-')).toHaveLength(1);
  });

  it('uses unique stage directory names across sequential swaps', () => {
    const staged: string[] = [];
    for (const index of [0, 1, 2, 3]) {
      stagedDirectorySwap(path.join(root, `t${index}`), (stageDir) => {
        staged.push(stageDir);
        write(path.join(stageDir, 'main.js'), `v${index}`);
      }, { stageParentDir: root, stagePrefix: '.installing-demo-' });
    }

    expect(new Set(staged).size).toBe(4);
    for (const index of [0, 1, 2, 3]) {
      expect(fs.readFileSync(path.join(root, `t${index}`, 'main.js'), 'utf-8')).toBe(`v${index}`);
    }
  });
});
