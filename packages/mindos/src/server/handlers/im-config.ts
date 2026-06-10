import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  isChannelPlatform,
  normalizeChannelCredentials,
  validateChannelCredentials,
} from '../channel-contract.js';
import { json, type MindosServerResponse } from '../response.js';

export type ImConfig = {
  providers: Record<string, any>;
};

export type ImConfigConversation = {
  enabled?: boolean;
  transport?: 'webhook' | 'long_connection';
  encrypt_key?: string;
  verification_token?: string;
  public_base_url?: string;
  allow_group_mentions?: boolean;
};

export type ImConfigPutPayload = {
  platform?: string;
  credentials?: Record<string, string>;
  conversation?: ImConfigConversation;
};

export type ImConfigServices = {
  configPath?: string;
  readConfig?(): ImConfig;
  writeConfig?(config: ImConfig): void;
};

const DEFAULT_IM_CONFIG_PATH = join(homedir(), '.mindos', 'im.json');

export function handleImConfigGet(
  services: ImConfigServices = {},
): MindosServerResponse<{ providers: Record<string, Record<string, unknown>> } | { error: string }> {
  try {
    const config = readConfig(services);
    const masked: Record<string, Record<string, unknown>> = {};
    for (const [platform, credentials] of Object.entries(config.providers ?? {})) {
      if (!credentials || typeof credentials !== 'object') continue;
      masked[platform] = maskProviderConfig(credentials) as Record<string, unknown>;
    }
    return json({ providers: masked });
  } catch {
    return json({ error: 'Failed to read config' }, { status: 500 });
  }
}

export function handleImConfigPut(
  body: ImConfigPutPayload | unknown,
  services: ImConfigServices = {},
): MindosServerResponse<{ ok: true; platform: string } | { error: string; missing?: string[] }> {
  try {
    const payload = body && typeof body === 'object' ? body as ImConfigPutPayload : {};
    const { platform, credentials, conversation } = payload;
    if (!platform || ((!credentials || typeof credentials !== 'object') && (!conversation || typeof conversation !== 'object'))) {
      return json({ error: 'Missing platform credentials or conversation settings' }, { status: 400 });
    }
    if (!isChannelPlatform(platform)) {
      return json({ error: 'Invalid platform' }, { status: 400 });
    }
    if (conversation && typeof conversation === 'object' && platform !== 'feishu') {
      return json({ error: 'Conversation settings are only supported for Feishu' }, { status: 422 });
    }

    const config = readConfig(services);
    config.providers ??= {};
    const existing = config.providers[platform] ?? {};

    if (credentials && typeof credentials === 'object') {
      const cleanCredentials = normalizeChannelCredentials(platform, credentials);
      if (Object.keys(cleanCredentials).length === 0) {
        return json({ error: 'No credential values provided' }, { status: 400 });
      }
      const mergedCredentials = { ...existing, ...cleanCredentials };
      const validation = validateChannelCredentials(platform, mergedCredentials);
      if (!validation.valid) {
        return json({
          error: `Invalid config: missing ${validation.missing?.join(', ')}`,
          missing: validation.missing,
        }, { status: 422 });
      }
      config.providers[platform] = mergedCredentials;
    }

    if (platform === 'feishu' && conversation && typeof conversation === 'object') {
      const merged = config.providers[platform] ?? existing;
      if (!merged.app_id || !merged.app_secret) {
        return json({ error: 'Save Feishu App ID and App Secret before enabling conversations' }, { status: 422 });
      }
      const currentConversation = merged.conversation && typeof merged.conversation === 'object'
        ? merged.conversation
        : {};
      merged.conversation = {
        ...currentConversation,
        enabled: Object.hasOwn(conversation, 'enabled') ? Boolean(conversation.enabled) : Boolean(currentConversation.enabled),
        transport: isFeishuConversationTransport(conversation.transport)
          ? conversation.transport
          : currentConversation.transport ?? 'webhook',
        encrypt_key: nonEmptyStringOrExisting(conversation.encrypt_key, currentConversation.encrypt_key),
        verification_token: nonEmptyStringOrExisting(conversation.verification_token, currentConversation.verification_token),
        public_base_url: nonEmptyStringOrExisting(conversation.public_base_url, currentConversation.public_base_url),
        allow_group_mentions: Object.hasOwn(conversation, 'allow_group_mentions')
          ? Boolean(conversation.allow_group_mentions)
          : currentConversation.allow_group_mentions ?? true,
      };
      config.providers[platform] = merged;
    }

    writeConfig(config, services);
    return json({ ok: true, platform });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Failed to save' }, { status: 500 });
  }
}

export function handleImConfigDelete(
  searchParams: URLSearchParams,
  services: ImConfigServices = {},
): MindosServerResponse<{ ok: true; platform: string } | { error: string }> {
  try {
    const platform = searchParams.get('platform');
    if (!platform) {
      return json({ error: 'Missing platform parameter' }, { status: 400 });
    }

    const config = readConfig(services);
    config.providers ??= {};
    delete config.providers[platform];
    writeConfig(config, services);
    return json({ ok: true, platform });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Failed to delete' }, { status: 500 });
  }
}

function readConfig(services: ImConfigServices): ImConfig {
  if (services.readConfig) return services.readConfig();
  const configPath = services.configPath ?? DEFAULT_IM_CONFIG_PATH;
  try {
    if (!existsSync(configPath)) return { providers: {} };
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as ImConfig;
    if (!parsed || typeof parsed !== 'object' || !parsed.providers || typeof parsed.providers !== 'object') {
      return { providers: {} };
    }
    return parsed;
  } catch {
    return { providers: {} };
  }
}

function writeConfig(config: ImConfig, services: ImConfigServices): void {
  if (services.writeConfig) {
    services.writeConfig(config);
    return;
  }
  const configPath = services.configPath ?? DEFAULT_IM_CONFIG_PATH;
  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, configPath);
  if (process.platform !== 'win32') {
    try { chmodSync(configPath, 0o600); } catch { /* best effort */ }
  }
}

function isFeishuConversationTransport(value: unknown): value is NonNullable<ImConfigConversation['transport']> {
  return value === 'webhook' || value === 'long_connection';
}

function nonEmptyStringOrExisting(value: unknown, existing: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return typeof existing === 'string' ? existing : undefined;
}

function maskProviderConfig(value: unknown, path: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item, index) => maskProviderConfig(item, [...path, String(index)]));
  if (value && typeof value === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      masked[key] = maskProviderConfig(nested, [...path, key]);
    }
    return masked;
  }
  if (typeof value !== 'string') return value;
  return isVisibleConfigString(path) ? value : maskSecret(value);
}

function isVisibleConfigString(path: string[]): boolean {
  const joined = path.join('.');
  return joined === 'conversation.transport' || joined === 'conversation.public_base_url';
}

function maskSecret(value: string): string {
  if (value.length > 4) return `${value.slice(0, 4)}••••${value.slice(-2)}`;
  return '••••';
}
