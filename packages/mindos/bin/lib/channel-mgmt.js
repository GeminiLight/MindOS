/**
 * Channel Management - Business Logic
 * Handles: list, add, remove, verify operations for IM platforms.
 */

import {
  readChannelConfig,
  writeChannelConfig,
  validateChannelConfig,
  getChannelConfigMtime,
} from './channel-config.js';
import { CHANNEL_PLATFORMS, CHANNEL_PLATFORM_EMOJIS } from './channel-constants.js';

const DEFAULT_WEB_PORT = process.env.MINDOS_WEB_PORT || '3456';
const VERIFY_TIMEOUT_MS = 10_000;

export async function channelList() {
  const config = readChannelConfig();
  const platforms = CHANNEL_PLATFORMS.map((platform) => {
    const providerConfig = config.providers?.[platform];
    if (!providerConfig) {
      return { platform, status: 'not_configured' };
    }

    const validation = validateChannelConfig(platform, providerConfig);
    if (!validation.valid) {
      return {
        platform,
        status: 'incomplete',
        missingFields: validation.missing,
      };
    }

    return {
      platform,
      status: 'configured',
      botName: providerConfig._botName,
      botId: providerConfig._botId,
      lastVerified: providerConfig._lastVerified,
    };
  });

  return { platforms };
}

export async function channelAdd(platform, credentials, options = {}) {
  if (!CHANNEL_PLATFORMS.includes(platform)) {
    return unsupportedPlatform(platform);
  }

  const validation = validateChannelConfig(platform, credentials);
  if (!validation.valid) {
    return {
      ok: false,
      message: `Invalid ${platform} configuration`,
      error: `Missing or invalid fields: ${validation.missing?.join(', ') || 'unknown'}`,
    };
  }

  let verifyResult = { ok: true, botName: undefined, botId: undefined };
  if (!options.skipVerify) {
    verifyResult = await verifyCredentialsRemotely(platform, credentials);
    if (!verifyResult.ok) {
      return {
      ok: false,
      message: `Failed to verify ${platform} credentials`,
      error: `${verifyResult.error}${options.skipVerify ? '' : ' Use --skip-verify to save format-valid credentials without a remote check.'}`,
    };
    }
  }

  try {
    const config = readChannelConfig();
    const expectedMtime = getChannelConfigMtime();
    config.providers ??= {};
    config.providers[platform] = {
      ...credentials,
      _botName: verifyResult.botName,
      _botId: verifyResult.botId,
      _lastVerified: new Date().toISOString(),
    };
    writeChannelConfig(config, { expectedMtime });

    return {
      ok: true,
      message: `${platform} configuration saved successfully${options.skipVerify ? ' (verification skipped)' : ''}`,
      details: {
        botName: verifyResult.botName,
        botId: verifyResult.botId,
        verified: !options.skipVerify,
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to save ${platform} configuration`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function channelRemove(platform) {
  const config = readChannelConfig();
  if (!config.providers || !config.providers[platform]) {
    return {
      ok: false,
      message: `Platform not configured: ${platform}`,
      error: `Run 'mindos channel add ${platform}' to configure it`,
    };
  }

  try {
    const expectedMtime = getChannelConfigMtime();
    delete config.providers[platform];
    writeChannelConfig(config, { expectedMtime });
    return {
      ok: true,
      message: `${platform} configuration removed`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Failed to remove ${platform} configuration`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function channelVerify(platform, options = {}) {
  if (!CHANNEL_PLATFORMS.includes(platform)) {
    return { ok: false, valid: false, message: `Invalid platform: ${platform}`, error: 'Unsupported platform' };
  }

  const config = readChannelConfig();
  if (!config.providers || !config.providers[platform]) {
    return {
      ok: false,
      message: `Platform not configured: ${platform}`,
      valid: false,
      error: `Run 'mindos channel add ${platform}' to configure it`,
    };
  }

  const credentials = config.providers[platform];
  const validation = validateChannelConfig(platform, credentials);
  if (!validation.valid) {
    return {
      ok: false,
      message: `${platform} configuration is incomplete`,
      valid: false,
      error: `Missing or invalid fields: ${validation.missing?.join(', ') || 'unknown'}`,
    };
  }

  if (options.skipVerify) {
    return {
      ok: true,
      valid: true,
      message: `${platform} configuration format is valid`,
      details: {
        botName: credentials._botName,
        botId: credentials._botId,
        status: 'Format valid only',
      },
    };
  }

  const result = await verifyCredentialsRemotely(platform, credentials);
  if (!result.ok) {
    return {
      ok: false,
      valid: false,
      message: `Failed to verify ${platform} configuration`,
      error: `${result.error} Use --skip-verify to run format-only validation.`,
    };
  }

  return {
    ok: true,
    valid: true,
    message: `${platform} credentials verified successfully`,
    details: {
      botName: result.botName,
      botId: result.botId,
      status: 'Verified',
    },
  };
}

export function formatPlatformStatus(status) {
  switch (status) {
    case 'configured':
      return '✔';
    case 'incomplete':
      return '✘';
    case 'not_configured':
      return '○';
    default:
      return '?';
  }
}

export function maskToken(token) {
  if (!token || token.length <= 6) return '****';
  return token.slice(0, 6) + '****';
}

export function getPlatformEmoji(platform) {
  return CHANNEL_PLATFORM_EMOJIS[platform] || '📱';
}

function unsupportedPlatform(platform) {
  return {
    ok: false,
    message: `Unknown platform: ${platform}`,
    error: `Supported platforms: ${CHANNEL_PLATFORMS.join(', ')}`,
  };
}

async function verifyCredentialsRemotely(platform, credentials) {
  const url = buildVerifyUrl();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform, credentials }),
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  }).catch((err) => {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.name === 'TimeoutError') {
      return {
        ok: false,
        status: 0,
        json: async () => ({ error: `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000}s. Is MindOS web running on ${url}?` }),
      };
    }
    return {
      ok: false,
      status: 0,
      json: async () => ({ error: `${error.message}. Is MindOS web running on ${url}?` }),
    };
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: payload.error || `Verification request failed (${response.status}). Is MindOS web running on ${url}?`,
    };
  }

  return {
    ok: true,
    botName: payload.botName,
    botId: payload.botId,
  };
}

function buildVerifyUrl() {
  const base = process.env.MINDOS_URL || `http://localhost:${DEFAULT_WEB_PORT}`;
  return `${base.replace(/\/$/, '')}/api/channels/verify`;
}
