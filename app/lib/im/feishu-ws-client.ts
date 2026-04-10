import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig, FeishuSdkMessageEvent } from './types';
import { handleFeishuMessageReceiveEvent } from './webhook/feishu';

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
    'im.message.receive_v1': (event: unknown) => handleFeishuMessageReceiveEvent(event as FeishuSdkMessageEvent),
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
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

export function stopFeishuWSClient(): void {
  runtime?.client.close();
  runtime = null;
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

export function __resetFeishuWSClientForTests(): void {
  runtime = null;
  lastError = undefined;
}
