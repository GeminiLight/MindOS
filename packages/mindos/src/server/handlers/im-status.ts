import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CHANNEL_CAPABILITIES,
  isChannelPlatform,
  validateChannelCredentials,
} from '../channel-contract.js';
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

export type ImOAuthStatus = {
  state: 'disconnected' | 'pending' | 'connected';
  expiresAt?: string;
  user?: {
    name?: string;
    en_name?: string;
    avatar_url?: string;
    open_id?: string;
    union_id?: string;
    user_id?: string;
    email?: string;
  };
};

export type ImStatusPlatform = {
  platform: ImPlatform;
  connected: boolean;
  botName?: string;
  capabilities: string[];
  webhook?: ImWebhookStatus;
  oauth?: ImOAuthStatus;
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
  buildFeishuOAuthStatus?(config: unknown): ImOAuthStatus;
};

const DEFAULT_IM_CONFIG_PATH = join(homedir(), '.mindos', 'im.json');

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
    const buildFeishuOAuthStatus = services.buildFeishuOAuthStatus ?? defaultBuildFeishuOAuthStatus;
    const feishuConfig = getPlatformConfig('feishu');
    const feishuWebhook = buildFeishuWebhookStatus(feishuConfig);
    const feishuOAuth = buildFeishuOAuthStatus(feishuConfig);
    const enriched = platforms.map((platform) => (
      platform.platform === 'feishu'
        ? { ...platform, webhook: feishuWebhook, oauth: feishuOAuth }
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

function defaultBuildFeishuOAuthStatus(config: unknown): ImOAuthStatus {
  const feishuConfig = config && typeof config === 'object' ? config as Record<string, any> : undefined;
  const oauth = feishuConfig?.oauth && typeof feishuConfig.oauth === 'object'
    ? feishuConfig.oauth as Record<string, any>
    : undefined;

  if (!oauth) return { state: 'disconnected' };
  if (oauth.status === 'connected') {
    return {
      state: 'connected',
      expiresAt: typeof oauth.expires_at === 'string' ? oauth.expires_at : undefined,
      user: pickOAuthUser(oauth.user),
    };
  }
  if (oauth.pending && typeof oauth.pending === 'object') {
    return {
      state: 'pending',
      expiresAt: typeof oauth.pending.expires_at === 'string' ? oauth.pending.expires_at : undefined,
    };
  }
  return { state: 'disconnected' };
}

function pickOAuthUser(raw: unknown): ImOAuthStatus['user'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const user: NonNullable<ImOAuthStatus['user']> = {};
  for (const key of ['name', 'en_name', 'avatar_url', 'open_id', 'union_id', 'user_id', 'email'] as const) {
    const value = source[key];
    if (typeof value === 'string' && value) user[key] = value;
  }
  return Object.keys(user).length > 0 ? user : undefined;
}

function defaultListConfiguredIM(services: ImStatusServices): ImStatusPlatform[] {
  const config = readConfig(services);
  const platforms = Object.keys(config.providers).filter((platform) => isConfiguredPlatform(platform, config)) as ImPlatform[];
  return platforms.map((platform) => ({
    platform,
    connected: false,
    capabilities: CHANNEL_CAPABILITIES[platform] ?? ['text'],
  }));
}

function isConfiguredPlatform(platform: string, config: ImStatusConfig): platform is ImPlatform {
  if (!isChannelPlatform(platform)) return false;
  const platformConfig = config.providers[platform];
  if (!platformConfig || typeof platformConfig !== 'object') return false;
  return validateChannelCredentials(platform, platformConfig).valid;
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
    if (!hasLongConnectionCredential(feishuConfig)) {
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

function hasLongConnectionCredential(config?: Record<string, any>): boolean {
  if (typeof config?.app_id === 'string' && config.app_id.trim() && typeof config?.app_secret === 'string' && config.app_secret.trim()) {
    return true;
  }
  const ref = config?.credential_ref;
  return config?.credential_source === 'lark_cli_profile'
    && ref?.kind === 'lark-cli-profile'
    && typeof ref.executablePath === 'string'
    && ref.executablePath.startsWith('/')
    && typeof ref.profile === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(ref.profile);
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
