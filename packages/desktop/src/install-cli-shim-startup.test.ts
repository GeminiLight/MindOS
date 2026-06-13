/**
 * Startup-performance contract for the CLI shim installer:
 *  - stamp guard: steady-state launches skip every write and PATH step
 *  - async PATH update: the Windows PowerShell step never blocks the event loop
 *  - deferral: the install is scheduled after the splash window has painted
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({ execFile: execFileMock }));

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    getLocale: () => 'en-US',
    isPackaged: false,
  },
  BrowserWindow: class {},
  Notification: class {
    static isSupported() { return false; }
    show() { /* no-op */ }
  },
  dialog: {},
}));

let home: string;

function shimFile(): string {
  return path.join(home, '.mindos', 'bin', process.platform === 'win32' ? 'mindos.cmd' : 'mindos');
}

function stampFile(): string {
  return path.join(home, '.mindos', 'cli-shim-stamp.json');
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-shim-startup-'));
  process.env.MINDOS_DESKTOP_HOME_DIR = home;
  delete process.env.MINDOS_DEV_BUNDLED_ROOT;
  // Deterministic CLI target: a cached runtime under the fake desktop home
  const runtimeBin = path.join(home, '.mindos', 'runtime', 'bin');
  fs.mkdirSync(runtimeBin, { recursive: true });
  fs.writeFileSync(path.join(runtimeBin, 'cli.js'), '// cli\n', 'utf-8');
  fs.writeFileSync(
    path.join(home, '.mindos', 'runtime', 'package.json'),
    JSON.stringify({ version: '9.9.9' }),
    'utf-8',
  );
  execFileMock.mockReset();
});

afterEach(() => {
  delete process.env.MINDOS_DESKTOP_HOME_DIR;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('cli shim stamp guard', () => {
  it('writes the shim and a stamp on first run, then skips the whole install while the stamp matches', async () => {
    const { ensureMindosCliShim } = await import('./install-cli-shim');

    const first = await ensureMindosCliShim({ appendPath: false });
    expect(first.ok).toBe(true);
    expect(first.skipped).not.toBe(true);
    expect(fs.existsSync(shimFile())).toBe(true);
    expect(fs.existsSync(stampFile())).toBe(true);

    const second = await ensureMindosCliShim({ appendPath: false });
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
  });

  it('rewrites a tampered shim even when the stamp still matches', async () => {
    const { ensureMindosCliShim } = await import('./install-cli-shim');

    await ensureMindosCliShim({ appendPath: false });
    const original = fs.readFileSync(shimFile(), 'utf-8');
    fs.writeFileSync(shimFile(), '# tampered\n', 'utf-8');

    const result = await ensureMindosCliShim({ appendPath: false });
    expect(result.ok).toBe(true);
    expect(result.skipped).not.toBe(true);
    expect(fs.readFileSync(shimFile(), 'utf-8')).toBe(original);
  });

  it('reinstalls when the stamp is missing or stale', async () => {
    const { ensureMindosCliShim } = await import('./install-cli-shim');

    await ensureMindosCliShim({ appendPath: false });

    fs.rmSync(stampFile());
    const afterDelete = await ensureMindosCliShim({ appendPath: false });
    expect(afterDelete.skipped).not.toBe(true);

    fs.writeFileSync(stampFile(), '{"v":0,"stale":true}', 'utf-8');
    const afterStale = await ensureMindosCliShim({ appendPath: false });
    expect(afterStale.skipped).not.toBe(true);
  });

  it('reinstalls when the shim file was deleted even though the stamp matches', async () => {
    const { ensureMindosCliShim } = await import('./install-cli-shim');

    await ensureMindosCliShim({ appendPath: false });
    fs.rmSync(shimFile());

    const result = await ensureMindosCliShim({ appendPath: false });
    expect(result.ok).toBe(true);
    expect(result.skipped).not.toBe(true);
    expect(fs.existsSync(shimFile())).toBe(true);
  });

  it('bypasses the stamp guard when forced (tray refresh / core update)', async () => {
    const { ensureMindosCliShim } = await import('./install-cli-shim');

    await ensureMindosCliShim({ appendPath: false });
    const forced = await ensureMindosCliShim({ appendPath: false, force: true });
    expect(forced.ok).toBe(true);
    expect(forced.skipped).not.toBe(true);
  });

  it('re-runs the install when the PATH-append setting differs from the stamped one', async () => {
    const { ensureMindosCliShim } = await import('./install-cli-shim');

    await ensureMindosCliShim({ appendPath: false });
    const withAppend = await ensureMindosCliShim({ appendPath: true });
    expect(withAppend.skipped).not.toBe(true);

    const steadyState = await ensureMindosCliShim({ appendPath: true });
    expect(steadyState.skipped).toBe(true);
  });
});

describe('async Windows PATH registry update', () => {
  it('invokes PowerShell asynchronously via execFile with a timeout and resolves true on CHANGED', async () => {
    const { appendMindosBinToWindowsPath } = await import('./install-cli-shim');
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
        cb(null, 'CHANGED\n', '');
      },
    );

    await expect(appendMindosBinToWindowsPath()).resolves.toBe(true);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, opts] = execFileMock.mock.calls[0];
    expect(file).toBe('powershell.exe');
    expect(args).toContain('-EncodedCommand');
    expect(args).toContain('-NonInteractive');
    expect(opts).toMatchObject({ timeout: 10000, windowsHide: true });
  });

  it('resolves false when PATH already contains the shim directory', async () => {
    const { appendMindosBinToWindowsPath } = await import('./install-cli-shim');
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
        cb(null, 'PRESENT\n', '');
      },
    );

    await expect(appendMindosBinToWindowsPath()).resolves.toBe(false);
  });

  it('resolves false instead of throwing when PowerShell fails or times out', async () => {
    const { appendMindosBinToWindowsPath } = await import('./install-cli-shim');
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
        cb(new Error('powershell timed out'), '', '');
      },
    );

    await expect(appendMindosBinToWindowsPath()).resolves.toBe(false);
  });

  it('keeps no synchronous child_process call in the shim installer', () => {
    const source = fs.readFileSync(path.join(__dirname, 'install-cli-shim.ts'), 'utf-8');
    expect(source).not.toContain('execFileSync');
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('spawnSync');
  });

  it('removes the stamp file in both uninstall scripts', async () => {
    const { buildWindowsUninstallScript, buildUnixUninstallScript } = await import('./install-cli-shim');
    expect(buildWindowsUninstallScript()).toContain('cli-shim-stamp.json');
    expect(buildUnixUninstallScript()).toContain('cli-shim-stamp.json');
  });
});

