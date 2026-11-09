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
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createJiti } from 'jiti/static';
import {
  createMindosSubagentLedgerExtension,
  type SubagentChildRuntimeInput,
  type RegisterSubagentExtension,
} from '@geminilight/mindos/agent/subagent/subagent-ledger-extension';
import {
  findBuiltinWebRuntimePackagePath,
  resolveBuiltinWebRuntimePackagePath,
} from './builtin-extension-runtime';
import { resolveUpstreamSubagentEntry } from './subagent-extension-entry';
import { effectiveAiConfig } from '../settings';
import { getDefaultApi, getDefaultBaseUrl, getPreset, toPiProvider, type ProviderId } from './providers';

export {
  finalizeSubagentAsyncRunFromEvent,
  wrapSubagentToolForLedger,
  type ToolWithRuntimeContext,
} from '@geminilight/mindos/agent/subagent/subagent-ledger-extension';

export const MINDOS_PI_CHILD_API_KEY_ENV = 'MINDOS_PI_CHILD_API_KEY';
export const PI_CODING_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR';
export const MINDOS_PI_CHILD_CLI_PATH_ENV = 'MINDOS_PI_CHILD_CLI_PATH';
export const MINDOS_PI_CHILD_EXTENSION_PATHS_ENV = 'MINDOS_PI_CHILD_EXTENSION_PATHS';

type JsonRecord = Record<string, unknown>;
type ExtensionLoadResultLike = {
  extensions?: Array<{
    path?: unknown;
    resolvedPath?: unknown;
  }>;
};

export interface MindosPiChildModelConfig {
  provider: ProviderId;
  modelName: string;
  apiKey: string;
  baseUrl: string;
  model: JsonRecord;
}

interface MindosPiChildRuntimeConfig {
  agentDir: string;
  binDir: string;
  piCliPath: string;
  nodePath: string;
  bootstrapPath?: string;
  inheritedExtensionPaths: string[];
  env: Record<string, string>;
  modelsJson: JsonRecord;
  settingsJson: JsonRecord;
}

const nodeRequire = createRequire(import.meta.url);
const PI_SUBAGENT_CHILD_ENV = 'PI_SUBAGENT_CHILD';

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

function writePrivateExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o700 });
  try {
    fs.chmodSync(filePath, 0o700);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod.
  }
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function currentWebAppDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, '..', '..');
}

function resolveMindosPiCliPath(): string {
  const webAppDir = currentWebAppDir();
  const found = findBuiltinWebRuntimePackagePath(
    webAppDir,
    '@earendil-works/pi-coding-agent',
    'dist',
    'cli.js',
  );
  if (found) return found;

  return resolveBuiltinWebRuntimePackagePath(
    webAppDir,
    '@earendil-works/pi-coding-agent',
    'dist',
    'cli.js',
  );
}

function normalizeChildExtensionPath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  try {
    const decoded = trimmed.startsWith('file://') ? fileURLToPath(trimmed) : trimmed;
    const absolute = path.isAbsolute(decoded) ? decoded : path.resolve(decoded);
    return path.normalize(absolute);
  } catch {
    return null;
  }
}

function normalizedPathKey(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
}

function isSubagentExtensionPath(filePath: string): boolean {
  const normalized = normalizedPathKey(filePath);
  return normalized.includes('/subagent-ledger-extension.')
    || normalized.includes('/pi-subagents/src/extension/')
    || normalized.includes('/pi-subagents/bundle/');
}

function isKbExtensionPath(filePath: string): boolean {
  return normalizedPathKey(filePath).includes('/lib/agent/kb-extension.');
}

export function collectInheritedSubagentExtensionPaths(input: SubagentChildRuntimeInput): string[] {
  const resourceLoader = input.ctx?.resourceLoader as {
    getExtensions?: () => ExtensionLoadResultLike;
  } | undefined;
  if (typeof resourceLoader?.getExtensions !== 'function') return [];

  const loaded = resourceLoader.getExtensions();
  const inherited: string[] = [];
  const seen = new Set<string>();

  for (const extension of loaded.extensions ?? []) {
    const rawPath = typeof extension.path === 'string' && extension.path.trim()
      ? extension.path
      : typeof extension.resolvedPath === 'string' && extension.resolvedPath.trim()
        ? extension.resolvedPath
        : '';
    const extensionPath = normalizeChildExtensionPath(rawPath);
    if (!extensionPath || isSubagentExtensionPath(extensionPath)) continue;

    const key = normalizedPathKey(extensionPath);
    if (seen.has(key)) continue;
    seen.add(key);
    inherited.push(extensionPath);
  }

  return inherited;
}

