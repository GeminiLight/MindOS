import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const updaterMock = vi.hoisted(() => {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  return {
    autoUpdater: Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      autoRunAppAfterInstall: false,
      channel: '',
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
    }),
  };
});

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const win = {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };
  return {
    handlers,
    win,
    app: {
      getVersion: vi.fn(() => '1.2.3'),
      once: vi.fn(),
      removeListener: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
    },
  };
});

vi.mock('electron-updater', () => ({
  autoUpdater: updaterMock.autoUpdater,
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: { getAllWindows: () => [electronMock.win] },
  ipcMain: electronMock.ipcMain,
}));

import {
  UPDATE_INSTALL_STALL_TIMEOUT_MS,
  getShellUpdateSupport,
  isUpdateAvailable,
  setupUpdater,
} from './updater';

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  electronMock.handlers.clear();
  updaterMock.autoUpdater.removeAllListeners();
  updaterMock.autoUpdater.checkForUpdates.mockReset();
  updaterMock.autoUpdater.downloadUpdate.mockReset();
  updaterMock.autoUpdater.quitAndInstall.mockReset();
  updaterMock.autoUpdater.checkForUpdates.mockResolvedValue(null);
  updaterMock.autoUpdater.autoDownload = true;
  updaterMock.autoUpdater.autoInstallOnAppQuit = true;
  updaterMock.autoUpdater.autoRunAppAfterInstall = false;
  updaterMock.autoUpdater.channel = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isUpdateAvailable', () => {
  it('reports an update when the feed version is newer', () => {
    expect(isUpdateAvailable('1.2.4', '1.2.3')).toBe(true);
  });

  it('reports no update when versions are equal', () => {
    expect(isUpdateAvailable('1.2.3', '1.2.3')).toBe(false);
  });

  it('reports no update when running version is newer than the feed (rollback)', () => {
    expect(isUpdateAvailable('1.2.2', '1.2.3')).toBe(false);
    expect(isUpdateAvailable('1.2.2', '1.2.3', true)).toBe(false);
  });

  it('reports no update when the feed version is missing', () => {
    expect(isUpdateAvailable(undefined, '1.2.3')).toBe(false);
    expect(isUpdateAvailable('', '1.2.3')).toBe(false);
  });

  it('trusts an explicit electron-updater "not available" flag over version strings', () => {
    expect(isUpdateAvailable('9.9.9', '1.2.3', false)).toBe(false);
  });

  it('falls back to the electron-updater flag when versions are not valid semver', () => {
    expect(isUpdateAvailable('nightly-2', 'nightly-1', true)).toBe(true);
    expect(isUpdateAvailable('nightly-2', 'nightly-1')).toBe(false);
    expect(isUpdateAvailable('nightly-2', 'nightly-1', false)).toBe(false);
  });
});

