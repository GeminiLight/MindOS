import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAutomationLaunchdPlist,
  buildAutomationSystemdUnit,
} from '../bin/lib/automation-service.js';

const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

describe('independent automation service CLI', () => {
  it('builds OS units that start only the automation worker', () => {
    const systemd = buildAutomationSystemdUnit({
      nodeBin: '/opt/node',
      cliPath: '/opt/mindos/bin/cli.js',
      home: '/home/tester',
      path: '/opt/bin:/usr/bin',
      logPath: '/home/tester/.mindos/automation.log',
    });
    expect(systemd).toContain('ExecStart="/opt/node" "/opt/mindos/bin/cli.js" "automation" "worker"');
    expect(systemd).toContain('StandardOutput="append:/home/tester/.mindos/automation.log"');
    expect(systemd).toContain('StandardError="append:/home/tester/.mindos/automation.log"');
    expect(systemd).not.toContain(' start');
    expect(systemd).not.toContain('mcp');

    const launchd = buildAutomationLaunchdPlist({
      nodeBin: '/opt/node',
      cliPath: '/opt/mindos/bin/cli.js',
      home: '/Users/tester',
      path: '/opt/bin:/usr/bin',
      logPath: '/Users/tester/.mindos/automation.log',
    });
    expect(launchd).toContain('<string>automation</string>');
    expect(launchd).toContain('<string>worker</string>');
    expect(launchd).not.toContain('<string>start</string>');
  });

  it('re-invokes a compiled MindOS binary without treating cli.js as an argument', () => {
    const systemd = buildAutomationSystemdUnit({
      binaryExecutor: '/opt/mindos/bin/mindos',
      nodeBin: '/opt/node',
      cliPath: '/opt/mindos/bin/cli.js',
    });
    expect(systemd).toContain('ExecStart="/opt/mindos/bin/mindos" "automation" "worker"');
    expect(systemd).not.toContain('/opt/node');
    expect(systemd).not.toContain('cli.js');

    const launchd = buildAutomationLaunchdPlist({
      binaryExecutor: '/Applications/MindOS/bin/mindos',
      nodeBin: '/opt/node',
      cliPath: '/opt/mindos/bin/cli.js',
    });
    expect(launchd).toContain('<string>/Applications/MindOS/bin/mindos</string>');
    expect(launchd).not.toContain('<string>/opt/node</string>');
    expect(launchd).not.toContain('cli.js');
  });

  it('registers automation as a lazy CLI command with worker and service help', async () => {
    const source = readFileSync(path.resolve(__dirname, 'cli-runtime.js'), 'utf-8');
    expect(source).toContain("import('../bin/commands/automation.js')");
    const result = await runCli(['automation', '--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('mindos automation worker');
    expect(result.stdout).toContain('mindos automation service install');
  });
});

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { encoding: 'utf-8', env: process.env }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException).code === 'number'
        ? (error as NodeJS.ErrnoException).code as number
        : error ? 1 : 0;
      resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}
