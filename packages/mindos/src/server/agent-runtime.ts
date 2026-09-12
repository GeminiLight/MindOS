import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMindosPiCodingAgentRuntime, type MindosPiAgentRuntime, type MindosPiCodingAgentRuntimeHostServices, type MindosPiCodingAgentRuntimeOptions } from '../agent/mindos-pi/index.js';
import { createMindosAgentPermissionPolicy } from '../agent/mindos-pi/permission/index.js';
import { runWithMindosKbExtensionHost, runWithKbPermissionPolicy } from '../agent/mindos-pi/extension/kb-extension.js';
import { buildMindosSystemPrompt } from '../agent/prompt/index.js';
import { nativeImport } from '../foundation/native-import.js';
import { getSkillRootsFromRuntime, readRuntimeSettings, type MindosRuntimeSettings } from './runtime.js';
import { createStandaloneAutomationKbToolkit } from './automations/standalone-kb-host.js';
type PiProvidersModule = typeof import('@earendil-works/pi-ai/providers/all');
type CreateRuntime = (options: MindosPiCodingAgentRuntimeOptions) => Promise<MindosPiAgentRuntime>;

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url).href);
const PROVIDER_ALIASES: Record<string, string> = { deepseek: 'openai', 'zai-cn': 'zai' };
const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  xai: ['XAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  zai: ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
  'zai-cn': ['ZAI_API_KEY', 'ZHIPUAI_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
};

export function createStandalonePiHostServices(
  settings: MindosRuntimeSettings,
  options: { model?: string; provider?: string } = {},
): MindosPiCodingAgentRuntimeHostServices {
  return {
    resolveModelConfig: async ({ modelOverride, providerOverride }) => resolveStandaloneModel(
      settings,
      modelOverride ?? options.model,
      providerOverride ?? options.provider,
    ),
    toRuntimeProvider: (provider) => PROVIDER_ALIASES[provider] ?? provider,
    generateSkillsXml: (skills) => skills.length === 0
      ? ''
      : `<available_skills>\n${skills.map((skill) => `<skill><name>${escapeXml(skill.name)}</name></skill>`).join('\n')}\n</available_skills>`,
    estimateTokens: (content) => Math.max(1, Math.ceil(content.length / 4)),
    onExtensionLoadErrors: (errors) => {
      throw new Error(`Standalone Agent extension failed to load: ${errors.map((error) => `${error.path}: ${error.error}`).join('; ')}`);
    },
  };
}

async function resolveStandaloneModel(settings: MindosRuntimeSettings, modelOverride?: string, providerOverride?: string) {
  const provider = selectedProvider(settings, providerOverride);
  const protocol = provider.protocol;
  const runtimeProvider = PROVIDER_ALIASES[protocol] ?? protocol;
  const modelName = modelOverride?.trim() || provider.model;
  if (!modelName) throw new Error('Agent needs a configured model in ~/.mindos/config.json.');
  const apiKey = provider.apiKey || firstEnvironmentValue(PROVIDER_ENV_KEYS[protocol] ?? []);
  if (!apiKey && !isKeylessProvider(protocol)) {
    throw new Error(`Agent provider ${protocol} is missing an API key.`);
  }
  const providers = await nativeImport<PiProvidersModule>('@earendil-works/pi-ai/providers/all');
  const builtin = providers.builtinModels().getModel(runtimeProvider, modelName);
  const model = builtin
    ? applyBaseUrl(builtin as unknown as Record<string, unknown>, provider.baseUrl)
    : fallbackModel(protocol, runtimeProvider, modelName, provider.baseUrl);
  return {
    model,
    modelName,
    apiKey: apiKey || 'local-runtime',
    provider: protocol,
    baseUrl: typeof model.baseUrl === 'string' ? model.baseUrl : provider.baseUrl,
  };
}

function selectedProvider(settings: MindosRuntimeSettings, providerOverride?: string): {
  id: string;
  protocol: string;
  apiKey: string;
  model: string;
  baseUrl: string;
} {
  const ai = isRecord(settings.ai) ? settings.ai : {};
  const providers = Array.isArray(ai.providers)
    ? ai.providers.flatMap((value) => {
      if (!isRecord(value) || typeof value.protocol !== 'string') return [];
      return [{
        id: typeof value.id === 'string' ? value.id : value.protocol,
        protocol: value.protocol,
        apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
        model: typeof value.model === 'string' ? value.model : '',
        baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
      }];
    })
    : [];
  const active = providerOverride ?? (typeof ai.activeProvider === 'string' ? ai.activeProvider : '');
  const selected = providers.find((provider) => provider.id === active || provider.protocol === active) ?? providers[0];
  if (providerOverride && !providers.some(provider => provider.id === active || provider.protocol === active)) throw new Error(`Unknown AI provider: ${providerOverride}`);
  if (!selected) throw new Error('Agent needs an AI provider configured in ~/.mindos/config.json.');
  return selected;
}

function fallbackModel(protocol: string, runtimeProvider: string, modelName: string, baseUrl: string): Record<string, unknown> {
  return {
    id: modelName,
    name: modelName,
    api: protocol === 'anthropic' ? 'anthropic-messages' : protocol === 'google' ? 'google-generative-ai' : 'openai-completions',
    provider: runtimeProvider,
    baseUrl: baseUrl || defaultBaseUrl(protocol),
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsUsageInStreaming: false, supportsStrictMode: false },
  };
}

