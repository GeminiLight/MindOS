import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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

const CHANNEL_CREDENTIAL_SETS: Record<string, string[][]> = {
  telegram: [['bot_token']],
  discord: [['bot_token']],
  feishu: [['app_id', 'app_secret']],
  slack: [['bot_token']],
  wecom: [['webhook_key'], ['corp_id', 'corp_secret']],
  dingtalk: [['webhook_url'], ['client_id', 'client_secret']],
  wechat: [['bot_token']],
  qq: [['app_id', 'app_secret']],
};

const CHANNEL_FIELD_PATTERNS: Record<string, Record<string, RegExp>> = {
  telegram: { bot_token: /^\d+:[A-Za-z0-9_-]{25,}$/ },
  discord: { bot_token: /^[A-Za-z0-9._-]{20,}$/ },
  slack: { bot_token: /^xoxb-/ },
  wecom: { webhook_key: /^[A-Za-z0-9_-]{6,}$/ },
  dingtalk: { webhook_url: /^https:\/\// },
};

export function handleImConfigGet(
  services: ImConfigServices = {},
): MindosServerResponse<{ providers: Record<string, Record<string, string>> } | { error: string }> {
  try {
    const config = readConfig(services);
    const masked: Record<string, Record<string, string>> = {};
    for (const [platform, credentials] of Object.entries(config.providers ?? {})) {
      if (!credentials || typeof credentials !== 'object') continue;
      const current: Record<string, string> = {};
      for (const [key, value] of Object.entries(credentials as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 4) current[key] = `${value.slice(0, 4)}••••${value.slice(-2)}`;
        else current[key] = typeof value === 'string' ? '••••' : '';
      }
      masked[platform] = current;
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

    const config = readConfig(services);
    config.providers ??= {};
    const existing = config.providers[platform] ?? {};

    if (credentials && typeof credentials === 'object') {
      const mergedCredentials = { ...existing, ...credentials };
      const validation = validateConfig(platform, mergedCredentials);
      if (!validation.valid) {
        return json({
          error: `Invalid config: missing ${validation.missing?.join(', ')}`,
          missing: validation.missing,
        }, { status: 422 });
      }
      config.providers[platform] = mergedCredentials;
    }

    if (platform === 'feishu' && conversation && typeof conversation === 'object') {
      if (!existing.app_id || !existing.app_secret) {
        return json({ error: 'Save Feishu App ID and App Secret before enabling conversations' }, { status: 422 });
      }
      const merged = config.providers[platform] ?? existing;
      merged.conversation = {
        ...(merged.conversation ?? {}),
        enabled: Boolean(conversation.enabled),
        transport: conversation.transport ?? merged.conversation?.transport ?? 'webhook',
        encrypt_key: conversation.encrypt_key ?? merged.conversation?.encrypt_key,
        verification_token: conversation.verification_token ?? merged.conversation?.verification_token,
        public_base_url: conversation.public_base_url ?? merged.conversation?.public_base_url,
        allow_group_mentions: conversation.allow_group_mentions ?? merged.conversation?.allow_group_mentions ?? true,
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

function validateConfig(platform: string, credentials: Record<string, unknown>): { valid: boolean; missing?: string[] } {
  const credentialSets = CHANNEL_CREDENTIAL_SETS[platform];
  if (!credentialSets) return { valid: false, missing: ['(unknown platform)'] };
  const patterns = CHANNEL_FIELD_PATTERNS[platform] ?? {};
  let bestMissing = credentialSets[0] ?? ['(unknown platform)'];
  for (const fields of credentialSets) {
    const missing = fields.filter((field) => {
      const value = credentials[field];
      if (typeof value !== 'string' || !value.trim()) return true;
      const pattern = patterns[field];
      return pattern ? !pattern.test(value) : false;
    });
    if (missing.length === 0) return { valid: true };
    if (missing.length < bestMissing.length) bestMissing = missing;
  }
  return { valid: false, missing: bestMissing };
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
  const tmpPath = `${configPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, configPath);
}
