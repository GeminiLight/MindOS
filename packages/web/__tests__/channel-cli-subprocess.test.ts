import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'packages', 'mindos', 'bin', 'cli.js');

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-channel-smoke-'));
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function run(args: string[], extraEnv: Record<string, string> = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
        NODE_ENV: 'test',
        ...extraEnv,
      },
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('channel CLI subprocess smoke', () => {
  it('lists platforms without crashing in empty home', () => {
    const result = run(['channel', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Configured IM Platforms');
  });

  it('supports env + skip-verify flow in subprocess', () => {
    const result = run(
      ['channel', 'add', 'telegram', '--env', '--skip-verify'],
      { TELEGRAM_BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ' },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('verification skipped');

    const configPath = path.join(tempHome, '.mindos', 'im.json');
    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(onDisk.providers.telegram).toBeDefined();
  });

  it('supports alternate env credential mode for wecom', () => {
    const result = run(
      ['channel', 'add', 'wecom', '--env', '--skip-verify'],
      { WECOM_WEBHOOK_KEY: 'robot-webhook-key' },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('verification skipped');
  });
});
