// ─── IM Unified Executor ──────────────────────────────────────────────────────
// Manages adapter lifecycle (lazy-load, singleton cache, hot-reload) and dispatches messages.

import type { IMAdapter, IMMessage, IMPlatform, IMSendResult } from './types';
import { isValidRecipientId, PLATFORM_LIMITS } from './types';
import { getPlatformConfig, getIMConfigMtime, getConfiguredPlatforms } from './config';
import { preprocessMessage } from './format';
import { retryDelay, sleep } from '@/lib/agent/reconnect';

const MAX_RETRIES = 3;

// ─── Adapter Cache + Hot-Reload ───────────────────────────────────────────────

const adapterCache = new Map<IMPlatform, IMAdapter>();
let lastConfigMtime = 0;

async function getAdapter(platform: IMPlatform): Promise<IMAdapter> {
  // Hot-reload: if config changed, clear cache and rebuild
  const currentMtime = getIMConfigMtime();
  if (currentMtime > 0 && currentMtime !== lastConfigMtime) {
    const stale = [...adapterCache.values()];
    adapterCache.clear();
    lastConfigMtime = currentMtime;
    // Async dispose old adapters (don't block current request)
    Promise.allSettled(stale.map((a) => a.dispose())).catch(() => {});
  }

  if (adapterCache.has(platform)) return adapterCache.get(platform)!;

  let adapter: IMAdapter;
  switch (platform) {
    case 'telegram': {
      const tgConfig = getPlatformConfig('telegram');
      if (!tgConfig) throw new Error('Platform "telegram" not configured. Add credentials to ~/.mindos/im.json');
      const { TelegramAdapter } = await import('./adapters/telegram');
      adapter = new TelegramAdapter(tgConfig);
      break;
    }
    case 'feishu': {
      const fsConfig = getPlatformConfig('feishu');
      if (!fsConfig) throw new Error('Platform "feishu" not configured. Add credentials to ~/.mindos/im.json');
      const { FeishuAdapter } = await import('./adapters/feishu');
      adapter = new FeishuAdapter(fsConfig);
      break;
    }
    case 'discord': {
      const dcConfig = getPlatformConfig('discord');
      if (!dcConfig) throw new Error('Platform "discord" not configured. Add credentials to ~/.mindos/im.json');
      const { DiscordAdapter } = await import('./adapters/discord');
      adapter = new DiscordAdapter(dcConfig);
      break;
    }
    case 'slack': {
      const slConfig = getPlatformConfig('slack');
      if (!slConfig) throw new Error('Platform "slack" not configured. Add credentials to ~/.mindos/im.json');
      const { SlackAdapter } = await import('./adapters/slack');
      adapter = new SlackAdapter(slConfig);
      break;
    }
    case 'wecom': {
      const wcConfig = getPlatformConfig('wecom');
      if (!wcConfig) throw new Error('Platform "wecom" not configured. Add credentials to ~/.mindos/im.json');
      const { WeComAdapter } = await import('./adapters/wecom');
      adapter = new WeComAdapter(wcConfig);
      break;
    }
    case 'dingtalk': {
      const dtConfig = getPlatformConfig('dingtalk');
      if (!dtConfig) throw new Error('Platform "dingtalk" not configured. Add credentials to ~/.mindos/im.json');
      const { DingTalkAdapter } = await import('./adapters/dingtalk');
      adapter = new DingTalkAdapter(dtConfig);
      break;
    }
    case 'wechat': {
      const wxConfig = getPlatformConfig('wechat');
      if (!wxConfig) throw new Error('Platform "wechat" not configured. Add credentials to ~/.mindos/im.json');
      const { WeChatAdapter } = await import('./adapters/wechat');
      adapter = new WeChatAdapter(wxConfig);
      break;
    }
    case 'qq': {
      const qqConfig = getPlatformConfig('qq');
      if (!qqConfig) throw new Error('Platform "qq" not configured. Add credentials to ~/.mindos/im.json');
      const { QQAdapter } = await import('./adapters/qq');
      adapter = new QQAdapter(qqConfig);
      break;
    }
    default:
      throw new Error(`Platform "${platform}" adapter not yet implemented`);
  }

  adapterCache.set(platform, adapter);
  return adapter;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Send a message to an IM platform with retry and format preprocessing. */
export async function sendIMMessage(
  message: IMMessage,
  signal?: AbortSignal,
): Promise<IMSendResult> {
  // Validate inputs
  if (!message.text || !message.text.trim()) {
    return { ok: false, error: 'Message text cannot be empty', timestamp: new Date().toISOString() };
  }
  if (!message.recipientId || !message.recipientId.trim()) {
    return { ok: false, error: 'Recipient ID cannot be empty', timestamp: new Date().toISOString() };
  }
  if (!isValidRecipientId(message.platform, message.recipientId)) {
    return { ok: false, error: `Invalid recipient_id format for ${message.platform}`, timestamp: new Date().toISOString() };
  }

  // Preprocess: downgrade format + truncate
  const processed = preprocessMessage(message);

  // Get adapter (lazy load)
  let adapter: IMAdapter;
  try {
    adapter = await getAdapter(processed.platform);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() };
  }

  // Send with retry
  return sendWithRetry(adapter, processed, signal);
}

