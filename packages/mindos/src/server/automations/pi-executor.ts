import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMindosPiCodingAgentRuntime,
  type MindosPiAgentRuntime,
  type MindosPiCodingAgentRuntimeHostServices,
  type MindosPiCodingAgentRuntimeOptions,
} from '../../agent/mindos-pi/index.js';
import { createMindosAgentPermissionPolicy } from '../../agent/mindos-pi/permission/index.js';
import {
  registerMindosKbExtensionHost,
  runWithKbPermissionPolicy,
} from '../../agent/mindos-pi/extension/kb-extension.js';
import { buildMindosContextPrompt, buildMindosSystemPrompt } from '../../agent/prompt/index.js';
import {
  getTextDelta,
  getThinkingDelta,
  getToolExecutionEnd,
  getToolExecutionStart,
  isTextDeltaEvent,
  isThinkingDeltaEvent,
  isToolExecutionEndEvent,
  isToolExecutionStartEvent,
} from '../../agent/turn/index.js';
import { nativeImport } from '../../foundation/native-import.js';
import {
  getSkillRootsFromRuntime,
  readRuntimeSettings,
  type MindosRuntimeSettings,
} from '../runtime.js';
import { createStandaloneAutomationKbToolkit } from './standalone-kb-host.js';
import type {
  StudioAutomationExecutorContext,
  StudioAutomationExecutorResult,
  StudioAutomationJob,
} from './types.js';

type PiProvidersModule = typeof import('@earendil-works/pi-ai/providers/all');
type CreateRuntime = (options: MindosPiCodingAgentRuntimeOptions) => Promise<MindosPiAgentRuntime>;

const PACKAGE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
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

export async function runStandaloneMindosPiAutomation(input: {
  mindRoot: string;
  job: StudioAutomationJob;
  context: StudioAutomationExecutorContext;
  homeDir?: string;
  runtimeRoot?: string;
  readSettings?(): MindosRuntimeSettings;
  createRuntime?: CreateRuntime;
}): Promise<StudioAutomationExecutorResult> {
  const homeDir = input.homeDir ?? homedir();
  const runtimeRoot = input.runtimeRoot ?? PACKAGE_ROOT;
  const settings = input.readSettings?.() ?? readRuntimeSettings({ homeDir });
  const policy = createMindosAgentPermissionPolicy(input.job.permissionMode);
  const toolkit = createStandaloneAutomationKbToolkit({
    mindRoot: input.mindRoot,
    settings,
    homeDir,
    runtimeRoot,
  });
  registerMindosKbExtensionHost({ getToolsForPolicy: (activePolicy) => toolkit.getToolsForPolicy(activePolicy) });

  const extensionPath = fileURLToPath(new URL('../../agent/mindos-pi/extension/kb-extension-entry.js', import.meta.url));
  const systemPrompt = buildMindosSystemPrompt({
    mindRoot: input.mindRoot,
    environment: { projectRoot: runtimeRoot, cwd: input.mindRoot },
  });
  const turnPrompt = await buildMindosContextPrompt({
    prompt: input.job.prompt,
    mindRoot: input.mindRoot,
    recalledKnowledge: [],
    fileContext: { contextParts: [], failedFiles: [] },
    sessionWorkDir: {
      path: input.mindRoot,
      label: path.basename(input.mindRoot) || input.mindRoot,
      source: 'mind-root',
    },
  });
  const createRuntime = input.createRuntime ?? createMindosPiCodingAgentRuntime;
  const runtime = await runWithKbPermissionPolicy(policy, () => createRuntime({
    messages: [{ role: 'user', content: input.job.prompt }],
    systemPrompt,
    turnPrompt,
    projectRoot: runtimeRoot,
    agentDir: path.join(homeDir, '.pi'),
    mindRoot: input.mindRoot,
    workDir: input.mindRoot,
    agentConfig: automationAgentConfig(settings, input.job),
    serverSettings: settings,
    additionalSkillPaths: getSkillRootsFromRuntime({
      mindRoot: input.mindRoot,
      runtimeRoot,
      homeDir,
      settings,
    }).map((root) => root.path).filter(existsSync),
    additionalExtensionPaths: [extensionPath],
    allowProjectBash: policy.toolScope.terminal,
    permissionMode: policy.permissionMode,
    hostServices: createStandalonePiHostServices(settings, input.job),
  }));

  let text = '';
  let thinking = '';
  const toolCalls: Array<{ toolCallId: string; toolName: string; output: string; isError: boolean }> = [];
  runtime.session.subscribe((event) => {
    if (isTextDeltaEvent(event)) text += getTextDelta(event);
    else if (isThinkingDeltaEvent(event)) thinking += getThinkingDelta(event);
    else if (isToolExecutionStartEvent(event)) {
      const start = getToolExecutionStart(event);
      toolCalls.push({ toolCallId: start.toolCallId, toolName: start.toolName, output: '', isError: false });
    } else if (isToolExecutionEndEvent(event)) {
      const end = getToolExecutionEnd(event);
      const index = toolCalls.findIndex((call) => call.toolCallId === end.toolCallId);
      if (index >= 0) toolCalls[index] = { ...toolCalls[index]!, output: end.output, isError: end.isError };
      else toolCalls.push({ toolCallId: end.toolCallId, toolName: 'unknown', output: end.output, isError: end.isError });
    }
  });

  if (input.context.signal.aborted) throw input.context.signal.reason ?? new Error('Automation was canceled.');
  const abort = () => { void runtime.session.abort(); };
  input.context.signal.addEventListener('abort', abort, { once: true });
  try {
    await runtime.session.prompt(runtime.turnPrompt);
  } finally {
    input.context.signal.removeEventListener('abort', abort);
  }
  return { text: text.trim(), thinking: thinking.trim(), toolCalls };
}