describe('deferred shim install scheduling', () => {
  interface FakeWindow {
    isDestroyed(): boolean;
    isVisible(): boolean;
    once(event: 'show', listener: () => void): unknown;
  }

  function fakeWindow(overrides?: Partial<FakeWindow> & { listeners?: Array<() => void> }) {
    const listeners: Array<() => void> = overrides?.listeners ?? [];
    return {
      listeners,
      win: {
        isDestroyed: overrides?.isDestroyed ?? (() => false),
        isVisible: overrides?.isVisible ?? (() => false),
        once: (_event: 'show', listener: () => void) => listeners.push(listener),
      } satisfies FakeWindow,
    };
  }

  function fakeScheduler() {
    const queue: Array<{ fn: () => void; delayMs: number }> = [];
    const schedule = (fn: () => void, delayMs: number) => queue.push({ fn, delayMs });
    return { queue, schedule };
  }

  it('runs the install only after the splash window fires show', async () => {
    const { scheduleCliShimInstall } = await import('./install-cli-shim');
    const install = vi.fn();
    const { win, listeners } = fakeWindow();
    const { queue, schedule } = fakeScheduler();

    const mode = scheduleCliShimInstall(win, install, schedule);

    expect(mode).toBe('after-show');
    expect(install).not.toHaveBeenCalled();
    expect(listeners).toHaveLength(1);

    listeners[0]();
    expect(install).not.toHaveBeenCalled(); // still deferred to the next tick
    const tick = queue.find((q) => q.delayMs === 0);
    tick?.fn();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timer so the install still happens if the splash never shows', async () => {
    const { scheduleCliShimInstall } = await import('./install-cli-shim');
    const install = vi.fn();
    const { win } = fakeWindow();
    const { queue, schedule } = fakeScheduler();

    scheduleCliShimInstall(win, install, schedule);

    const fallback = queue.find((q) => q.delayMs > 0);
    expect(fallback).toBeDefined();
    fallback?.fn();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('runs the install at most once when both show and the fallback timer fire', async () => {
    const { scheduleCliShimInstall } = await import('./install-cli-shim');
    const install = vi.fn();
    const { win, listeners } = fakeWindow();
    const { queue, schedule } = fakeScheduler();

    scheduleCliShimInstall(win, install, schedule);
    listeners[0]();
    for (const { fn } of [...queue]) fn();

    expect(install).toHaveBeenCalledTimes(1);
  });

  it('defers to the next tick when the window is already visible or absent', async () => {
    const { scheduleCliShimInstall } = await import('./install-cli-shim');

    const visible = fakeWindow({ isVisible: () => true });
    const { queue: q1, schedule: s1 } = fakeScheduler();
    const install1 = vi.fn();
    expect(scheduleCliShimInstall(visible.win, install1, s1)).toBe('deferred');
    q1.forEach(({ fn }) => fn());
    expect(install1).toHaveBeenCalledTimes(1);

    const { queue: q2, schedule: s2 } = fakeScheduler();
    const install2 = vi.fn();
    expect(scheduleCliShimInstall(null, install2, s2)).toBe('deferred');
    q2.forEach(({ fn }) => fn());
    expect(install2).toHaveBeenCalledTimes(1);
  });
});
