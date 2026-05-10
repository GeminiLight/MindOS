import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'mindos-cli-config-command-'));
  tempRoots.push(home);
  mkdirSync(path.join(home, '.mindos'), { recursive: true });
  writeFileSync(path.join(home, '.mindos', 'config.json'), JSON.stringify({ mindRoot: path.join(home, 'mind') }), 'utf-8');
  return home;
}

function runConfig(home: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'config', ...args], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: home, NODE_ENV: 'test' },
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('mindos config command key validation', () => {
  it('rejects prototype-polluting keys for set and keeps config unchanged', () => {
    const home = makeHome();
    const configPath = path.join(home, '.mindos', 'config.json');

    const result = runConfig(home, ['set', '__proto__.polluted', 'yes']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Invalid config key');
    expect(JSON.parse(readFileSync(configPath, 'utf-8'))).toEqual({ mindRoot: path.join(home, 'mind') });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects empty key segments for unset', () => {
    const home = makeHome();
    const configPath = path.join(home, '.mindos', 'config.json');

    const result = runConfig(home, ['unset', 'ai..provider']);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Invalid config key');
    expect(existsSync(configPath)).toBe(true);
  });

  it('does not coerce non-finite numeric strings into JSON null', () => {
    const home = makeHome();
    const configPath = path.join(home, '.mindos', 'config.json');

    const result = runConfig(home, ['set', 'custom.value', 'Infinity']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).custom.value).toBe('Infinity');
  });
});