function childBootstrapContent(webAppDir: string): string {
  const jitiPath = nodeRequire.resolve('jiti');
  const tsconfigPath = path.join(webAppDir, 'tsconfig.json');
  const kbHostPath = path.join(webAppDir, 'lib', 'agent', 'kb-extension-host.ts');

  return [
    "import { createRequire } from 'node:module';",
    'const require = createRequire(import.meta.url);',
    `const { createJiti } = require(${JSON.stringify(jitiPath)});`,
    'const jiti = createJiti(import.meta.url, {',
    '  moduleCache: false,',
    '  tryNative: false,',
    `  alias: { '@': ${JSON.stringify(webAppDir)} },`,
    `  tsconfigPaths: ${JSON.stringify(tsconfigPath)},`,
    '});',
    'try {',
    `  const mod = await jiti.import(${JSON.stringify(kbHostPath)});`,
    '  const register = mod?.registerWebKbExtensionHost ?? mod?.default?.registerWebKbExtensionHost;',
    "  if (typeof register === 'function') register();",
    '} catch {',
    '  // Best effort: extension loading will report any remaining host error.',
    '}',
    '',
  ].join('\n');
}

function createPathEnv(binDir: string): Record<string, string> {
  const inheritedPath = process.env.PATH ?? process.env.Path ?? '';
  const nextPath = inheritedPath ? `${binDir}${path.delimiter}${inheritedPath}` : binDir;
  return {
    PATH: nextPath,
    ...(process.platform === 'win32' ? { Path: nextPath } : {}),
  };
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
  inheritedExtensionPaths: string[] = [],
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
  const binDir = path.join(agentDir, 'bin');
  const piCliPath = resolveMindosPiCliPath();
  const nodePath = process.execPath;
  const childExtensionPaths = [...new Set(inheritedExtensionPaths
    .map((entry) => normalizeChildExtensionPath(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry) => !isSubagentExtensionPath(entry)))];
  const bootstrapPath = childExtensionPaths.some(isKbExtensionPath)
    ? path.join(agentDir, 'mindos-pi-child-bootstrap.mjs')
    : undefined;

  return {
    agentDir,
    binDir,
    piCliPath,
    nodePath,
    inheritedExtensionPaths: childExtensionPaths,
    bootstrapPath,
    env: {
      [PI_CODING_AGENT_DIR_ENV]: agentDir,
      [MINDOS_PI_CHILD_API_KEY_ENV]: config.apiKey,
      [MINDOS_PI_CHILD_CLI_PATH_ENV]: piCliPath,
      ...(childExtensionPaths.length
        ? { [MINDOS_PI_CHILD_EXTENSION_PATHS_ENV]: JSON.stringify(childExtensionPaths) }
        : {}),
      ...createPathEnv(binDir),
    },
    modelsJson,
    settingsJson,
  };
}

