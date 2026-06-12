/**
 * P1 regression tests: `effectiveMindRoot` must not re-read + JSON.parse
 * ~/.mindos/config.json on every call (index-build loops amplify this ~500x).
 *
 * Design under test: the parsed config value is cached and keyed on the
 * config file's mtime + size (one statSync per call instead of read+parse);
 * `resetMindRootCacheForTests()` clears the cache explicitly.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.unmock('@/lib/mind-root');

type MindRootModule = typeof import('@/lib/mind-root');

describe('effectiveMindRoot caching', () => {
  let tmpHome: string;
  let configPath: string;
  let mod: MindRootModule;
  let savedEnv: string | undefined;

  function writeConfig(json: string): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, json, 'utf-8');
  }

  /** Force a future mtime so consecutive same-millisecond writes are detected. */
  function bumpMtime(offsetMs: number): void {
    const t = new Date(Date.now() + offsetMs);
    fs.utimesSync(configPath, t, t);
  }

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-home-'));
    configPath = path.join(tmpHome, '.mindos', 'config.json');
    vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    savedEnv = process.env.MIND_ROOT;
    delete process.env.MIND_ROOT;
    mod = await import('@/lib/mind-root');
    mod.resetMindRootCacheForTests();
  });

  afterEach(() => {
    mod.resetMindRootCacheForTests();
    if (savedEnv === undefined) delete process.env.MIND_ROOT;
    else process.env.MIND_ROOT = savedEnv;
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('returns the configured mindRoot from config.json', () => {
    writeConfig(JSON.stringify({ mindRoot: '/data/vault' }));
    expect(mod.effectiveMindRoot()).toBe('/data/vault');
  });

  it('reads and parses config.json only once across repeated calls', () => {
    writeConfig(JSON.stringify({ mindRoot: '/data/vault' }));
    mod.effectiveMindRoot();
    const readSpy = vi.spyOn(fs, 'readFileSync');
    for (let i = 0; i < 100; i++) {
      expect(mod.effectiveMindRoot()).toBe('/data/vault');
    }
    const configReads = readSpy.mock.calls.filter((c) => String(c[0]) === configPath);
    expect(configReads).toHaveLength(0);
  });

  it('picks up a changed config.json without a reset', () => {
    writeConfig(JSON.stringify({ mindRoot: '/data/vault' }));
    expect(mod.effectiveMindRoot()).toBe('/data/vault');
    writeConfig(JSON.stringify({ mindRoot: '/data/other-vault' }));
    bumpMtime(1000);
    expect(mod.effectiveMindRoot()).toBe('/data/other-vault');
  });

  it('falls back to MIND_ROOT env when config.json is missing', () => {
    process.env.MIND_ROOT = '/env/root';
    expect(mod.effectiveMindRoot()).toBe('/env/root');
  });

  it('reflects env var changes live (env is not cached)', () => {
    process.env.MIND_ROOT = '/env/one';
    expect(mod.effectiveMindRoot()).toBe('/env/one');
    process.env.MIND_ROOT = '/env/two';
    expect(mod.effectiveMindRoot()).toBe('/env/two');
  });

  it('falls back to the default path without config or env', () => {
    expect(mod.effectiveMindRoot()).toBe(path.join(tmpHome, 'MindOS', 'mind'));
  });

  it('falls back when config.json contains invalid JSON, then recovers', () => {
    writeConfig('{ not json');
    process.env.MIND_ROOT = '/env/root';
    expect(mod.effectiveMindRoot()).toBe('/env/root');
    writeConfig(JSON.stringify({ mindRoot: '/data/fixed' }));
    bumpMtime(1000);
    expect(mod.effectiveMindRoot()).toBe('/data/fixed');
  });

  it('ignores an empty or whitespace-only mindRoot value', () => {
    writeConfig(JSON.stringify({ mindRoot: '   ' }));
    process.env.MIND_ROOT = '/env/root';
    expect(mod.effectiveMindRoot()).toBe('/env/root');
  });

  it('detects config.json deletion after a cached read', () => {
    writeConfig(JSON.stringify({ mindRoot: '/data/vault' }));
    expect(mod.effectiveMindRoot()).toBe('/data/vault');
    fs.rmSync(configPath);
    process.env.MIND_ROOT = '/env/root';
    expect(mod.effectiveMindRoot()).toBe('/env/root');
  });

  it('resetMindRootCacheForTests forces a fresh read', () => {
    writeConfig(JSON.stringify({ mindRoot: '/data/vault' }));
    expect(mod.effectiveMindRoot()).toBe('/data/vault');
    // Same-size, same-mtime rewrite is undetectable by stat — the reset hook
    // exists exactly for this case in tests.
    fs.writeFileSync(configPath, JSON.stringify({ mindRoot: '/data/vbult' }), 'utf-8');
    const stat = fs.statSync(configPath);
    fs.utimesSync(configPath, stat.atime, stat.mtime);
    mod.resetMindRootCacheForTests();
    expect(mod.effectiveMindRoot()).toBe('/data/vbult');
  });
});
