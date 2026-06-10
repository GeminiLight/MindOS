/**
 * Channel Configuration - Pure JavaScript
 * Owns all read/write of ~/.mindos/im.json
 * No TypeScript imports (CLI bootstrap safety)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CHANNEL_CREDENTIAL_SETS, CHANNEL_FIELD_PATTERNS } from './channel-constants.js';

const IM_CONFIG_PATH = path.join(os.homedir(), '.mindos', 'im.json');

const createEmptyConfig = () => ({ providers: {} });

function getIMConfigPath() {
  return process.env.MINDOS_IM_CONFIG_PATH || IM_CONFIG_PATH;
}

export function readChannelConfig() {
  const configPath = getIMConfigPath();
  if (!fs.existsSync(configPath)) {
    return createEmptyConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.providers !== 'object') {
      console.warn('[channel] im.json has invalid structure, using empty config');
      return createEmptyConfig();
    }
    return parsed;
  } catch (err) {
    console.warn('[channel] Failed to parse im.json:', err instanceof Error ? err.message : err);
    return createEmptyConfig();
  }
}

export function writeChannelConfig(config, options = {}) {
  const expectedMtime = options.expectedMtime ?? null;
  const currentMtime = getChannelConfigMtime();

  if (expectedMtime !== null && currentMtime !== expectedMtime) {
    throw new Error('Configuration changed on disk. Retry your command.');
  }

  const configPath = getIMConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const content = JSON.stringify(config, null, 2) + '\n';
  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, configPath);

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // best effort
    }
  } else {
    console.warn('[channel] Windows does not support chmod 0600 here. Protect ~/.mindos/im.json with your account permissions.');
  }

  const writtenRaw = fs.readFileSync(configPath, 'utf-8');
  const writtenConfig = JSON.parse(writtenRaw);
  if (JSON.stringify(writtenConfig) !== JSON.stringify(config)) {
    throw new Error('Config write validation failed. Retry your command.');
  }
}

export function validateChannelConfig(platform, config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, missing: ['(no config)'] };
  }

  const credentialSets = CHANNEL_CREDENTIAL_SETS[platform];
  if (!credentialSets) {
    return { valid: false, missing: ['(unknown platform)'] };
  }

  const c = normalizeChannelConfig(platform, config);
  const platformPatterns = CHANNEL_FIELD_PATTERNS[platform] || {};
  let bestMissing = credentialSets[0];

  for (const fieldSet of credentialSets) {
    const missing = fieldSet.filter((field) => {
      const val = c[field];
      if (typeof val !== 'string' || !val.trim()) return true;
      const pattern = platformPatterns[field];
      if (pattern && !pattern.test(val)) return true;
      return false;
    });

    if (missing.length === 0) {
      return { valid: true };
    }

    if (missing.length < bestMissing.length) {
      bestMissing = missing;
    }
  }

  return { valid: false, missing: bestMissing };
}

export function normalizeChannelConfig(platform, config) {
  if (!config || typeof config !== 'object') return {};
  const normalized = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    normalized[key] = normalizeChannelField(platform, key, trimmed);
  }
  return normalized;
}

function normalizeChannelField(platform, key, value) {
  if (platform === 'wecom' && key === 'webhook_key') {
    return extractQueryParam(value, 'key') || value;
  }
  return value;
}

function extractQueryParam(value, key) {
  try {
    const parsed = new URL(value);
    const found = parsed.searchParams.get(key)?.trim();
    if (found) return found;
  } catch {
    // Not a URL. Fall through to regex extraction.
  }

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = value.match(new RegExp(`[?&]${escaped}=([^&#\\s]+)`));
  return match ? decodeURIComponent(match[1]).trim() : undefined;
}

export function getConfiguredPlatforms() {
  const config = readChannelConfig();
  return Object.keys(config.providers || {}).filter((platform) => {
    const validation = validateChannelConfig(platform, config.providers[platform]);
    return validation.valid;
  });
}

export function getChannelConfigMtime() {
  try {
    return fs.statSync(getIMConfigPath()).mtimeMs;
  } catch {
    return 0;
  }
}

export function _resetConfigCache() {
  // no-op: retained for compatibility with earlier tests
}
