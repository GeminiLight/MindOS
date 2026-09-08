import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveWebSessionSecret } from './auth-session';

export interface RuntimeAuthConfig {
  authToken?: string;
  webPassword?: string;
  webSessionSecret: string;
  /**
   * True when ~/.mindos/config.json exists but could not be read or parsed.
   * Persisted credentials are then unknown, so callers must fail closed
   * (treat the instance as protected) instead of assuming "no auth configured".
   * Explicit AUTH_TOKEN / WEB_PASSWORD environment values still apply.
   */
  configUnreadable: boolean;
}

interface PersistedAuthConfig {
  authToken?: string;
  webPassword?: string;
  webSessionSecret?: string;
  configUnreadable: boolean;
}

const NO_CONFIG: PersistedAuthConfig = { configUnreadable: false };
const UNREADABLE_CONFIG: PersistedAuthConfig = { configUnreadable: true };

let cachedPath = '';
let cachedMtimeMs = -1;
let cachedSize = -1;
let cachedConfig: PersistedAuthConfig = NO_CONFIG;
let warnedUnreadableKey = '';

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mindosConfigPath(): string {
  return path.join(os.homedir(), '.mindos', 'config.json');
}

function remember(configPath: string, mtimeMs: number, size: number, config: PersistedAuthConfig): PersistedAuthConfig {
  cachedPath = configPath;
  cachedMtimeMs = mtimeMs;
  cachedSize = size;
  cachedConfig = config;
  return config;
}

function markUnreadable(configPath: string, mtimeMs: number, size: number, error: unknown): PersistedAuthConfig {
  // Log once per on-disk version so a broken file does not spam every request,
  // but a later (still broken) rewrite is reported again.
  const key = `${configPath}:${mtimeMs}:${size}`;
  if (key !== warnedUnreadableKey) {
    warnedUnreadableKey = key;
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[runtime-auth-config] ${configPath} (config.json) is unreadable; Web auth fails closed until it is repaired: ${detail}`);
  }
  return remember(configPath, mtimeMs, size, UNREADABLE_CONFIG);
}

function readPersistedAuthConfig(): PersistedAuthConfig {
  const configPath = mindosConfigPath();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Genuinely absent: first run / no persisted credentials.
      return remember(configPath, -1, -1, NO_CONFIG);
    }
    return markUnreadable(configPath, -1, -1, error);
  }

  if (configPath === cachedPath && stat.mtimeMs === cachedMtimeMs && stat.size === cachedSize) {
    return cachedConfig;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config.json root must be a JSON object');
    }
    return remember(configPath, stat.mtimeMs, stat.size, {
      authToken: nonEmptyString(parsed.authToken),
      webPassword: nonEmptyString(parsed.webPassword),
      webSessionSecret: nonEmptyString(parsed.webSessionSecret),
      configUnreadable: false,
    });
  } catch (error) {
    // A truncated or half-written file must not degrade into "no auth
    // configured" (fail-open); cache the sentinel keyed to this on-disk
    // version so a repaired file is picked up on the next request.
    return markUnreadable(configPath, stat.mtimeMs, stat.size, error);
  }
}

export function readRuntimeAuthConfig(): RuntimeAuthConfig {
  const persisted = readPersistedAuthConfig();
  const authToken = nonEmptyString(process.env.AUTH_TOKEN) ?? persisted.authToken;
  const webPassword = nonEmptyString(process.env.WEB_PASSWORD) ?? persisted.webPassword;
  const configuredSessionSecret = nonEmptyString(process.env.WEB_SESSION_SECRET) ?? persisted.webSessionSecret;

  return {
    authToken,
    webPassword,
    webSessionSecret: webPassword ? resolveWebSessionSecret(webPassword, configuredSessionSecret) : '',
    configUnreadable: persisted.configUnreadable,
  };
}

export function resetRuntimeAuthConfigCacheForTests(): void {
  cachedPath = '';
  cachedMtimeMs = -1;
  cachedSize = -1;
  cachedConfig = NO_CONFIG;
  warnedUnreadableKey = '';
}
