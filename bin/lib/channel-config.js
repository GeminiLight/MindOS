/**
 * Channel Configuration - Pure JavaScript
 * Owns all read/write of ~/.mindos/im.json
 * No TypeScript imports (CLI bootstrap safety)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CHANNEL_FIELD_PATTERNS, CHANNEL_REQUIRED_FIELDS } from './channel-constants.js';

const IM_CONFIG_DIR = path.join(os.homedir(), '.mindos');
const IM_CONFIG_PATH = path.join(IM_CONFIG_DIR, 'im.json');

const EMPTY_CONFIG = { providers: {} };

let cachedConfig = EMPTY_CONFIG;
let cachedMtime = 0;

/**
 * Read IM config from ~/.mindos/im.json
 * Implements mtime-based caching (same as app/lib/im/config.ts)
 * @returns {Record<string, any>}
 */
export function readChannelConfig() {
  let mtime = 0;
  try {
    mtime = fs.statSync(IM_CONFIG_PATH).mtimeMs;
  } catch {
    return EMPTY_CONFIG;
  }

  if (mtime > 0 && mtime === cachedMtime) {
    return cachedConfig;
  }

  if (!fs.existsSync(IM_CONFIG_PATH)) {
    cachedConfig = EMPTY_CONFIG;
    cachedMtime = 0;
    return EMPTY_CONFIG;
  }

  try {
    const raw = fs.readFileSync(IM_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.providers !== 'object') {
      console.warn('[channel] im.json has invalid structure, using empty config');
      cachedConfig = EMPTY_CONFIG;
    } else {
      cachedConfig = parsed;
    }
    cachedMtime = mtime;
    return cachedConfig;
  } catch (err) {
    console.warn('[channel] Failed to parse im.json:', err instanceof Error ? err.message : err);
    cachedConfig = EMPTY_CONFIG;
    cachedMtime = 0;
    return EMPTY_CONFIG;
  }
}

/**
 * Write IM config atomically
 * Sets 0o600 permissions on Unix
 * @param {Record<string, any>} config
 */
export function writeChannelConfig(config, options = {}) {
  const expectedMtime = options.expectedMtime ?? null;
  const currentMtime = getChannelConfigMtime();

  if (expectedMtime !== null && currentMtime !== expectedMtime) {
    throw new Error('Configuration changed on disk. Retry your command.');
  }

  fs.mkdirSync(IM_CONFIG_DIR, { recursive: true });
  const content = JSON.stringify(config, null, 2) + '\n';
  const tmpPath = IM_CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, IM_CONFIG_PATH);
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(IM_CONFIG_PATH, 0o600);
    } catch {
      // best effort
    }
  }

  const writtenRaw = fs.readFileSync(IM_CONFIG_PATH, 'utf-8');
  const writtenConfig = JSON.parse(writtenRaw);
  if (JSON.stringify(writtenConfig) !== JSON.stringify(config)) {
    throw new Error('Config write validation failed. Retry your command.');
  }

  cachedConfig = config;
  cachedMtime = fs.statSync(IM_CONFIG_PATH).mtimeMs;
}

/**
 * Validate platform config (per-platform validation rules)
 * Pure JavaScript implementation (mirrors app/lib/im/config.ts)
 * @param {string} platform
 * @param {Record<string, any>} config
 * @returns {{valid: boolean, missing?: string[]}}
 */
export function validateChannelConfig(platform, config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, missing: ['(no config)'] };
  }

  const c = config;

  const required = CHANNEL_REQUIRED_FIELDS[platform];

  if (!required) {
    return { valid: false, missing: ['(unknown platform)'] };
  }

  if (platform === 'wecom') {
    if (typeof c.webhook_key === 'string' && c.webhook_key) return { valid: true };
    const missing = ['corp_id', 'corp_secret'].filter((f) => typeof c[f] !== 'string' || !String(c[f]).trim());
    return missing.length === 0 ? { valid: true } : { valid: false, missing };
  }

  if (platform === 'dingtalk') {
    if (typeof c.webhook_url === 'string' && c.webhook_url) return { valid: true };
    const missing = ['client_id', 'client_secret'].filter((f) => typeof c[f] !== 'string' || !String(c[f]).trim());
    return missing.length === 0 ? { valid: true } : { valid: false, missing };
  }

  const platformPatterns = CHANNEL_FIELD_PATTERNS[platform] || {};
  const missing = required.filter((f) => {
    const val = c[f];
    if (typeof val !== 'string' || !val.trim()) return true;
    const pattern = platformPatterns[f];
    if (pattern && !pattern.test(val)) return true;
    return false;
  });

  return missing.length === 0 ? { valid: true } : { valid: false, missing };
}

/**
 * Get list of configured platforms
 * @returns {string[]}
 */
export function getConfiguredPlatforms() {
  const config = readChannelConfig();
  return Object.keys(config.providers || {}).filter((platform) => {
    const validation = validateChannelConfig(platform, config.providers[platform]);
    return validation.valid;
  });
}

export function getChannelConfigMtime() {
  try {
    return fs.statSync(IM_CONFIG_PATH).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Reset config cache (for testing)
 */
export function _resetConfigCache() {
  cachedConfig = EMPTY_CONFIG;
  cachedMtime = 0;
}
