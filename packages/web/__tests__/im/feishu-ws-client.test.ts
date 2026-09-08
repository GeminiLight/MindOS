import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeishuConfig } from '@/lib/im/types';
import type { LarkCliEventClientOptions } from '@/lib/im/lark-cli-event-client';

const { startMock, closeMock, wsClientCtor, registerMock, cliStartMock, cliStopMock, cliFactoryMock } = vi.hoisted(() => {
  const startMock = vi.fn().mockResolvedValue(undefined);
  const closeMock = vi.fn();
  const wsClientCtor = vi.fn();
  const registerMock = vi.fn(function () { return this; });
  const cliStartMock = vi.fn().mockResolvedValue(undefined);
  const cliStopMock = vi.fn();
  const cliFactoryMock = vi.fn((_options: LarkCliEventClientOptions) => ({
    start: cliStartMock,
    stop: cliStopMock,
    status: () => ({ running: true, startedAt: '2026-09-03T00:00:00.000Z' }),
  }));
  return { startMock, closeMock, wsClientCtor, registerMock, cliStartMock, cliStopMock, cliFactoryMock };
});

vi.mock('@/lib/im/lark-cli-event-client', () => ({
  createLarkCliEventClient: cliFactoryMock,
}));

vi.mock('@larksuiteoapi/node-sdk', () => ({
  LoggerLevel: { info: 'info' },
  EventDispatcher: class MockEventDispatcher {
    register(handles: unknown) {
      registerMock(handles);
      return this;
    }
  },
  WSClient: class MockWSClient {
    constructor(params: unknown) {
      wsClientCtor(params);
    }

    async start(params: unknown) {
      return await startMock(params);
    }

    close(params?: unknown) {
      closeMock(params);
    }
  },
}));

const larkCliConfig: FeishuConfig = {
  app_id: 'cli_existing',
  credential_source: 'lark_cli_profile',
  credential_ref: {
    kind: 'lark-cli-profile',
    executablePath: '/opt/lark-cli',
    profile: 'cli_existing',
  },
  conversation: { enabled: true, transport: 'long_connection' },
};

/** Returns the onExit callback the manager handed to the n-th lark-cli client it created. */
function capturedOnExit(call = 0): (error?: Error) => void {
  const onExit = cliFactoryMock.mock.calls[call]?.[0]?.onExit;
  if (!onExit) throw new Error(`lark-cli client #${call} was created without an onExit callback`);
  return onExit;
}

