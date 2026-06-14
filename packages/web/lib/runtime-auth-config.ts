import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveWebSessionSecret } from './auth-session';

export interface RuntimeAuthConfig {
  authToken?: string;
  webPassword?: string;
  webSessionSecret: string;
}

interface PersistedAuthConfig {
  authToken?: string;
  webPassword?: string;
  webSessionSecret?: string;
}

let cachedPath = '';
let cachedMtimeMs = -1;
let cachedSize = -1;
let cachedConfig: PersistedAuthConfig = {};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mindosConfigPath(): string {
  return path.join(os.homedir(), '.mindos', 'config.json');
}

function readPersistedAuthConfig(): PersistedAuthConfig {
  const configPath = mindosConfigPath();
  try {
    const stat = fs.statSync(configPath);
    if (configPath === cachedPath && stat.mtimeMs === cachedMtimeMs && stat.size === cachedSize) {
      return cachedConfig;
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    cachedPath = configPath;
    cachedMtimeMs = stat.mtimeMs;
    cachedSize = stat.size;
    cachedConfig = {
      authToken: nonEmptyString(parsed.authToken),
      webPassword: nonEmptyString(parsed.webPassword),
      webSessionSecret: nonEmptyString(parsed.webSessionSecret),
    };
    return cachedConfig;
  } catch {
    cachedPath = configPath;
    cachedMtimeMs = -1;
    cachedSize = -1;
    cachedConfig = {};
    return cachedConfig;
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
  };
}

export function resetRuntimeAuthConfigCacheForTests(): void {
  cachedPath = '';
  cachedMtimeMs = -1;
  cachedSize = -1;
  cachedConfig = {};
}
