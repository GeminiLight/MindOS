import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { json, type MindosServerResponse } from '../response.js';
import type { ImConfig } from './im-config.js';

export type FeishuLongConnectionStatus = {
  running: boolean;
  startedAt?: string;
  lastError?: string;
};

export type ImFeishuLongConnectionServices = {
  configPath?: string;
  readConfig?(): ImConfig;
  writeConfig?(config: ImConfig): void;
  getFeishuWSClientStatus?(): FeishuLongConnectionStatus;
  startFeishuWSClient?(config: Record<string, any>): Promise<void>;
  stopFeishuWSClient?(): void;
};

const DEFAULT_IM_CONFIG_PATH = join(homedir(), '.mindos', 'im.json');

export function handleImFeishuLongConnectionGet(
  services: ImFeishuLongConnectionServices = {},
): MindosServerResponse<{ ok: true } & FeishuLongConnectionStatus> {
  return json({ ok: true, ...getStatus(services) });
}

export async function handleImFeishuLongConnectionPost(
  services: ImFeishuLongConnectionServices = {},
): Promise<MindosServerResponse<({ ok: true } & FeishuLongConnectionStatus) | ({ ok: false; error: string } & Partial<FeishuLongConnectionStatus>)>> {
  try {
    const config = readConfig(services);
    const feishu = config.providers?.feishu;
    if (!feishu || typeof feishu !== 'object') {
      return json({ ok: false, error: 'Feishu is not configured. Save App ID and App Secret first.' }, { status: 422 });
    }

    feishu.conversation = {
      ...(feishu.conversation ?? {}),
      enabled: true,
      transport: 'long_connection',
    };
    config.providers.feishu = feishu;
    writeConfig(config, services);

    const start = services.startFeishuWSClient ?? defaultStartFeishuWSClient;
    await start(feishu as Record<string, any>);
    return json({ ok: true, ...getStatus(services) });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to start',
      ...getStatus(services),
    }, { status: 500 });
  }
}

export function handleImFeishuLongConnectionDelete(
  services: ImFeishuLongConnectionServices = {},
): MindosServerResponse<{ ok: true } & FeishuLongConnectionStatus> {
  const stop = services.stopFeishuWSClient ?? defaultStopFeishuWSClient;
  stop();

  try {
    const config = readConfig(services);
    const feishu = config.providers?.feishu;
    if (feishu && typeof feishu === 'object' && feishu.conversation && typeof feishu.conversation === 'object') {
      feishu.conversation.transport = 'webhook';
      config.providers.feishu = feishu;
      writeConfig(config, services);
    }
  } catch {
    // Persisting the preferred transport is best-effort; stopping the runtime is the primary action.
  }

  return json({ ok: true, ...getStatus(services) });
}

function getStatus(services: ImFeishuLongConnectionServices): FeishuLongConnectionStatus {
  const status = services.getFeishuWSClientStatus ?? defaultGetFeishuWSClientStatus;
  return status();
}

async function defaultStartFeishuWSClient(): Promise<void> {
  throw new Error('Feishu long connection starter is not configured');
}

function defaultStopFeishuWSClient(): void {
}

function defaultGetFeishuWSClientStatus(): FeishuLongConnectionStatus {
  return { running: false };
}

function readConfig(services: ImFeishuLongConnectionServices): ImConfig {
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

function writeConfig(config: ImConfig, services: ImFeishuLongConnectionServices): void {
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
