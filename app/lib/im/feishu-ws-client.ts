import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig, FeishuSdkMessageEvent } from './types';

type FeishuWSRuntime = {
  client: Lark.WSClient;
  startedAt: string;
};

let runtime: FeishuWSRuntime | null = null;
let lastError: string | undefined;

function assertFeishuWSConfig(config: FeishuConfig): void {
  if (!config.app_id?.trim() || !config.app_secret?.trim()) {
    throw new Error('Feishu App ID and App Secret are required for long connection mode');
  }
}

function createDispatcher(): Lark.EventDispatcher {
  return new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (event: unknown) => {
      console.log('[feishu/ws] received im.message.receive_v1 event');
      try {
        const { handleFeishuMessageReceiveEvent } = await import('./webhook/feishu');
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

  assertFeishuWSConfig(config);
  lastError = undefined;

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
      client,
      startedAt: new Date().toISOString(),
    };
    console.log('[feishu/ws] long connection started');
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[feishu/ws] failed to start:', lastError);
    throw error;
  }
}

export function stopFeishuWSClient(): void {
  if (!runtime) return;
  runtime.client.close();
  runtime = null;
  console.log('[feishu/ws] long connection stopped');
}

export function getFeishuWSClientStatus(): {
  running: boolean;
  startedAt?: string;
  lastError?: string;
} {
  return {
    running: runtime !== null,
    startedAt: runtime?.startedAt,
    lastError,
  };
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
}
