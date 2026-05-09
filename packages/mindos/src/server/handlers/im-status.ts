import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';
import type { ImPlatform } from './im-activity.js';

export type ImWebhookStatus = {
  platform: 'feishu';
  state: 'disabled' | 'pending' | 'ready' | 'error';
  transport: 'webhook' | 'long_connection';
  publicBaseUrl?: string;
  webhookUrl?: string;
  lastError?: string;
};

export type ImStatusPlatform = {
  platform: ImPlatform;
  connected: boolean;
  botName?: string;
  capabilities: string[];
  webhook?: ImWebhookStatus;
};

export type ImStatusConfig = {
  providers: Record<string, any>;
};

export type ImStatusServices = {
  configPath?: string;
  hasAnyIMConfig?(): boolean;
  listConfiguredIM?(): Promise<ImStatusPlatform[]>;
  getPlatformConfig?(platform: ImPlatform): unknown;
  buildFeishuWebhookStatus?(config: unknown): ImWebhookStatus;
};

const DEFAULT_IM_CONFIG_PATH = join(homedir(), '.mindos', 'im.json');

const PLATFORM_CAPABILITIES: Record<ImPlatform, string[]> = {
  telegram: ['text', 'markdown'],
  discord: ['text', 'markdown'],
  feishu: ['text', 'markdown'],
  slack: ['text', 'markdown'],
  wecom: ['text', 'markdown'],
  dingtalk: ['text', 'markdown'],
  wechat: ['text'],
  qq: ['text'],
};

const CONFIG_REQUIRED_FIELDS: Record<ImPlatform, string[][]> = {
  telegram: [['bot_token']],
  discord: [['bot_token']],
  feishu: [['app_id', 'app_secret']],
  slack: [['bot_token']],
  wecom: [['webhook_key'], ['corp_id', 'corp_secret']],
  dingtalk: [['webhook_url'], ['client_id', 'client_secret']],
  wechat: [['bot_token']],
  qq: [['app_id', 'app_secret']],
};

export async function handleImStatusGet(
  services: ImStatusServices = {},
): Promise<MindosServerResponse<{ platforms: ImStatusPlatform[] } | { platforms: []; error: string }>> {
  try {
    const hasAnyConfig = services.hasAnyIMConfig
      ? services.hasAnyIMConfig()
      : Object.keys(readConfig(services).providers).length > 0;

    if (!hasAnyConfig) {
      return json({ platforms: [] });
    }

    const listConfiguredIM = services.listConfiguredIM ?? (() => defaultListConfiguredIM(services));
    const platforms = await listConfiguredIM();
    const getPlatformConfig = services.getPlatformConfig ?? ((platform: ImPlatform) => readConfig(services).providers[platform]);
    const buildFeishuWebhookStatus = services.buildFeishuWebhookStatus ?? defaultBuildFeishuWebhookStatus;
    const feishuConfig = getPlatformConfig('feishu');
    const feishuWebhook = buildFeishuWebhookStatus(feishuConfig);
    const enriched = platforms.map((platform) => (
      platform.platform === 'feishu'
        ? { ...platform, webhook: feishuWebhook }
        : platform
    ));

    return json({ platforms: enriched });
  } catch {
    return json({ platforms: [], error: 'Failed to fetch IM status' }, { status: 500 });
  }
}

export function handleImWebhookStatusGet(
  searchParams: URLSearchParams,
  services: ImStatusServices = {},
): MindosServerResponse<{ status: ImWebhookStatus } | { error: string }> {
  const platform = searchParams.get('platform');
  if (platform !== 'feishu') {
    return json({ error: 'Invalid or unsupported platform parameter' }, { status: 400 });
  }

  const getPlatformConfig = services.getPlatformConfig ?? ((name: ImPlatform) => readConfig(services).providers[name]);
  const buildFeishuWebhookStatus = services.buildFeishuWebhookStatus ?? defaultBuildFeishuWebhookStatus;
  return json({ status: buildFeishuWebhookStatus(getPlatformConfig('feishu')) });
}

function defaultListConfiguredIM(services: ImStatusServices): ImStatusPlatform[] {
  const config = readConfig(services);
  const platforms = Object.keys(config.providers).filter((platform) => isConfiguredPlatform(platform, config)) as ImPlatform[];
  return platforms.map((platform) => ({
    platform,
    connected: false,
    capabilities: PLATFORM_CAPABILITIES[platform] ?? ['text'],
  }));
}

function isConfiguredPlatform(platform: string, config: ImStatusConfig): platform is ImPlatform {
  if (!(platform in CONFIG_REQUIRED_FIELDS)) return false;
  const platformConfig = config.providers[platform];
  if (!platformConfig || typeof platformConfig !== 'object') return false;
  return CONFIG_REQUIRED_FIELDS[platform as ImPlatform].some((fields) => (
    fields.every((field) => typeof (platformConfig as Record<string, unknown>)[field] === 'string' && Boolean((platformConfig as Record<string, string>)[field]?.trim()))
  ));
}

function defaultBuildFeishuWebhookStatus(config: unknown): ImWebhookStatus {
  const feishuConfig = config && typeof config === 'object' ? config as Record<string, any> : undefined;
  const conversation = feishuConfig?.conversation && typeof feishuConfig.conversation === 'object'
    ? feishuConfig.conversation as Record<string, any>
    : undefined;
  const transport = conversation?.transport === 'long_connection' ? 'long_connection' : 'webhook';
  const normalizedBaseUrl = typeof conversation?.public_base_url === 'string' && conversation.public_base_url.trim()
    ? conversation.public_base_url.trim().replace(/\/+$/, '')
    : undefined;
  const webhookUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/api/im/webhook/feishu` : undefined;

  if (!conversation?.enabled) {
    return {
      platform: 'feishu',
      state: 'disabled',
      transport,
      publicBaseUrl: normalizedBaseUrl,
      webhookUrl,
    };
  }

  if (transport === 'long_connection') {
    if (!feishuConfig?.app_id || !feishuConfig?.app_secret) {
      return {
        platform: 'feishu',
        state: 'error',
        transport,
        lastError: 'Feishu App ID and App Secret are required for long connection mode.',
      };
    }
    return {
      platform: 'feishu',
      state: 'pending',
      transport,
      lastError: 'Start the Feishu long connection client to receive events locally.',
    };
  }

  if (!conversation.encrypt_key) {
    return {
      platform: 'feishu',
      state: 'error',
      transport,
      publicBaseUrl: normalizedBaseUrl,
      webhookUrl,
      lastError: 'Encrypt Key is required to enable Feishu conversations.',
    };
  }

  if (!normalizedBaseUrl) {
    return {
      platform: 'feishu',
      state: 'pending',
      transport,
      lastError: 'Public base URL is required for Feishu event callbacks.',
    };
  }

  return {
    platform: 'feishu',
    state: 'ready',
    transport,
    publicBaseUrl: normalizedBaseUrl,
    webhookUrl,
  };
}

function readConfig(services: ImStatusServices): ImStatusConfig {
  const configPath = services.configPath ?? DEFAULT_IM_CONFIG_PATH;
  try {
    if (!existsSync(configPath)) return { providers: {} };
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as ImStatusConfig;
    if (!parsed || typeof parsed !== 'object' || !parsed.providers || typeof parsed.providers !== 'object') {
      return { providers: {} };
    }
    return parsed;
  } catch {
    return { providers: {} };
  }
}
