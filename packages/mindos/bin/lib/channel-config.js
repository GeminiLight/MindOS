/**
 * Channel Configuration - Pure JavaScript
 * Owns all read/write of ~/.mindos/im.json
 * No TypeScript imports (CLI bootstrap safety)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CHANNEL_CREDENTIAL_SETS, CHANNEL_FIELD_PATTERNS } from './channel-constants.js';

const IM_CONFIG_DIR = path.join(os.homedir(), '.mindos');
const IM_CONFIG_PATH = path.join(IM_CONFIG_DIR, 'im.json');

const createEmptyConfig = () => ({ providers: {} });

export function readChannelConfig() {
  if (!fs.existsSync(IM_CONFIG_PATH)) {
    return createEmptyConfig();
  }

  try {
    const raw = fs.readFileSync(IM_CONFIG_PATH, 'utf-8');
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
  } else {
    console.warn('[channel] Windows does not support chmod 0600 here. Protect ~/.mindos/im.json with your account permissions.');
  }

  const writtenRaw = fs.readFileSync(IM_CONFIG_PATH, 'utf-8');
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

  const c = config;
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

export function _resetConfigCache() {
  // no-op: retained for compatibility with earlier tests
}