describe('Feishu WS client manager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/lib/im/feishu-ws-client');
    mod.__resetFeishuWSClientForTests();
  });

  it('starts a WS client once for long connection', async () => {
    const mod = await import('@/lib/im/feishu-ws-client');
    const config: FeishuConfig = {
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: { enabled: true, transport: 'long_connection' },
    };

    await mod.startFeishuWSClient(config);
    await mod.startFeishuWSClient(config);

    expect(wsClientCtor).toHaveBeenCalledTimes(1);
    expect(wsClientCtor).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'cli_xxx',
      appSecret: 'secret',
      autoReconnect: true,
    }));
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith(expect.objectContaining({
      'im.message.receive_v1': expect.any(Function),
    }));
    expect(mod.getFeishuWSClientStatus().running).toBe(true);
  });

  it('stops the running WS client', async () => {
    const mod = await import('@/lib/im/feishu-ws-client');
    await mod.startFeishuWSClient({
      app_id: 'cli_xxx',
      app_secret: 'secret',
      conversation: { enabled: true, transport: 'long_connection' },
    });

    mod.stopFeishuWSClient();

    expect(closeMock).toHaveBeenCalled();
    expect(mod.getFeishuWSClientStatus().running).toBe(false);
  });

  it('reports configuration errors before trying to connect', async () => {
    const mod = await import('@/lib/im/feishu-ws-client');

    await expect(mod.startFeishuWSClient({
      app_id: '',
      app_secret: 'secret',
      conversation: { enabled: true, transport: 'long_connection' },
    })).rejects.toThrow('Feishu App ID and App Secret are required');

    expect(wsClientCtor).not.toHaveBeenCalled();
  });

  it('uses the bound lark-cli bot for events without inline app secrets', async () => {
    const mod = await import('@/lib/im/feishu-ws-client');
    await mod.startFeishuWSClient({
      app_id: 'cli_existing',
      credential_source: 'lark_cli_profile',
      credential_ref: {
        kind: 'lark-cli-profile',
        executablePath: '/opt/lark-cli',
        profile: 'cli_existing',
      },
      conversation: { enabled: true, transport: 'long_connection' },
    });

    expect(wsClientCtor).not.toHaveBeenCalled();
    expect(cliFactoryMock).toHaveBeenCalledWith(expect.objectContaining({
      executablePath: '/opt/lark-cli',
      profile: 'cli_existing',
      onEvent: expect.any(Function),
    }));
    expect(cliStartMock).toHaveBeenCalledTimes(1);
    expect(mod.getFeishuWSClientStatus()).toMatchObject({
      running: true,
      startedAt: '2026-09-03T00:00:00.000Z',
    });

    mod.stopFeishuWSClient();
    expect(cliStopMock).toHaveBeenCalledTimes(1);
  });

  it('marks the lark-cli connection as down when the consumer exits unexpectedly', async () => {
    vi.useFakeTimers();
    try {
      const mod = await import('@/lib/im/feishu-ws-client');
      await mod.startFeishuWSClient(larkCliConfig);
      expect(mod.getFeishuWSClientStatus().running).toBe(true);

      capturedOnExit(0)(new Error('websocket disconnected'));

      expect(mod.getFeishuWSClientStatus()).toMatchObject({
        running: false,
        lastError: expect.stringContaining('disconnected'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects the lark-cli consumer with exponential backoff and resets it after success', async () => {
    vi.useFakeTimers();
    try {
      const mod = await import('@/lib/im/feishu-ws-client');
      await mod.startFeishuWSClient(larkCliConfig);
      expect(cliStartMock).toHaveBeenCalledTimes(1);

      // First reconnect attempt fails so the second one has to wait twice as long.
      cliStartMock.mockRejectedValueOnce(new Error('lark-cli not ready'));
      capturedOnExit(0)(new Error('websocket disconnected'));

      await vi.advanceTimersByTimeAsync(999);
      expect(cliStartMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(cliStartMock).toHaveBeenCalledTimes(2);
      expect(mod.getFeishuWSClientStatus()).toMatchObject({
        running: false,
        lastError: expect.stringContaining('not ready'),
      });

      await vi.advanceTimersByTimeAsync(1_999);
      expect(cliStartMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(cliStartMock).toHaveBeenCalledTimes(3);
      expect(mod.getFeishuWSClientStatus()).toMatchObject({
        running: true,
        startedAt: '2026-09-03T00:00:00.000Z',
      });

      // A later exit starts again from the base delay because the previous start succeeded.
      capturedOnExit(2)(undefined);
      expect(mod.getFeishuWSClientStatus()).toMatchObject({
        running: false,
        lastError: expect.stringContaining('exited'),
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(cliStartMock).toHaveBeenCalledTimes(4);
      expect(mod.getFeishuWSClientStatus().running).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending lark-cli reconnect when the connection is stopped explicitly', async () => {
    vi.useFakeTimers();
    try {
      const mod = await import('@/lib/im/feishu-ws-client');
      await mod.startFeishuWSClient(larkCliConfig);
      capturedOnExit(0)(new Error('websocket disconnected'));

      mod.stopFeishuWSClient();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(cliStartMock).toHaveBeenCalledTimes(1);
      expect(mod.getFeishuWSClientStatus().running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late lark-cli exit after the connection was stopped explicitly', async () => {
    vi.useFakeTimers();
    try {
      const mod = await import('@/lib/im/feishu-ws-client');
      await mod.startFeishuWSClient(larkCliConfig);

      mod.stopFeishuWSClient();
      expect(cliStopMock).toHaveBeenCalledTimes(1);
      capturedOnExit(0)(new Error('websocket disconnected'));

      await vi.advanceTimersByTimeAsync(120_000);
      expect(cliStartMock).toHaveBeenCalledTimes(1);
      expect(mod.getFeishuWSClientStatus().running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('doubles the lark-cli reconnect delay from 1s and caps it at 60s', async () => {
    const mod = await import('@/lib/im/feishu-ws-client');

    expect(mod.nextFeishuReconnectDelayMs(undefined)).toBe(1_000);
    expect(mod.nextFeishuReconnectDelayMs(1_000)).toBe(2_000);
    expect(mod.nextFeishuReconnectDelayMs(2_000)).toBe(4_000);
    expect(mod.nextFeishuReconnectDelayMs(32_000)).toBe(60_000);
    expect(mod.nextFeishuReconnectDelayMs(60_000)).toBe(60_000);
    expect(mod.nextFeishuReconnectDelayMs(Number.NaN)).toBe(1_000);
  });
});
