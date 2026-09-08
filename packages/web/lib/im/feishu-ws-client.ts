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

type LarkCliFeishuConfig = FeishuConfig & {
  credential_source: 'lark_cli_profile';
  credential_ref: NonNullable<FeishuConfig['credential_ref']>;
};

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

let runtime: FeishuWSRuntime | null = null;
let lastError: string | undefined;

// The Lark SDK WSClient reconnects on its own (autoReconnect). The lark-cli consumer is a child
// process that simply exits when its websocket drops, so this module owns its reconnect loop.
let larkCliGeneration = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelayMs: number | undefined;
let reconnectAttempts = 0;
let stopRequested = false;

/** Exponential backoff for lark-cli reconnects: 1s, 2s, 4s, ... capped at 60s. */
export function nextFeishuReconnectDelayMs(previous: number | undefined): number {
  if (previous === undefined || !Number.isFinite(previous) || previous < RECONNECT_BASE_DELAY_MS) {
    return RECONNECT_BASE_DELAY_MS;
  }
  return Math.min(previous * 2, RECONNECT_MAX_DELAY_MS);
}

function assertFeishuWSConfig(
  config: FeishuConfig,
): asserts config is FeishuConfig & { app_id: string; app_secret: string } {
  if (!config.app_id?.trim() || !config.app_secret?.trim()) {
    throw new Error('Feishu App ID and App Secret are required for long connection mode');
  }
}

function hasLarkCliProfile(config: FeishuConfig): config is LarkCliFeishuConfig {
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

function clearReconnectTimer(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function resetReconnectBackoff(): void {
  reconnectDelayMs = undefined;
  reconnectAttempts = 0;
}

async function startLarkCliRuntime(config: LarkCliFeishuConfig): Promise<void> {
  const generation = ++larkCliGeneration;
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
    onExit: (error) => handleLarkCliExit(config, generation, error),
  });
  await cli.start();
  if (stopRequested || generation !== larkCliGeneration) {
    // stopFeishuWSClient() or a newer start won the race while this consumer was booting.
    cli.stop();
    return;
  }
  const status = cli.status();
  runtime = {
    close: cli.stop,
    startedAt: status.startedAt ?? new Date().toISOString(),
  };
  resetReconnectBackoff();
  setFeishuWSClientStatus({ running: true, startedAt: runtime.startedAt, lastError: status.lastError });
  console.log('[feishu/cli] existing bot event connection started');
}

function handleLarkCliExit(config: LarkCliFeishuConfig, generation: number, error?: Error): void {
  // A consumer that was already replaced or explicitly stopped must not touch current state.
  if (generation !== larkCliGeneration) return;
  runtime = null;
  lastError = error?.message || 'lark-cli event consumer exited';
  console.warn(`[feishu/cli] event consumer exited: ${lastError}`);
  publishLarkCliDown(config);
}

function publishLarkCliDown(config: LarkCliFeishuConfig): void {
  const retry = scheduleLarkCliReconnect(config);
  setFeishuWSClientStatus({ running: false, lastError, ...retry });
}

function scheduleLarkCliReconnect(
  config: LarkCliFeishuConfig,
): { reconnectAttempts: number; nextRetryAt: string } | undefined {
  if (stopRequested || reconnectTimer) return undefined;
  reconnectDelayMs = nextFeishuReconnectDelayMs(reconnectDelayMs);
  reconnectAttempts += 1;
  const delayMs = reconnectDelayMs;
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
  console.warn(`[feishu/cli] reconnect attempt ${reconnectAttempts} scheduled in ${delayMs}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void reconnectLarkCliRuntime(config);
  }, delayMs);
  reconnectTimer.unref?.();
  return { reconnectAttempts, nextRetryAt };
}

async function reconnectLarkCliRuntime(config: LarkCliFeishuConfig): Promise<void> {
  if (stopRequested || runtime) return;
  try {
    await startLarkCliRuntime(config);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.warn(`[feishu/cli] reconnect failed: ${lastError}`);
    publishLarkCliDown(config);
  }
}

export async function startFeishuWSClient(config: FeishuConfig): Promise<void> {
  if (runtime) return;

  stopRequested = false;
  clearReconnectTimer();
  resetReconnectBackoff();
  lastError = undefined;

  if (hasLarkCliProfile(config)) {
    try {
      await startLarkCliRuntime(config);
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
  stopRequested = true;
  larkCliGeneration += 1;
  const hadPendingReconnect = reconnectTimer !== undefined;
  clearReconnectTimer();
  resetReconnectBackoff();

  if (runtime) {
    runtime.close();
    runtime = null;
    console.log('[feishu/ws] long connection stopped');
  } else if (!hadPendingReconnect) {
    return;
  }
  setFeishuWSClientStatus({
    running: false,
    lastError,
  });
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
  clearReconnectTimer();
  resetReconnectBackoff();
  runtime = null;
  lastError = undefined;
  stopRequested = false;
  larkCliGeneration += 1;
  __resetFeishuWSClientStatusForTests();
}

export { getFeishuWSClientStatus };
