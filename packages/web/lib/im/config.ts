// ─── IM Configuration Manager ─────────────────────────────────────────────────
// Reads/writes ~/.mindos/im.json with mtime-based caching and atomic writes.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { validateChannelCredentials } from '@geminilight/mindos/server';
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
  const tmpPath = `${IM_CONFIG_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
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
  return validateChannelCredentials(platform, normalizePlatformConfig(platform, config));
}

export function normalizePlatformConfig(
  platform: IMPlatform,
  config: unknown,
): Record<string, string> {
  if (!config || typeof config !== 'object') return {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    normalized[key] = normalizePlatformField(platform, key, trimmed);
  }
  return normalized;
}

function normalizePlatformField(platform: IMPlatform, key: string, value: string): string {
  if (platform === 'wecom' && key === 'webhook_key') {
    return extractQueryParam(value, 'key') || value;
  }
  return value;
}

function extractQueryParam(value: string, key: string): string | undefined {
  try {
    const parsed = new URL(value);
    const found = parsed.searchParams.get(key)?.trim();
    if (found) return found;
  } catch {
    // Not a URL. Fall through to regex extraction for pasted webhook snippets.
  }

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(new RegExp(`[?&]${escaped}=([^&#\\s]+)`));
  const captured = match?.[1];
  return captured ? decodeURIComponent(captured).trim() : undefined;
}

/** For testing: reset the internal cache. */
export function _resetConfigCache(): void {
  cachedConfig = EMPTY_CONFIG;
  cachedMtime = 0;
}
