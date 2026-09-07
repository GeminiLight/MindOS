import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withConnectionRegistryLock } from './registry-lock.js';

describe('connection registry lock ownership', () => {
  let root: string;
  let lock: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mindos-lock-'));
    lock = join(root, 'bindings.lock');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('publishes the lock with an owner already present and prevents a competing acquisition', () => {
    withConnectionRegistryLock(lock, () => {
      expect(existsSync(lock)).toBe(true);
      expect(readdirSync(lock)).toEqual([expect.stringMatching(/^owner-\d+-[a-f0-9-]+$/)]);
      expect(() => withConnectionRegistryLock(lock, () => {})).toThrow(/busy/i);
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it('releases ownership even when the operation throws', () => {
    expect(() => withConnectionRegistryLock(lock, () => { throw new Error('disk full'); })).toThrow('disk full');
    expect(withConnectionRegistryLock(lock, () => 'next')).toBe('next');
  });

  it('recovers a dead directory owner and an interrupted empty release', () => {
    const dead = spawnSync(process.execPath, ['-e', '']);
    expect(dead.status).toBe(0);
    mkdirSync(lock);
    writeFileSync(join(lock, `owner-${dead.pid}-dead`), '');
    utimesSync(lock, new Date(0), new Date(0));
    expect(withConnectionRegistryLock(lock, () => 'recovered')).toBe('recovered');
    expect(existsSync(lock)).toBe(false);
    mkdirSync(lock);
    utimesSync(lock, new Date(0), new Date(0));
    expect(withConnectionRegistryLock(lock, () => 'released')).toBe('released');
  });

  it('does not remove a replacement owner when an old owner releases', () => {
    withConnectionRegistryLock(lock, () => {
      // Model a takeover: cleanup must address its unique owner, never a shared owner filename.
      expect(existsSync(lock)).toBe(true);
      rmSync(lock, { recursive: true });
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner-999999-replacement'), '');
    });
    expect(readdirSync(lock)).toEqual(['owner-999999-replacement']);
  });

  it('serializes updates from two real processes recovering the same legacy lock', async () => {
    writeFileSync(lock, '');
    utimesSync(lock, new Date(0), new Date(0));
    const counter = join(root, 'counter');
    writeFileSync(counter, '0');
    const worker = `
      import { withConnectionRegistryLock } from ${JSON.stringify(new URL('./registry-lock.ts', import.meta.url).href)};
      import { readFileSync, writeFileSync } from 'node:fs';
      const wait = new Int32Array(new SharedArrayBuffer(4));
      for (let done = 0, attempts = 0; done < 30; attempts++) {
        if (attempts > 3000) throw new Error('lock starvation');
        try {
          withConnectionRegistryLock(${JSON.stringify(lock)}, () => {
            const value = Number(readFileSync(${JSON.stringify(counter)}, 'utf8'));
            Atomics.wait(wait, 0, 0, 1);
            writeFileSync(${JSON.stringify(counter)}, String(value + 1));
          });
          done++;
        } catch (error) { if (!/busy/.test(error.message)) throw error; Atomics.wait(wait, 0, 0, 1); }
      }
    `;
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', worker], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    await Promise.all([run(), run()]);
    expect(readFileSync(counter, 'utf8')).toBe('60');
    expect(existsSync(lock)).toBe(false);
  });
});
