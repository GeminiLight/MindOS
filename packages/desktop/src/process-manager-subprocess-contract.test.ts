import { readFileSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { _terminateChildProcess_forTest, isMindosOwnedCommandLine } from './process-manager';

describe('process-manager subprocess cleanup contract', () => {
  it('uses argv-safe subprocess calls for port and process probes', () => {
    const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

    expect(source).not.toContain("require('child_process')");
    expect(source).not.toContain('execAsync(');
    expect(source).not.toContain('lsof -ti:${port}');
    expect(source).not.toContain('ss -tlnp sport = :${port}');
    expect(source).not.toContain('fuser ${port}/tcp 2>&1');
    expect(source).not.toContain('wmic process where ProcessId=${pid}');
    expect(source).not.toContain('ps -p ${pid} -o comm=');
    expect(source).toContain("execFileAsync('lsof', [`-ti:${port}`]");
    expect(source).toContain("execFileAsync('ss', ['-tlnp', 'sport', '=', `:${port}`]");
    expect(source).toContain("execFileAsync('fuser', [`${port}/tcp`]");
    expect(source).toContain("execFileAsync('wmic', ['process', 'where', `ProcessId=${pid}`");
    expect(source).toContain("execFileAsync('ps', ['-p', String(pid), '-o', 'args=']");
  });

  it('uses a single Desktop-managed home for PID files and crash logs', () => {
    const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

    expect(source).toContain("import { getDesktopConfigDir } from './desktop-home'");
    expect(source).toContain("path.join(getDesktopConfigDir(), 'config.json')");
    expect(source).toContain("path.join(getDesktopConfigDir(), 'desktop-children.pid')");
    expect(source).toContain("path.join(getDesktopConfigDir(), 'mindos.pid')");
    expect(source).not.toContain("process.env.HOME || process.env.USERPROFILE || '/tmp'");
  });

  it('terminates managed subprocess trees across platforms', () => {
    const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

    expect(source).toContain("execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F']");
    expect(source).toContain("process.kill(-proc.pid, 'SIGTERM')");
    expect(source).toContain("process.kill(-proc.pid, 'SIGKILL')");
    expect(source).toContain('detached: !IS_WIN');
  });

  it('only treats MindOS-owned command lines as safe cleanup targets', () => {
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /Users/me/app/server.js')).toBe(false);
    expect(isMindosOwnedCommandLine('/usr/local/bin/next start -p 3000')).toBe(false);
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /Users/me/.mindos/runtime/packages/web/.next/standalone/server.js')).toBe(true);
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /Applications/MindOS.app/Contents/Resources/mindos-runtime/dist/protocols/mcp-server/index.cjs')).toBe(true);
    expect(isMindosOwnedCommandLine('/usr/local/bin/node /usr/local/lib/node_modules/@geminilight/mindos/bin/cli.js start')).toBe(true);
  });

  it('validates MindOS health payloads before treating ports as ready', () => {
    const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

    expect(source).toContain("import { verifyMindOsWebHealth } from './mindos-web-health'");
    expect(source).toContain('if (await verifyMindOsWebHealth(port, 2000)) return true;');
    expect(source).toContain('return verifyMindOsWebHealth(port, 800);');
    expect(source).toContain('const res = await verifyMindOsWebHealth(port, 3000);');
    expect(source).not.toContain('res.statusCode === 200');
  });

  it('does not depend on raw HTTP health checks for process readiness', () => {
    const source = readFileSync(path.join(__dirname, 'process-manager.ts'), 'utf-8');

    expect(source).not.toContain("import http from 'http'");
    expect(source).not.toContain("path: '/api/health'");
  });

  it('escalates child process shutdown when SIGTERM does not exit', async () => {
    const signals: Array<NodeJS.Signals | undefined> = [];
    const proc = new EventEmitter() as EventEmitter & {
      killed: boolean;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    proc.killed = false;
    proc.kill = (signal?: NodeJS.Signals) => {
      signals.push(signal);
      proc.killed = true;
      return true;
    };

    await _terminateChildProcess_forTest(proc as never, 1, 10);

    expect(signals[0]).toBe('SIGTERM');
    expect(signals.length).toBe(2);
    if (process.platform === 'win32') {
      expect(signals[1]).toBeUndefined();
    } else {
      expect(signals[1]).toBe('SIGKILL');
    }
  });
});

describe('terminateChildProcess force-kill confirmation', () => {
  function fakeProc(exitOnKill: boolean) {
    const proc = new EventEmitter() as EventEmitter & {
      killed: boolean;
      kill: (signal?: NodeJS.Signals) => boolean;
    };
    proc.killed = false;
    proc.kill = (signal?: NodeJS.Signals) => {
      proc.killed = true;
      const forced = process.platform === 'win32' ? signal === undefined : signal === 'SIGKILL';
      if (exitOnKill && forced) setTimeout(() => proc.emit('exit', null, 'SIGKILL'), 0);
      return true;
    };
    return proc;
  }

  it('resolves true once the child confirms exit after force-kill', async () => {
    const proc = fakeProc(true);
    await expect(_terminateChildProcess_forTest(proc as never, 1, 500)).resolves.toBe(true);
  });

  it('resolves false when the child never emits exit after force-kill (bounded wait)', async () => {
    const proc = fakeProc(false);
    const t0 = Date.now();
    await expect(_terminateChildProcess_forTest(proc as never, 1, 30)).resolves.toBe(false);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });

  it('resolves true immediately for a child that already exited before stop()', async () => {
    const proc = new EventEmitter() as EventEmitter & { killed: boolean; exitCode: number | null; signalCode: string | null; kill: () => boolean };
    proc.killed = false;
    proc.exitCode = 1;
    proc.signalCode = null;
    let killCalls = 0;
    proc.kill = () => { killCalls++; return false; };
    const t0 = Date.now();
    await expect(_terminateChildProcess_forTest(proc as never, 1000, 1000)).resolves.toBe(true);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(killCalls).toBe(0);
  });

  it('resolves true immediately when the child exits on SIGTERM', async () => {
    const proc = new EventEmitter() as EventEmitter & { killed: boolean; kill: () => boolean };
    proc.killed = false;
    proc.kill = () => { proc.killed = true; setTimeout(() => proc.emit('exit', 0, null), 0); return true; };
    await expect(_terminateChildProcess_forTest(proc as never, 1000, 1000)).resolves.toBe(true);
  });
});
