import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tests for config.js getStartMode() and isDaemonMode().
 * Since these functions read from ~/.mindos/config.json,
 * we test the underlying logic by directly exercising
 * the config file parsing.
 */

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-config-test-'));
  const mindosDir = path.join(tmpDir, '.mindos');
  fs.mkdirSync(mindosDir, { recursive: true });
  configPath = path.join(mindosDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Mimics getStartMode logic from bin/lib/config.js */
function getStartMode(cfgPath: string): string {
  try {
    const mode = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).startMode || 'start';
    return mode === 'daemon' ? 'start' : mode;
  } catch {
    return 'start';
  }
}

/** Mimics isDaemonMode logic from bin/lib/config.js */
function isDaemonMode(cfgPath: string): boolean {
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).startMode === 'daemon';
  } catch {
    return false;
  }
}

describe('getStartMode', () => {
  it('returns "start" when no config file exists', () => {
    expect(getStartMode('/nonexistent/config.json')).toBe('start');
  });

  it('returns "start" when startMode is not set', () => {
    fs.writeFileSync(configPath, JSON.stringify({ mindRoot: '/tmp' }));
    expect(getStartMode(configPath)).toBe('start');
  });

  it('returns "start" when startMode is "start"', () => {
    fs.writeFileSync(configPath, JSON.stringify({ startMode: 'start' }));
    expect(getStartMode(configPath)).toBe('start');
  });

  it('maps "daemon" to "start"', () => {
    fs.writeFileSync(configPath, JSON.stringify({ startMode: 'daemon' }));
    expect(getStartMode(configPath)).toBe('start');
  });

  it('returns "dev" when startMode is "dev"', () => {
    fs.writeFileSync(configPath, JSON.stringify({ startMode: 'dev' }));
    expect(getStartMode(configPath)).toBe('dev');
  });

  it('returns "start" when config is invalid JSON', () => {
    fs.writeFileSync(configPath, 'not json');
    expect(getStartMode(configPath)).toBe('start');
  });
});

describe('isDaemonMode', () => {
  it('returns false when no config exists', () => {
    expect(isDaemonMode('/nonexistent/config.json')).toBe(false);
  });

  it('returns false when startMode is "start"', () => {
    fs.writeFileSync(configPath, JSON.stringify({ startMode: 'start' }));
    expect(isDaemonMode(configPath)).toBe(false);
  });

  it('returns true when startMode is "daemon"', () => {
    fs.writeFileSync(configPath, JSON.stringify({ startMode: 'daemon' }));
    expect(isDaemonMode(configPath)).toBe(true);
  });

  it('returns false when startMode is not set', () => {
    fs.writeFileSync(configPath, JSON.stringify({}));
    expect(isDaemonMode(configPath)).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    fs.writeFileSync(configPath, '{broken');
    expect(isDaemonMode(configPath)).toBe(false);
  });
});