function applyBaseUrl(model: Record<string, unknown>, baseUrl: string): Record<string, unknown> {
  if (!baseUrl.trim()) return model;
  return {
    ...model,
    baseUrl: baseUrl.trim().replace(/\/+$/, ''),
    ...(model.api === 'openai-responses' ? { api: 'openai-completions' } : {}),
    compat: {
      ...(isRecord(model.compat) ? model.compat : {}),
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
    },
  };
}

function defaultBaseUrl(protocol: string): string {
  if (protocol === 'anthropic') return 'https://api.anthropic.com';
  if (protocol === 'google') return 'https://generativelanguage.googleapis.com';
  if (protocol === 'deepseek') return 'https://api.deepseek.com/v1';
  if (protocol === 'ollama') return 'http://127.0.0.1:11434/v1';
  return 'https://api.openai.com/v1';
}

function firstEnvironmentValue(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
}

function isKeylessProvider(protocol: string): boolean {
  return protocol === 'ollama' || protocol === 'lm-studio' || protocol === 'vllm';
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export type StandalonePiRuntimeInput = Pick<MindosPiCodingAgentRuntimeOptions, 'messages' | 'turnPrompt' | 'agentConfig' | 'permissionMode' | 'providerOverride' | 'modelOverride' | 'runtimeSession'> & {
  mindRoot: string;
  workDir?: string;
  homeDir?: string;
  runtimeRoot?: string;
  readSettings?(): MindosRuntimeSettings;
  createRuntime?: CreateRuntime;
};

/** Product-owned runtime construction shared by HTTP and scheduled turns. */
export async function createStandalonePiRuntime(input: StandalonePiRuntimeInput): Promise<MindosPiAgentRuntime> {
  const homeDir = input.homeDir ?? homedir();
  const runtimeRoot = input.runtimeRoot ?? PACKAGE_ROOT;
  const settings = input.readSettings?.() ?? readRuntimeSettings({ homeDir });
  const policy = createMindosAgentPermissionPolicy(input.permissionMode);
  const workDir = input.workDir ?? input.mindRoot;
  const toolkit = createStandaloneAutomationKbToolkit({ mindRoot: input.mindRoot, settings, homeDir, runtimeRoot });
  return runWithMindosKbExtensionHost({ getToolsForPolicy: activePolicy => toolkit.getToolsForPolicy(activePolicy) }, () => runWithKbPermissionPolicy(policy, () => (input.createRuntime ?? createMindosPiCodingAgentRuntime)({
    messages: input.messages,
    turnPrompt: input.turnPrompt,
    systemPrompt: buildMindosSystemPrompt({ mindRoot: input.mindRoot, environment: { projectRoot: runtimeRoot, cwd: workDir } }),
    projectRoot: runtimeRoot, agentDir: path.join(homeDir, '.pi'), mindRoot: input.mindRoot, workDir,
    agentConfig: input.agentConfig, serverSettings: settings,
    providerOverride: input.providerOverride, modelOverride: input.modelOverride, runtimeSession: input.runtimeSession,
    additionalSkillPaths: getSkillRootsFromRuntime({ mindRoot: input.mindRoot, runtimeRoot, homeDir, settings }).map(root => root.path).filter(existsSync),
    additionalExtensionPaths: [fileURLToPath(new URL('../agent/mindos-pi/extension/kb-extension-entry.js', import.meta.url).href)],
    allowProjectBash: policy.toolScope.terminal, permissionMode: policy.permissionMode,
    hostServices: createStandalonePiHostServices(settings),
  })));
}
