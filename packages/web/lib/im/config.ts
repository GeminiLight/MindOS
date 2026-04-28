// ─── IM Configuration Manager ─────────────────────────────────────────────────
// Reads/writes ~/.mindos/im.json with mtime-based caching and atomic writes.

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { IMConfig, IMPlatform, TelegramConfig, FeishuConfig, DiscordConfig, SlackConfig, WeComConfig, DingTalkConfig, WeChatConfig, QQConfig } from './types';

const IM_CONFIG_DIR = path.join(os.homedir(), '.mindos');
const IM_CONFIG_PATH = path.join(IM_CONFIG_DIR, 'im.json');

const EMPTY_CONFIG: IMConfig = { providers: {} };

// ─── Mtime-based Cache ────────────────────────────────────────────────────────

let cachedConfig: IMConfig = EMPTY_CONFIG;
let cachedMtime = 0;

function getFileMtime(): number {
  try {
    return fs.statSync(IM_CONFIG_PATH).mtimeMs;
  } catch {
    return 0; // file doesn't exist
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read IM config. Returns empty config if file is missing or corrupt. */
export function readIMConfig(): IMConfig {
  const mtime = getFileMtime();
  if (mtime > 0 && mtime === cachedMtime) return cachedConfig;

  if (!fs.existsSync(IM_CONFIG_PATH)) {
    cachedConfig = EMPTY_CONFIG;
    cachedMtime = 0;
    return EMPTY_CONFIG;
  }

  try {
    const raw = fs.readFileSync(IM_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.providers !== 'object') {
      console.warn('[im] im.json has invalid structure, using empty config');
      cachedConfig = EMPTY_CONFIG;
    } else {
      cachedConfig = parsed as IMConfig;
    }
    cachedMtime = mtime;
    return cachedConfig;
  } catch (err) {
    console.warn('[im] Failed to parse im.json:', err instanceof Error ? err.message : err);
    cachedConfig = EMPTY_CONFIG;
    cachedMtime = 0;
    return EMPTY_CONFIG;
  }
}

/** Write IM config atomically. Sets 0o600 on non-Windows. */
export function writeIMConfig(config: IMConfig): void {
  fs.mkdirSync(IM_CONFIG_DIR, { recursive: true });
  const content = JSON.stringify(config, null, 2) + '\n';
  const tmpPath = IM_CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, IM_CONFIG_PATH);
  if (process.platform !== 'win32') {
    try { fs.chmodSync(IM_CONFIG_PATH, 0o600); } catch { /* best effort */ }
  }
  cachedConfig = config;
  cachedMtime = getFileMtime();
}

/** Check if any IM platform has credentials configured. */
export function hasAnyIMConfig(): boolean {
  const config = readIMConfig();
  return Object.keys(config.providers).length > 0;
}

/** Get config mtime for hot-reload detection by executor. */
export function getIMConfigMtime(): number {
  return getFileMtime();
}

/** Get list of platforms that have credentials configured. */
export function getConfiguredPlatforms(): IMPlatform[] {
  const config = readIMConfig();
  return Object.keys(config.providers).filter(
    (key) => validatePlatformConfig(key as IMPlatform, config.providers[key as keyof typeof config.providers]).valid,
  ) as IMPlatform[];
}

/** Get config for a specific platform. */
export function getPlatformConfig(platform: 'telegram'): TelegramConfig | undefined;
export function getPlatformConfig(platform: 'feishu'): FeishuConfig | undefined;
export function getPlatformConfig(platform: 'discord'): DiscordConfig | undefined;
export function getPlatformConfig(platform: 'slack'): SlackConfig | undefined;
export function getPlatformConfig(platform: 'wecom'): WeComConfig | undefined;
export function getPlatformConfig(platform: 'dingtalk'): DingTalkConfig | undefined;
export function getPlatformConfig(platform: 'wechat'): WeChatConfig | undefined;
export function getPlatformConfig(platform: 'qq'): QQConfig | undefined;
export function getPlatformConfig(platform: IMPlatform): unknown {
  const config = readIMConfig();
  return config.providers[platform];
}

/** Validate that required fields are present for a platform config. */
export function validatePlatformConfig(
  platform: IMPlatform,
  config: unknown,
): { valid: boolean; missing?: string[] } {
  if (!config || typeof config !== 'object') return { valid: false, missing: ['(no config)'] };
  const c = config as Record<string, unknown>;

  switch (platform) {
    case 'telegram':
      return checkFields(c, ['bot_token'], (f) => f === 'bot_token' ? typeof c.bot_token === 'string' && c.bot_token.includes(':') : true);
    case 'feishu':
      return checkFields(c, ['app_id', 'app_secret']);
    case 'discord':
      return checkFields(c, ['bot_token']);
    case 'slack':
      return checkFields(c, ['bot_token'], (f) => f === 'bot_token' ? typeof c.bot_token === 'string' && c.bot_token.startsWith('xoxb-') : true);
    case 'wecom':
      // Either webhook_key OR (corp_id + corp_secret)
      if (typeof c.webhook_key === 'string' && c.webhook_key.trim()) return { valid: true };
      return checkFields(c, ['corp_id', 'corp_secret']);
    case 'dingtalk':
      // Either (client_id + client_secret) OR webhook_url
      if (typeof c.webhook_url === 'string' && /^https:\/\//.test(c.webhook_url)) return { valid: true };
      return checkFields(c, ['client_id', 'client_secret']);
    case 'wechat':
      return checkFields(c, ['bot_token']);
    case 'qq':
      return checkFields(c, ['app_id', 'app_secret']);
    default:
      return { valid: false, missing: ['(unknown platform)'] };
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function checkFields(
  config: Record<string, unknown>,
  required: string[],
  extraCheck?: (field: string) => boolean,
): { valid: boolean; missing?: string[] } {
  const missing = required.filter((f) => {
    if (typeof config[f] !== 'string' || !config[f]) return true;
    if (extraCheck && !extraCheck(f)) return true;
    return false;
  });
  return missing.length === 0 ? { valid: true } : { valid: false, missing };
}

/** For testing: reset the internal cache. */
export function _resetConfigCache(): void {
  cachedConfig = EMPTY_CONFIG;
  cachedMtime = 0;
}
