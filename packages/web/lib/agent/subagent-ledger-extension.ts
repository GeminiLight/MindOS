/**
 * MindOS subagent ledger extension — web host entry (Wave 4,
 * spec-agent-core-consolidation).
 *
 * The ledger wrapping, orchestration routing, and async-completion logic
 * live in the core package (@geminilight/mindos/agent/subagent/subagent-ledger-extension).
 * This file stays a real pi extension entry: the pi DefaultResourceLoader
 * imports it by file path (see mindos-pi-runtime-host.ts), so it must keep a
 * default export. It owns the one host-specific concern — loading the
 * upstream pi-subagents extension out of this web app's node_modules via
 * jiti (the upstream package ships TypeScript sources, not compiled JS).
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti/static';
import {
  createMindosSubagentLedgerExtension,
  type SubagentChildRuntimeInput,
  type RegisterSubagentExtension,
} from '@geminilight/mindos/agent/subagent/subagent-ledger-extension';
import { effectiveAiConfig } from '../settings';
import { getDefaultApi, getDefaultBaseUrl, getPreset, toPiProvider, type ProviderId } from './providers';

export {
  finalizeSubagentAsyncRunFromEvent,
  wrapSubagentToolForLedger,
  type ToolWithRuntimeContext,
} from '@geminilight/mindos/agent/subagent/subagent-ledger-extension';

export const MINDOS_PI_CHILD_API_KEY_ENV = 'MINDOS_PI_CHILD_API_KEY';
export const PI_CODING_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';

type JsonRecord = Record<string, unknown>;

export interface MindosPiChildModelConfig {
  provider: ProviderId;
  modelName: string;
  apiKey: string;
  baseUrl: string;
  model: JsonRecord;
}

interface MindosPiChildRuntimeConfig {
  agentDir: string;
  env: Record<string, string>;
  modelsJson: JsonRecord;
  settingsJson: JsonRecord;
}

let activeEnvOverlay: {
  depth: number;
  env: Record<string, string>;
  previous: Record<string, string | undefined>;
} | null = null;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactRecord<T extends JsonRecord>(record: T): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== ''),
  );
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') {
    const primitive = JSON.stringify(value);
    return primitive === undefined ? 'undefined' : primitive;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

function runtimeDirForConfig(config: JsonRecord): string {
  const hash = crypto
    .createHash('sha256')
    .update(stableJson(config))
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `mindos-pi-child-runtime-${hash}`);
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function shallowEqualStringRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function resolveCurrentMindosPiChildModelConfig(): MindosPiChildModelConfig {
  const saved = effectiveAiConfig();
  const preset = getPreset(saved.provider);
  const piProvider = toPiProvider(saved.provider);
  const configuredBaseUrl = normalizeBaseUrl(saved.baseUrl || preset.fixedBaseUrl || getDefaultBaseUrl(saved.provider));
  const defaultApi = getDefaultApi(saved.provider);
  const api = configuredBaseUrl && defaultApi === 'openai-responses' ? 'openai-completions' : defaultApi;
  const compat = configuredBaseUrl || preset.fixedBaseUrl
    ? {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        supportsStrictMode: false,
      }
    : undefined;

  return {
    provider: saved.provider,
    modelName: saved.model,
    apiKey: saved.apiKey,
    baseUrl: configuredBaseUrl,
    model: compactRecord({
      id: saved.model,
      name: saved.model,
      provider: piProvider,
      api,
      baseUrl: configuredBaseUrl,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
      compat,
    }),
  };
}

function enterProcessEnv(env: Record<string, string>): () => void {
  if (activeEnvOverlay && shallowEqualStringRecord(activeEnvOverlay.env, env)) {
    activeEnvOverlay.depth += 1;
    return () => {
      if (!activeEnvOverlay) return;
      activeEnvOverlay.depth -= 1;
      if (activeEnvOverlay.depth > 0) return;
      for (const [key, value] of Object.entries(activeEnvOverlay.previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      activeEnvOverlay = null;
    };
  }

  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  activeEnvOverlay = { depth: 1, env, previous };

  return () => {
    if (!activeEnvOverlay) return;
    for (const [key, value] of Object.entries(activeEnvOverlay.previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    activeEnvOverlay = null;
  };
}

export function buildMindosPiChildRuntimeConfig(
  config: MindosPiChildModelConfig = resolveCurrentMindosPiChildModelConfig(),
): MindosPiChildRuntimeConfig | null {
  if (!config.apiKey) return null;

  const model = config.model as JsonRecord;
  const piProvider = typeof model.provider === 'string' && model.provider
    ? model.provider
    : toPiProvider(config.provider as ProviderId);
  const modelId = typeof model.id === 'string' && model.id ? model.id : config.modelName;
  const modelName = typeof model.name === 'string' && model.name ? model.name : modelId;
  const baseUrl = typeof model.baseUrl === 'string' && model.baseUrl ? model.baseUrl : config.baseUrl;
  const api = typeof model.api === 'string' && model.api ? model.api : undefined;

  const modelEntry = compactRecord({
    id: modelId,
    name: modelName,
    api,
    baseUrl,
    reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
    input: Array.isArray(model.input) ? model.input : ['text'],
    cost: isRecord(model.cost) ? model.cost : undefined,
    contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : 128_000,
    maxTokens: typeof model.maxTokens === 'number' ? model.maxTokens : 16_384,
    compat: isRecord(model.compat) ? model.compat : undefined,
  });

  const providerConfig = compactRecord({
    apiKey: `$${MINDOS_PI_CHILD_API_KEY_ENV}`,
    baseUrl,
    api,
    models: [modelEntry],
  });

  const modelsJson = {
    providers: {
      [piProvider]: providerConfig,
    },
  };
  const settingsJson = {
    defaultProvider: piProvider,
    defaultModel: modelId,
  };
  const agentDir = runtimeDirForConfig({ provider: piProvider, modelId, baseUrl, api });

  return {
    agentDir,
    env: {
      [PI_CODING_AGENT_DIR_ENV]: agentDir,
      [MINDOS_PI_CHILD_API_KEY_ENV]: config.apiKey,
    },
    modelsJson,
    settingsJson,
  };
}

function ensureMindosPiChildRuntimeDir(config: MindosPiChildRuntimeConfig): void {
  fs.mkdirSync(config.agentDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(config.agentDir, 0o700);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod.
  }
  writeJsonFile(path.join(config.agentDir, 'models.json'), config.modelsJson);
  writeJsonFile(path.join(config.agentDir, 'settings.json'), config.settingsJson);
}

export async function withMindosSubagentChildRuntime<T>(
  _input: SubagentChildRuntimeInput,
  run: () => Promise<T>,
): Promise<T> {
  const runtimeConfig = buildMindosPiChildRuntimeConfig();
  if (!runtimeConfig) return run();

  ensureMindosPiChildRuntimeDir(runtimeConfig);
  const restoreEnv = enterProcessEnv(runtimeConfig.env);
  try {
    return await run();
  } finally {
    restoreEnv();
  }
}

async function loadUpstreamSubagentExtension(): Promise<RegisterSubagentExtension> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const webAppDir = path.resolve(currentDir, '..', '..');
  const upstreamPath = path.join(webAppDir, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts');
  const upstreamRealPath = fs.realpathSync(upstreamPath);
  const jiti = createJiti(upstreamRealPath, {
    moduleCache: false,
    tryNative: false,
  });
  const register = await jiti.import(upstreamRealPath, { default: true });
  if (typeof register !== 'function') {
    throw new Error('pi-subagents did not export an extension factory.');
  }
  return register as RegisterSubagentExtension;
}

const extension = createMindosSubagentLedgerExtension({
  loadUpstreamSubagentExtension,
  withSubagentChildRuntime: withMindosSubagentChildRuntime,
});

export default function mindosSubagentLedgerExtension(pi: ExtensionAPI): Promise<void> {
  return extension(pi);
}
