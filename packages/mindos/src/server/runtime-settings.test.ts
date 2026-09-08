import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRuntimeSettings, writeRuntimeSettings } from './runtime.js';

describe('runtime settings persistence', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mindos-runtime-settings-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('writes config.json atomically and leaves no temp files behind', () => {
    writeRuntimeSettings({ mindRoot: '/tmp/mind', authToken: 'secret' }, { homeDir: home });
    const dir = join(home, '.mindos');
    expect(readdirSync(dir)).toEqual(['config.json']);
    expect(readRuntimeSettings({ homeDir: home })).toMatchObject({ mindRoot: '/tmp/mind', authToken: 'secret' });
  });

  it('serves cached settings until config.json changes on disk', () => {
    writeRuntimeSettings({ mindRoot: '/tmp/one' }, { homeDir: home });
    const first = readRuntimeSettings({ homeDir: home });
    const again = readRuntimeSettings({ homeDir: home });
    expect(again).toEqual(first);
    // Mutating a returned object must not leak into later reads.
    (again as { mindRoot?: string }).mindRoot = '/mutated';
    expect(readRuntimeSettings({ homeDir: home })).toMatchObject({ mindRoot: '/tmp/one' });

    // External edit (another process / the user) must be observed.
    const configPath = join(home, '.mindos', 'config.json');
    writeFileSync(configPath, JSON.stringify({ mindRoot: '/tmp/two-longer-path' }), 'utf-8');
    expect(readRuntimeSettings({ homeDir: home })).toMatchObject({ mindRoot: '/tmp/two-longer-path' });

    // Our own writes invalidate immediately.
    writeRuntimeSettings({ mindRoot: '/tmp/three' }, { homeDir: home });
    expect(readRuntimeSettings({ homeDir: home })).toMatchObject({ mindRoot: '/tmp/three' });
  });

  it('returns an empty object for missing or corrupt config without caching the failure', () => {
    expect(readRuntimeSettings({ homeDir: home })).toEqual({});
    mkdirSync(join(home, '.mindos'), { recursive: true });
    writeFileSync(join(home, '.mindos', 'config.json'), '{ not json', 'utf-8');
    expect(readRuntimeSettings({ homeDir: home })).toEqual({});
    writeRuntimeSettings({ mindRoot: '/tmp/recovered' }, { homeDir: home });
    expect(readRuntimeSettings({ homeDir: home })).toMatchObject({ mindRoot: '/tmp/recovered' });
    expect(existsSync(join(home, '.mindos', 'config.json'))).toBe(true);
  });
});
