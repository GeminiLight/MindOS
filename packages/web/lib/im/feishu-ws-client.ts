import * as Lark from '@larksuiteoapi/node-sdk';
import { createLarkCliEventClient } from './lark-cli-event-client';
import {
  __resetFeishuWSClientStatusForTests,
  getFeishuWSClientStatus,
  setFeishuWSClientStatus,
} from './feishu-ws-status';
import type { FeishuConfig, FeishuSdkMessageEvent } from './types';

type FeishuWSRuntime = {
  close(): void;
  startedAt: string;
};

let runtime: FeishuWSRuntime | null = null;
let lastError: string | undefined;

function assertFeishuWSConfig(
  config: FeishuConfig,
): asserts config is FeishuConfig & { app_id: string; app_secret: string } {
  if (!config.app_id?.trim() || !config.app_secret?.trim()) {
    throw new Error('Feishu App ID and App Secret are required for long connection mode');
  }
}

function hasLarkCliProfile(config: FeishuConfig): config is FeishuConfig & {
  credential_source: 'lark_cli_profile';
  credential_ref: NonNullable<FeishuConfig['credential_ref']>;
} {
  return config.credential_source === 'lark_cli_profile'
    && config.credential_ref?.kind === 'lark-cli-profile'
    && config.credential_ref.executablePath.startsWith('/')
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(config.credential_ref.profile);
}

function createDispatcher(): Lark.EventDispatcher {
  return new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (event: unknown) => {
      console.log('[feishu/ws] received im.message.receive_v1 event');
      try {
        const { handleFeishuMessageReceiveEvent } = await import('./webhook/feishu-event');
        return await handleFeishuMessageReceiveEvent(event as FeishuSdkMessageEvent);
      } catch (error) {
        console.error('[feishu/ws] event handler error:', error instanceof Error ? error.message : String(error));
        return { ok: false, error: 'handler_failed' };
      }
    },
  });
}

export async function startFeishuWSClient(config: FeishuConfig): Promise<void> {
  if (runtime) return;

  lastError = undefined;

  if (hasLarkCliProfile(config)) {
    const cli = createLarkCliEventClient({
      executablePath: config.credential_ref.executablePath,
      profile: config.credential_ref.profile,
      onEvent: async (event) => {
        try {
          const { handleLarkCliMessageReceiveEvent } = await import('./webhook/feishu-event');
          await handleLarkCliMessageReceiveEvent(event);
        } catch (error) {
          console.error('[feishu/cli] event handler error:', error instanceof Error ? error.message : String(error));
        }
      },
    });
    try {
      await cli.start();
      const status = cli.status();
      runtime = {
        close: cli.stop,
        startedAt: status.startedAt ?? new Date().toISOString(),
      };
      setFeishuWSClientStatus({ running: true, startedAt: runtime.startedAt, lastError: status.lastError });
      console.log('[feishu/cli] existing bot event connection started');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      setFeishuWSClientStatus({ running: false, lastError });
      throw error;
    }
  }

  assertFeishuWSConfig(config);

  const client = new Lark.WSClient({
    appId: config.app_id,
    appSecret: config.app_secret,
    autoReconnect: true,
    loggerLevel: Lark.LoggerLevel.info,
  });

  try {
    await client.start({
      eventDispatcher: createDispatcher(),
    });
    runtime = {
      close: () => client.close(),
      startedAt: new Date().toISOString(),
    };
    setFeishuWSClientStatus({
      running: true,
      startedAt: runtime.startedAt,
      lastError: undefined,
    });
    console.log('[feishu/ws] long connection started');
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    setFeishuWSClientStatus({
      running: false,
      lastError,
    });
    console.error('[feishu/ws] failed to start:', lastError);
    throw error;
  }
}

export function stopFeishuWSClient(): void {
  if (!runtime) return;
  runtime.close();
  runtime = null;
  setFeishuWSClientStatus({
    running: false,
    lastError,
  });
  console.log('[feishu/ws] long connection stopped');
}

/** Auto-start if config says long_connection is enabled. Called from instrumentation.ts. */
export async function autoStartFeishuWSIfNeeded(): Promise<void> {
  try {
    const { getPlatformConfig } = await import('./config');
    const config = getPlatformConfig('feishu');
    if (!config) return;
    if (config.conversation?.transport !== 'long_connection') return;
    if (!config.conversation?.enabled) return;

    console.log('[feishu/ws] auto-starting long connection (transport=long_connection)');
    await startFeishuWSClient(config);
  } catch (error) {
    console.warn('[feishu/ws] auto-start failed:', error instanceof Error ? error.message : String(error));
  }
}

export function __resetFeishuWSClientForTests(): void {
  runtime = null;
  lastError = undefined;
  __resetFeishuWSClientStatusForTests();
}

export { getFeishuWSClientStatus };
