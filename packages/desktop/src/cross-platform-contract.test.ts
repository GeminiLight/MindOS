import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Windows and Linux behaviour that cannot be executed on this machine.
 *
 * CI's three-platform "Test Desktop Installation" workflow is the only place
 * these paths actually run, and it has been unable to start (account billing).
 * These tests pin the platform branches of the code the shell-compat work
 * touched so a regression is caught here rather than on a user's machine.
 *
 * They verify wiring and branch selection, not real process behaviour — that
 * still needs CI or a real Windows/Linux box.
 */

const spawned = [];

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.unref = vi.fn();
  }
}

const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', () => childProcessMock);

function setPlatform(value) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return () => Object.defineProperty(process, 'platform', original);
}

beforeEach(() => {
  spawned.length = 0;
  childProcessMock.spawn.mockReset();
  childProcessMock.spawn.mockImplementation((command, args, options) => {
    const child = new FakeChild();
    spawned.push({ command, args, options, child });
    return child;
  });
});

afterEach(() => vi.resetModules());

describe('runCommand — Windows process handling', () => {
  it('routes the command through resolveExecTarget so npm.cmd is wrapped for cmd.exe', async () => {
    // spawn/execFile cannot run .cmd directly (Node >= 18.20 EINVAL), and
    // shell:true splits paths containing spaces. The wrapping lives in
    // exec-target; what matters here is that runCommand actually uses it.
    vi.doMock('./exec-target', () => ({
      resolveExecTarget: (command, args) => ({
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', [command, ...args].map((a) => `"${a}"`).join(' ')],
      }),
    }));
    const { runCommand } = await import('./run-command');

    const pending = runCommand('C:\\Program Files\\nodejs\\npm.cmd', ['install', '-g', 'pkg']);
    spawned[0].child.emit('close', 0);
    await pending;

    expect(spawned[0].command).toBe('cmd.exe');
    expect(spawned[0].args[0]).toBe('/d');
    expect(spawned[0].args[3]).toContain('"C:\\Program Files\\nodejs\\npm.cmd"');
    expect(spawned[0].args[3]).toContain('"install"');
  });

  it('does not put children in their own process group on Windows', async () => {
    const restore = setPlatform('win32');
    try {
      const { runCommand } = await import('./run-command');
      const pending = runCommand('node', ['-v']);
      spawned[0].child.emit('close', 0);
      await pending;
      // Windows has no process groups; `process.kill(-pid)` would throw.
      expect(spawned[0].options.detached).toBe(false);
      expect(spawned[0].options.windowsHide).toBe(true);
    } finally { restore(); }
  });

  it('puts children in their own process group on POSIX so the whole tree can be killed', async () => {
    const restore = setPlatform('linux');
    try {
      const { runCommand } = await import('./run-command');
      const pending = runCommand('node', ['-v']);
      spawned[0].child.emit('close', 0);
      await pending;
      expect(spawned[0].options.detached).toBe(true);
    } finally { restore(); }
  });

  it('kills a timed-out child with taskkill /T /F on Windows', async () => {
    const restore = setPlatform('win32');
    try {
      const { runCommand } = await import('./run-command');
      const result = await runCommand('node', ['-e', 'loop'], { timeoutMs: 20 });
      expect(result.timedOut).toBe(true);
      const kill = spawned.find((s) => s.command === 'taskkill.exe');
      expect(kill, 'taskkill was not invoked').toBeTruthy();
      expect(kill.args).toEqual(['/PID', '4242', '/T', '/F']);
    } finally { restore(); }
  });

  it('kills a timed-out child by process group on POSIX', async () => {
    const restore = setPlatform('linux');
    const killed = [];
    const realKill = process.kill;
    process.kill = vi.fn((pid, signal) => { killed.push({ pid, signal }); });
    try {
      const { runCommand } = await import('./run-command');
      const result = await runCommand('node', ['-e', 'loop'], { timeoutMs: 20 });
      expect(result.timedOut).toBe(true);
      // Negative pid = the whole group.
      expect(killed.some((k) => k.pid === -4242 && k.signal === 'SIGKILL')).toBe(true);
      expect(spawned.some((s) => s.command === 'taskkill.exe')).toBe(false);
    } finally { process.kill = realKill; restore(); }
  });
});

describe('platform branches in the shell sources', () => {
  const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf-8');

  it('skips the POSIX cleanup script on Windows, where NSIS runs uninstall.bat', () => {
    // The uninstall IPC moved to ipc-handlers.ts.
    const main = read('ipc-handlers.ts');
    const fn = main.slice(main.indexOf('async function runDesktopCleanupScript()'));
    expect(fn).toContain("if (process.platform === 'win32') return;");
    expect(fn).toContain("spawnChild('/bin/sh', [script]");
    // The NSIS uninstaller owns the Windows path.
    expect(main).toContain("plan.kind === 'run-uninstaller'");
  });

  it('looks for node.exe when validating the private runtime on Windows', () => {
    const heal = read('boot-heal.ts');
    expect(heal).toContain("process.platform === 'win32' ? 'node.exe' : 'bin/node'");
  });

  it('keeps launchd cleanup on darwin and systemd cleanup on linux only', () => {
    const heal = read('boot-heal.ts');
    const launchd = heal.slice(heal.indexOf('export async function cleanupConflictingLaunchdService'));
    expect(launchd.slice(0, 200)).toContain("if (process.platform !== 'darwin') return;");
    const systemd = heal.slice(heal.indexOf('export async function cleanupLinuxSystemdService'));
    expect(systemd.slice(0, 200)).toContain("if (process.platform !== 'linux') return;");
  });

  it('gives the boot shell its own drag region, since the main window hides its titlebar on macOS', () => {
    // The splash was frameless and always-on-top, so it never needed one.
    // Hosted in the main window, a boot shell with no drag region would leave
    // the window immovable for the 1-3 minutes a first-run build takes.
    const html = read('connect.html');
    expect(html).toContain('html.shell-boot body::before');
    expect(html).toContain('-webkit-app-region: drag');
    expect(html).toContain('html.shell-boot .connect-toolbar');
    expect(html).toContain('-webkit-app-region: no-drag');
    // Applied before first paint, not after the renderer bundle loads.
    expect(html).toContain("document.documentElement.classList.add('shell-boot')");
  });

  it('never lets the boot shell resize the window it is hosted in', () => {
    // Dialogs fit themselves to their content; the main window's geometry is
    // the user's, restored from window-state, and must survive startup.
    expect(read('connect-dom.ts')).toContain("if (ipc.shell === 'boot') return;");
    const bootShell = read('boot-shell.ts');
    expect(bootShell).toContain('allowFit: false');
    // No handler registered either, so a stale renderer cannot resize it.
    const attach = read('connect-window.ts');
    expect(attach).toContain('if (options.allowFit) registerFitWindowHandler(options.window);');
  });
});

describe('renderer sandbox', () => {
  // Every shell window used to opt out except the main one, on a belief that
  // the sandbox broke mindos-connect:// on macOS. It does not (measured with
  // app.getAppMetrics() in dogfood-electron-local-mode). Keep it that way.
  it('never opts a shell window out of the renderer sandbox', () => {
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const offenders = readdirSync(__dirname)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /sandbox:\s*false/.test(stripComments(readFileSync(path.join(__dirname, f), 'utf-8'))));
    expect(offenders).toEqual([]);
  });
});