export function ensureMindosPiChildRuntimeDir(config: MindosPiChildRuntimeConfig): void {
  if (!fs.existsSync(config.piCliPath)) {
    throw new Error(`MindOS subagent child runtime could not locate pi CLI at ${config.piCliPath}.`);
  }
  fs.mkdirSync(config.agentDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.binDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(config.agentDir, 0o700);
    fs.chmodSync(config.binDir, 0o700);
  } catch {
    // Best effort on platforms/filesystems that do not support chmod.
  }
  writeJsonFile(path.join(config.agentDir, 'models.json'), config.modelsJson);
  writeJsonFile(path.join(config.agentDir, 'settings.json'), config.settingsJson);
  if (config.bootstrapPath) {
    fs.writeFileSync(config.bootstrapPath, childBootstrapContent(currentWebAppDir()), { mode: 0o600 });
  }
  const shimPath = path.join(config.binDir, 'pi-shim.cjs');
  const jsShim = [
    '#!/usr/bin/env node',
    "const { spawnSync } = require('child_process');",
    `const cliPath = ${JSON.stringify(config.piCliPath)};`,
    `const inheritedExtensionPathsEnv = ${JSON.stringify(MINDOS_PI_CHILD_EXTENSION_PATHS_ENV)};`,
    `const subagentChildEnv = ${JSON.stringify(PI_SUBAGENT_CHILD_ENV)};`,
    `const bootstrapPath = ${JSON.stringify(config.bootstrapPath ?? '')};`,
    'function parseInheritedExtensionPaths() {',
    '  const raw = process.env[inheritedExtensionPathsEnv];',
    '  if (!raw) return [];',
    '  try {',
    '    const parsed = JSON.parse(raw);',
    "    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value.trim()) : [];",
    '  } catch {',
    '    return [];',
    '  }',
    '}',
    'function hasArg(args, flag) {',
    '  return args.includes(flag);',
    '}',
    'function promptArgIndex(args) {',
    '  for (let index = args.length - 1; index >= 0; index -= 1) {',
    '    const arg = args[index];',
    "    if (typeof arg === 'string' && (arg.startsWith('Task:') || arg.startsWith('@'))) return index;",
    '  }',
    '  return args.length;',
    '}',
    'function withInheritedExtensions(args) {',
    "  if (process.env[subagentChildEnv] !== '1') return args;",
    "  if (hasArg(args, '--version') || hasArg(args, '-v') || hasArg(args, '-V') || hasArg(args, '--help') || hasArg(args, '-h')) return args;",
    '  const inherited = parseInheritedExtensionPaths();',
    '  if (inherited.length === 0) return args;',
    '  const existing = new Set();',
    '  for (let index = 0; index < args.length; index += 1) {',
    "    if (args[index] === '--extension' && typeof args[index + 1] === 'string') existing.add(args[index + 1]);",
    '  }',
    '  const extensionArgs = [];',
    '  for (const extPath of inherited) {',
    '    if (existing.has(extPath)) continue;',
    "    extensionArgs.push('--extension', extPath);",
    '    existing.add(extPath);',
    '  }',
    '  if (extensionArgs.length === 0) return args;',
    '  const insertAt = promptArgIndex(args);',
    '  return [...args.slice(0, insertAt), ...extensionArgs, ...args.slice(insertAt)];',
    '}',
    'const originalArgs = process.argv.slice(2);',
    'const piArgs = withInheritedExtensions(originalArgs);',
    'const nodeArgs = [];',
    "if (bootstrapPath && process.env[subagentChildEnv] === '1') nodeArgs.push('--import', bootstrapPath);",
    'nodeArgs.push(cliPath, ...piArgs);',
    "const result = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit', env: process.env });",
    'if (result.error) {',
    "  console.error(result.error.message || String(result.error));",
    '  process.exit(1);',
    '}',
    'if (result.signal) {',
    "  console.error(`pi child process terminated by ${result.signal}`);",
    '  process.exit(1);',
    '}',
    'process.exit(result.status ?? 0);',
    '',
  ].join('\n');
  writePrivateExecutable(shimPath, jsShim);
  writePrivateExecutable(
    path.join(config.binDir, 'pi'),
    ['#!/bin/sh', `exec ${shellQuote(config.nodePath)} ${shellQuote(shimPath)} "$@"`, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(config.binDir, 'pi.cmd'),
    ['@echo off', `"${config.nodePath}" "${shimPath}" %*`, ''].join('\r\n'),
    { mode: 0o700 },
  );
}

export async function withMindosSubagentChildRuntime<T>(
  input: SubagentChildRuntimeInput,
  run: () => Promise<T>,
): Promise<T> {
  const runtimeConfig = buildMindosPiChildRuntimeConfig(
    undefined,
    collectInheritedSubagentExtensionPaths(input),
  );
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
  const webAppDir = currentWebAppDir();
  // 0.87 ships a prebuilt bundle and names its entry in `piExtension`; older
  // releases shipped TypeScript source only. Read the manifest so the layout
  // stays the package's business, not ours.
  const manifestPath = resolveBuiltinWebRuntimePackagePath(webAppDir, 'pi-subagents', 'package.json');
  const packageDir = path.dirname(manifestPath);
  let manifest: Parameters<typeof resolveUpstreamSubagentEntry>[1] = {};
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as typeof manifest;
  } catch {
    // An unreadable manifest falls back to the published source entry below.
  }
  const upstreamPath = resolveUpstreamSubagentEntry(packageDir, manifest);
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
