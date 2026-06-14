// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  useCoreUpdateStore,
  __resetCoreUpdateStoreForTests,
} from '@/lib/stores/core-update-store';

type ProgressCb = (p: { percent: number; transferred: number; total: number }) => void;
type AvailableCb = (info: { current: string; latest: string; ready?: boolean }) => void;

function makeBridge(overrides: Record<string, unknown> = {}) {
  const progressCbs: ProgressCb[] = [];
  const availableCbs: AvailableCb[] = [];
  const bridge = {
    checkUpdate: vi.fn().mockResolvedValue({ available: false }),
    installUpdate: vi.fn(),
    checkCoreUpdate: vi.fn().mockResolvedValue({
      available: false, currentVersion: '1.1.10', latestVersion: '1.1.10',
      urls: [], size: 0, sha256: '', minDesktopVersion: '0.1.0', desktopTooOld: false,
    }),
    downloadCoreUpdate: vi.fn().mockResolvedValue(undefined),
    applyCoreUpdate: vi.fn().mockResolvedValue({ ok: true, version: '1.1.11' }),
    getCoreUpdatePending: vi.fn().mockResolvedValue({ version: null }),
    cancelCoreDownload: vi.fn(),
    onCoreUpdateProgress: vi.fn((cb: ProgressCb) => { progressCbs.push(cb); return () => {}; }),
    onCoreUpdateAvailable: vi.fn((cb: AvailableCb) => { availableCbs.push(cb); return () => {}; }),
    ...overrides,
  };
  return {
    bridge,
    emitProgress: (p: { percent: number; transferred: number; total: number }) => progressCbs.forEach((cb) => cb(p)),
    emitAvailable: (info: { current: string; latest: string; ready?: boolean }) => availableCbs.forEach((cb) => cb(info)),
  };
}

/** Let the store's async init()/checkAndDownload() chain settle. */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe('core-update-store', () => {
  beforeEach(() => {
    __resetCoreUpdateStoreForTests();
  });
  afterEach(() => {
    delete (window as any).mindos;
    __resetCoreUpdateStoreForTests();
  });

  it('stays idle when no desktop bridge is present', async () => {
    useCoreUpdateStore.getState().init();
    await flush();
    expect(useCoreUpdateStore.getState().phase).toBe('idle');
  });

  it('silently downloads an available, compatible update and ends ready', async () => {
    const { bridge } = makeBridge({
      checkCoreUpdate: vi.fn().mockResolvedValue({
        available: true, currentVersion: '1.1.10', latestVersion: '1.1.11',
        urls: ['https://cdn/x.tgz'], size: 3_400_000, sha256: 'abc', minDesktopVersion: '0.1.0', desktopTooOld: false,
      }),
    });
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();

    expect(bridge.downloadCoreUpdate).toHaveBeenCalledWith(['https://cdn/x.tgz'], '1.1.11', 3_400_000, 'abc');
    const s = useCoreUpdateStore.getState();
    expect(s.phase).toBe('ready');
    expect(s.latest).toBe('1.1.11');
    expect(s.current).toBe('1.1.10');
    expect(s.size).toBe(3_400_000);
  });

  it('does NOT download when the desktop shell is too old (compat gate)', async () => {
    const { bridge } = makeBridge({
      checkCoreUpdate: vi.fn().mockResolvedValue({
        available: true, currentVersion: '1.1.10', latestVersion: '1.1.11',
        urls: ['https://cdn/x.tgz'], size: 10, sha256: 'abc', minDesktopVersion: '0.5.0', desktopTooOld: true,
      }),
    });
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();

    expect(bridge.downloadCoreUpdate).not.toHaveBeenCalled();
    const s = useCoreUpdateStore.getState();
    expect(s.phase).toBe('desktopTooOld');
    expect(s.minDesktopVersion).toBe('0.5.0');
    expect(s.latest).toBe('1.1.11');
  });

  it('surfaces a pending (previously downloaded) update as ready without re-downloading', async () => {
    const { bridge } = makeBridge({
      getCoreUpdatePending: vi.fn().mockResolvedValue({ version: '1.1.11' }),
    });
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();

    expect(bridge.downloadCoreUpdate).not.toHaveBeenCalled();
    expect(bridge.checkCoreUpdate).not.toHaveBeenCalled();
    const s = useCoreUpdateStore.getState();
    expect(s.phase).toBe('ready');
    expect(s.latest).toBe('1.1.11');
  });

  it('updates progress from onCoreUpdateProgress events', async () => {
    let resolveDownload: () => void = () => {};
    const { bridge, emitProgress } = makeBridge({
      checkCoreUpdate: vi.fn().mockResolvedValue({
        available: true, currentVersion: '1.1.10', latestVersion: '1.1.11',
        urls: ['u'], size: 100, sha256: 's', minDesktopVersion: '0.1.0', desktopTooOld: false,
      }),
      downloadCoreUpdate: vi.fn(() => new Promise<void>((r) => { resolveDownload = r; })),
    });
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();

    expect(useCoreUpdateStore.getState().phase).toBe('downloading');
    emitProgress({ percent: 42, transferred: 42, total: 100 });
    expect(useCoreUpdateStore.getState().progress).toBe(42);

    resolveDownload();
    await flush();
    expect(useCoreUpdateStore.getState().phase).toBe('ready');
  });

  it('enters error phase when the silent download fails', async () => {
    const { bridge } = makeBridge({
      checkCoreUpdate: vi.fn().mockResolvedValue({
        available: true, currentVersion: '1.1.10', latestVersion: '1.1.11',
        urls: ['u'], size: 1, sha256: 's', minDesktopVersion: '0.1.0', desktopTooOld: false,
      }),
      downloadCoreUpdate: vi.fn().mockRejectedValue(new Error('network down')),
    });
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();

    expect(useCoreUpdateStore.getState().phase).toBe('error');
  });

  it('is idempotent: a second init() does not re-check', async () => {
    const { bridge } = makeBridge();
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();
    useCoreUpdateStore.getState().init();
    await flush();

    expect(bridge.checkCoreUpdate).toHaveBeenCalledTimes(1);
  });

  it('applyNow() invokes the bridge and marks applying', async () => {
    const { bridge } = makeBridge({
      getCoreUpdatePending: vi.fn().mockResolvedValue({ version: '1.1.11' }),
    });
    (window as any).mindos = bridge;

    useCoreUpdateStore.getState().init();
    await flush();
    void useCoreUpdateStore.getState().applyNow();
    await flush();

    expect(bridge.applyCoreUpdate).toHaveBeenCalledTimes(1);
    expect(useCoreUpdateStore.getState().phase).toBe('applying');
  });
});