describe('setupUpdater', () => {
  it('returns an install error and resets update mode when quitAndInstall fails synchronously', async () => {
    const onBeforeQuitAndInstall = vi.fn();
    const onInstallFailed = vi.fn();
    updaterMock.autoUpdater.downloadUpdate.mockResolvedValue(['downloaded']);
    updaterMock.autoUpdater.quitAndInstall.mockImplementation(() => {
      updaterMock.autoUpdater.emit('error', new Error("No update filepath provided, can't quit and install"));
    });

    const cleanup = setupUpdater({ onBeforeQuitAndInstall, onInstallFailed, updateSupport: { canInstall: true } });
    const install = electronMock.handlers.get('install-update');
    expect(install).toBeTruthy();

    const result = await install?.({} as never);

    expect(result).toMatchObject({
      ok: false,
      error: "No update filepath provided, can't quit and install",
    });
    expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1);
    expect(onInstallFailed).toHaveBeenCalledTimes(1);
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-error', {
      message: "No update filepath provided, can't quit and install",
    });

    cleanup();
  });

  it('resets update mode when quitAndInstall throws before the app quits', async () => {
    const onBeforeQuitAndInstall = vi.fn();
    const onInstallFailed = vi.fn();
    updaterMock.autoUpdater.downloadUpdate.mockResolvedValue(['downloaded']);
    updaterMock.autoUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('installer launch failed');
    });

    const cleanup = setupUpdater({ onBeforeQuitAndInstall, onInstallFailed, updateSupport: { canInstall: true } });
    const install = electronMock.handlers.get('install-update');

    const result = await install?.({} as never);

    expect(result).toEqual({ ok: false, error: 'installer launch failed' });
    expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1);
    expect(onInstallFailed).toHaveBeenCalledTimes(1);
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-installing');
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-error', {
      message: 'installer launch failed',
    });

    cleanup();
  });

  it('reports a stalled installer when the app does not quit after install starts', async () => {
    vi.useFakeTimers();
    const onInstallFailed = vi.fn();
    updaterMock.autoUpdater.downloadUpdate.mockResolvedValue(['downloaded']);
    updaterMock.autoUpdater.quitAndInstall.mockImplementation(() => undefined);

    const cleanup = setupUpdater({ onInstallFailed, updateSupport: { canInstall: true } });
    const install = electronMock.handlers.get('install-update');
    const result = await install?.({} as never);

    expect(result).toMatchObject({ ok: true, phase: 'installing' });
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-installing');

    vi.advanceTimersByTime(UPDATE_INSTALL_STALL_TIMEOUT_MS);

    expect(onInstallFailed).toHaveBeenCalledTimes(1);
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-error', {
      message: expect.stringContaining('did not restart'),
    });

    cleanup();
  });

  it('coalesces repeated install requests while an update download is already in flight', async () => {
    let resolveDownload: ((value: string[]) => void) | null = null;
    updaterMock.autoUpdater.downloadUpdate.mockImplementation(() => new Promise<string[]>((resolve) => {
      resolveDownload = resolve;
    }));
    updaterMock.autoUpdater.quitAndInstall.mockImplementation(() => undefined);

    const cleanup = setupUpdater({ updateSupport: { canInstall: true } });
    const install = electronMock.handlers.get('install-update');

    const first = install?.({} as never);
    const second = install?.({} as never);

    expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    resolveDownload?.(['downloaded']);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, phase: 'installing' },
      { ok: true, phase: 'installing' },
    ]);

    expect(updaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('returns structured check-update errors instead of hiding them as no update', async () => {
    updaterMock.autoUpdater.checkForUpdates.mockRejectedValue(new Error('release metadata unavailable'));

    const cleanup = setupUpdater({ updateSupport: { canInstall: true } });
    const check = electronMock.handlers.get('check-update');

    await expect(check?.({} as never)).resolves.toEqual({
      available: false,
      error: 'release metadata unavailable',
    });

    cleanup();
  });

  it('returns the same structured failure to repeated install requests when the shared download fails', async () => {
    let rejectDownload: ((error: Error) => void) | null = null;
    updaterMock.autoUpdater.downloadUpdate.mockImplementation(() => new Promise<string[]>((_resolve, reject) => {
      rejectDownload = reject;
    }));

    const cleanup = setupUpdater({ updateSupport: { canInstall: true } });
    const install = electronMock.handlers.get('install-update');

    const first = install?.({} as never);
    const second = install?.({} as never);

    rejectDownload?.(new Error('network unavailable'));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: false, error: 'network unavailable' },
      { ok: false, error: 'network unavailable' },
    ]);

    expect(updaterMock.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-error', {
      message: 'network unavailable',
    });

    cleanup();
  });

  it('rejects unsupported shell installs with a manual download URL', async () => {
    const cleanup = setupUpdater({
      updateSupport: {
        canInstall: false,
        reason: 'This Linux install must be updated manually.',
        manualUrl: 'https://example.com/mindos',
      },
    });
    const install = electronMock.handlers.get('install-update');

    await expect(install?.({} as never)).resolves.toEqual({
      ok: false,
      error: 'This Linux install must be updated manually.',
      manualUrl: 'https://example.com/mindos',
    });
    expect(updaterMock.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(updaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(electronMock.win.webContents.send).toHaveBeenCalledWith('update-error', {
      message: 'This Linux install must be updated manually.',
    });

    cleanup();
  });
});

describe('getShellUpdateSupport', () => {
  it('marks Linux deb installs as manual-update only', () => {
    const support = getShellUpdateSupport({
      platform: 'linux',
      env: {},
      resourcesPath: '/app/resources',
      existsSync: (file) => file.endsWith('package-type'),
      readFileSync: () => 'deb',
    });

    expect(support.canInstall).toBe(false);
    expect(support.reason).toContain('Debian');
    expect(support.manualUrl).toContain('/releases/latest');
  });
});
