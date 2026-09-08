import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createObsidianEditorWindow } from './obsidian-editor-window';

const wire = vi.hoisted(() => ({
  close: vi.fn(), setProxy: vi.fn(), construct: vi.fn(), listenError: false,
  setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), on: vi.fn(),
  onBeforeRequest: vi.fn(),
  handle: vi.fn(), clearStorageData: vi.fn().mockResolvedValue(undefined),
  removeAllListeners: vi.fn(),
}));
vi.mock('electron', () => ({
  session: { fromPartition: () => ({ ...wire, protocol: { handle: wire.handle }, webRequest: { onBeforeRequest: wire.onBeforeRequest } }) },
  BrowserWindow: function () { wire.construct(); throw new Error('Native window unavailable'); },
}));
vi.mock('node:net', () => ({ createServer: () => ({
  maxConnections: 0,
  once(_name: string, callback: (error: Error) => void) { if (wire.listenError) queueMicrotask(() => callback(new Error('No socket available'))); },
  listen(_port: number, _host: string, callback: () => void) { if (!wire.listenError) queueMicrotask(callback); },
  address: () => ({ port: 12345 }), close: wire.close,
}) }));
beforeEach(() => { vi.clearAllMocks(); wire.listenError = false; wire.setProxy.mockResolvedValue(undefined); });
function options() {
  const close = vi.fn();
  return { close, input: { runtimeSource: 'fixture', preloadPath: '/fixture/preload.cjs',
    session: { snapshot: { status: 'ready' }, close } as unknown as Parameters<typeof createObsidianEditorWindow>[0]['session'],
  } };
}
describe('editor window setup failure cleanup', () => {
  it('releases the approved session and proxy socket if native window creation fails', async () => {
    const fixture = options();
    await expect(createObsidianEditorWindow(fixture.input)).rejects.toThrow('Native window unavailable');
    expect(fixture.close).toHaveBeenCalled(); expect(wire.close).toHaveBeenCalled();
  });
  it('releases the approved session if the proxy socket cannot bind', async () => {
    const fixture = options(); wire.listenError = true;
    await expect(createObsidianEditorWindow(fixture.input)).rejects.toThrow('No socket available');
    expect(fixture.close).toHaveBeenCalled(); expect(wire.construct).not.toHaveBeenCalled();
  });
  it('releases resources if Electron cannot configure the dedicated proxy', async () => {
    const fixture = options(); wire.setProxy.mockRejectedValueOnce(new Error('Proxy configuration failed'));
    await expect(createObsidianEditorWindow(fixture.input)).rejects.toThrow('Proxy configuration failed');
    expect(fixture.close).toHaveBeenCalled(); expect(wire.close).toHaveBeenCalled();
  });
  it('times out a stalled proxy setup and releases resources before creating any window', async () => {
    vi.useFakeTimers();
    try {
      const fixture = options(); wire.setProxy.mockImplementationOnce(() => new Promise(() => {}));
      const pending = createObsidianEditorWindow({ ...fixture.input, timeoutMs: 500 });
      const assertion = expect(pending).rejects.toThrow('setup timed out');
      await vi.advanceTimersByTimeAsync(501);
      await assertion;
      expect(fixture.close).toHaveBeenCalled(); expect(wire.close).toHaveBeenCalled();
      expect(wire.construct).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
