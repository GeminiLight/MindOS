import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeishuConfig } from '@/lib/im/types';

const { startMock, closeMock, wsClientCtor, registerMock, cliStartMock, cliStopMock, cliFactoryMock } = vi.hoisted(() => {
  const startMock = vi.fn().mockResolvedValue(undefined);
  const closeMock = vi.fn();
  const wsClientCtor = vi.fn();
  const registerMock = vi.fn(function () { return this; });
  const cliStartMock = vi.fn().mockResolvedValue(undefined);
  const cliStopMock = vi.fn();
  const cliFactoryMock = vi.fn(() => ({
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
});