export function createStandalonePiHostServices(
  settings: MindosRuntimeSettings,
  job: StudioAutomationJob,
): MindosPiCodingAgentRuntimeHostServices {
  return {
    resolveModelConfig: async ({ modelOverride }) => resolveStandaloneModel(
      settings,
      modelOverride ?? (job.model === 'gpt-5.5' ? 'gpt-5.5' : undefined),
    ),
    toRuntimeProvider: (provider) => PROVIDER_ALIASES[provider] ?? provider,
    generateSkillsXml: (skills) => skills.length === 0
      ? ''
      : `<available_skills>\n${skills.map((skill) => `<skill><name>${escapeXml(skill.name)}</name></skill>`).join('\n')}\n</available_skills>`,
    estimateTokens: (content) => Math.max(1, Math.ceil(content.length / 4)),
    onExtensionLoadErrors: (errors) => {
      throw new Error(`Standalone automation extension failed to load: ${errors.map((error) => `${error.path}: ${error.error}`).join('; ')}`);
    },
  };
}

async function resolveStandaloneModel(settings: MindosRuntimeSettings, modelOverride?: string) {
  const provider = selectedProvider(settings);
  const protocol = provider.protocol;
  const runtimeProvider = PROVIDER_ALIASES[protocol] ?? protocol;
  const modelName = modelOverride?.trim() || provider.model;
  if (!modelName) throw new Error('Automation needs a configured model in ~/.mindos/config.json.');
  const apiKey = provider.apiKey || firstEnvironmentValue(PROVIDER_ENV_KEYS[protocol] ?? []);
  if (!apiKey && !isKeylessProvider(protocol)) {
    throw new Error(`Automation provider ${protocol} is missing an API key.`);
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

function selectedProvider(settings: MindosRuntimeSettings): {
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
  const active = typeof ai.activeProvider === 'string' ? ai.activeProvider : '';
  const selected = providers.find((provider) => provider.id === active || provider.protocol === active) ?? providers[0];
  if (!selected) throw new Error('Automation needs an AI provider configured in ~/.mindos/config.json.');
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

function automationAgentConfig(settings: MindosRuntimeSettings, job: StudioAutomationJob) {
  const configured = isRecord(settings.agent) ? settings.agent : {};
  return {
    ...configured,
    maxSteps: job.effort === 'extra-high' ? 80 : job.effort === 'high' ? 50 : 30,
    thinkingLevel: job.effort === 'extra-high' ? 'xhigh' as const : job.effort === 'high' ? 'high' as const : 'medium' as const,
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