/** List all configured and connectable platforms. */
export async function listConfiguredIM(): Promise<Array<{
  platform: IMPlatform;
  connected: boolean;
  botName?: string;
  capabilities: string[];
}>> {
  const platforms = getConfiguredPlatforms();
  const results: Array<{ platform: IMPlatform; connected: boolean; botName?: string; capabilities: string[] }> = [];

  for (const platform of platforms) {
    const limits = PLATFORM_LIMITS[platform];
    const caps: string[] = ['text'];
    if (limits.supportsMarkdown) caps.push('markdown');
    if (limits.supportsHtml) caps.push('html');
    if (limits.supportsThreads) caps.push('threads');
    if (limits.supportsAttachments) caps.push('attachments');

    let connected = false;
    let botName: string | undefined;
    try {
      const adapter = await getAdapter(platform);
      connected = await adapter.verify();
      // Platform-specific bot name extraction
      if (platform === 'telegram' && 'getBotInfo' in adapter) {
        const info = (adapter as { getBotInfo(): { username: string } | null }).getBotInfo();
        if (info) botName = `@${info.username}`;
      }
      if (platform === 'discord' && 'getBotInfo' in adapter) {
        const info = (adapter as { getBotInfo(): { username: string } | null }).getBotInfo();
        if (info) botName = info.username;
      }
      if (platform === 'feishu' && 'getAppName' in adapter) {
        const name = (adapter as { getAppName(): string | null }).getAppName();
        if (name) botName = name;
      }
    } catch {
      connected = false;
    }

    results.push({ platform, connected, botName, capabilities: caps });
  }

  return results;
}

/** Dispose all cached adapters (for testing / shutdown). */
export async function disposeAllAdapters(): Promise<void> {
  const adapters = [...adapterCache.values()];
  adapterCache.clear();
  lastConfigMtime = 0;
  await Promise.allSettled(adapters.map((a) => a.dispose()));
}

// ─── Retry Logic (reuses MindOS existing retry utilities) ─────────────────────

async function sendWithRetry(
  adapter: IMAdapter,
  message: IMMessage,
  signal?: AbortSignal,
): Promise<IMSendResult> {
  let lastResult: IMSendResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await adapter.send(message, signal);

    if (result.ok) return result;

    lastResult = result;

    // Don't retry client errors or cancellations
    if (!isRetryableError(result.error)) return result;

    // Don't wait after the last attempt
    if (attempt === MAX_RETRIES) break;

    // Exponential backoff using MindOS retry utils
    const delay = retryDelay(attempt);
    await sleep(delay, signal);
  }

  return lastResult ?? { ok: false, error: 'Unknown error after retries', timestamp: new Date().toISOString() };
}

function isRetryableError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  if (lower.includes('cancel')) return false;
  if (lower.includes('abort')) return false;
  // Retry on rate limits and server/network errors
  if (lower.includes('rate limit') || lower.includes('429')) return true;
  if (lower.includes('timed out') || lower.includes('timeout')) return true;
  if (lower.includes('econnreset') || lower.includes('etimedout') || lower.includes('enotfound')) return true;
  if (lower.includes('500') || lower.includes('502') || lower.includes('503')) return true;
  return false;
}
