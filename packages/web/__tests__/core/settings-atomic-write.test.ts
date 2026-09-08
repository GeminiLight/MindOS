import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/settings');

function listTempFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

describe('writeSettings atomic persistence', () => {
  let tempHome: string;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-settings-atomic-'));
    configDir = path.join(tempHome, '.mindos');
    fs.mkdirSync(configDir, { recursive: true });
    configPath = path.join(configDir, 'config.json');
    vi.resetModules();
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('round-trips settings through config.json and leaves no temp file behind', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ port: 4567, authToken: 'keep-me' }), 'utf-8');
    const { readSettings, writeSettings } = await import('@/lib/settings');

    writeSettings({
      ...readSettings(),
      mindRoot: '/tmp/atomic-mind',
      ai: {
        activeProvider: 'p_openai01',
        providers: [
          { id: 'p_openai01', name: 'OpenAI', protocol: 'openai', apiKey: 'sk-test', model: 'gpt-5.4', baseUrl: '' },
        ],
      },
    });

    expect(listTempFiles(configDir)).toEqual([]);
    const persisted = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    expect(persisted.mindRoot).toBe('/tmp/atomic-mind');
    expect(persisted.port).toBe(4567);
    expect(persisted.authToken).toBe('keep-me');
    expect(readSettings().mindRoot).toBe('/tmp/atomic-mind');
    expect(readSettings().ai.activeProvider).toBe('p_openai01');
  });

  it('keeps the previous config intact and cleans up when the temp write fails', async () => {
    const original = JSON.stringify({ mindRoot: '/tmp/original', ai: { activeProvider: 'p_x', providers: [] } });
    fs.writeFileSync(configPath, original, 'utf-8');
    const { readSettings, writeSettings } = await import('@/lib/settings');
    const settings = readSettings();

    const realWrite = fs.writeFileSync;
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof target === 'string' && target.endsWith('.tmp')) {
        realWrite(target, 'partial', 'utf-8');
        throw new Error('ENOSPC: disk full');
      }
      return (realWrite as (...args: unknown[]) => void)(target, ...rest);
    }) as typeof fs.writeFileSync);

    expect(() => writeSettings({ ...settings, mindRoot: '/tmp/never-written' })).toThrow(/ENOSPC/);
    writeSpy.mockRestore();

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(original);
    expect(listTempFiles(configDir)).toEqual([]);
  });

  it('never writes config.json in place (temp file + rename)', async () => {
    const { readSettings, writeSettings } = await import('@/lib/settings');
    const writtenPaths: string[] = [];
    const realWrite = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      writtenPaths.push(String(target));
      return (realWrite as (...args: unknown[]) => void)(target, ...rest);
    }) as typeof fs.writeFileSync);

    writeSettings({ ...readSettings(), mindRoot: '/tmp/renamed-in' });

    expect(writtenPaths).not.toContain(configPath);
    expect(writtenPaths.some((p) => p.startsWith(configPath) && p.endsWith('.tmp'))).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(listTempFiles(configDir)).toEqual([]);
  });
});
