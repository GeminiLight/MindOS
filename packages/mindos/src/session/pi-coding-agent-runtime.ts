import {
  AuthStorage,
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  bashTool,
} from '@mariozechner/pi-coding-agent';
import { compactMindosPromptForTokenBudget } from '../agent/index.js';
import {
  createMindosPiAgentRuntime,
  type MindosPiAgentRuntimeOptions,
  type MindosPiAgentRuntimeServices,
} from './index.js';

export type MindosPiCodingAgentRuntimeHostServices = Pick<
  MindosPiAgentRuntimeServices,
  | 'resolveModelConfig'
  | 'toRuntimeProvider'
  | 'setKbMode'
  | 'generateSkillsXml'
  | 'getOllamaContextWindow'
  | 'estimateTokens'
  | 'compactPrompt'
  | 'onOllamaContext'
  | 'onOllamaCompactStrip'
  | 'onOllamaCompacted'
>;

export type MindosPiCodingAgentRuntimeOptions =
  Omit<MindosPiAgentRuntimeOptions, 'services' | 'bashTool'> & {
    hostServices: MindosPiCodingAgentRuntimeHostServices;
  };

export function createMindosPiCodingAgentRuntimeServices(
  hostServices: MindosPiCodingAgentRuntimeHostServices,
): MindosPiAgentRuntimeServices {
  return {
    ...hostServices,
    createAuthStorage: () => AuthStorage.create(),
    createModelRegistry: (authStorage) => new ModelRegistry(authStorage as any),
    createSettingsManager: (settings) => SettingsManager.inMemory(settings as any),
    createSessionManager: () => SessionManager.inMemory(),
    createResourceLoader: (config) => new DefaultResourceLoader(config as any) as any,
    createAgentSession: (config) => createAgentSession(config as any) as any,
    convertToLlm: (messages) => convertToLlm(messages as any) as unknown[],
    compactPrompt: hostServices.compactPrompt ?? ((prompt, options) => compactMindosPromptForTokenBudget(prompt, options)),
  };
}

export async function createMindosPiCodingAgentRuntime(
  options: MindosPiCodingAgentRuntimeOptions,
) {
  return createMindosPiAgentRuntime({
    ...options,
    bashTool,
    services: createMindosPiCodingAgentRuntimeServices(options.hostServices),
  });
}
