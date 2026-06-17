import { nativeImport } from '../../foundation/native-import.js';
import {
  createMindosPiAgentRuntime,
  type MindosPiAgentRuntimeOptions,
  type MindosPiAgentRuntimeServices,
} from '../../session/index.js';
import { compactMindosPromptForTokenBudget } from '../prompt/index.js';

// The pi SDK must never be imported statically here: webpack would inline a
// private copy with broken `import.meta`, killing jiti's extension loader
// (every entry fails, the session runs with no KB tools). See
// foundation/native-import.ts for the full failure chain.

type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent');

let piModulePromise: Promise<PiCodingAgentModule> | undefined;

function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  piModulePromise ??= nativeImport<PiCodingAgentModule>('@earendil-works/pi-coding-agent');
  return piModulePromise;
}

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
  | 'onExtensionLoadErrors'
>;

export type MindosPiCodingAgentRuntimeOptions =
  Omit<MindosPiAgentRuntimeOptions, 'services' | 'bashTool'> & {
    hostServices: MindosPiCodingAgentRuntimeHostServices;
  };

export function createMindosPiCodingAgentRuntimeServices(
  pi: PiCodingAgentModule,
  hostServices: MindosPiCodingAgentRuntimeHostServices,
): MindosPiAgentRuntimeServices {
  return {
    ...hostServices,
    createAuthStorage: () => pi.AuthStorage.create(),
    createModelRegistry: (authStorage) => pi.ModelRegistry.create(authStorage as any),
    createSettingsManager: (settings) => pi.SettingsManager.inMemory(settings as any),
    createSessionManager: () => pi.SessionManager.inMemory(),
    createResourceLoader: (config) => new pi.DefaultResourceLoader(config as any) as any,
    createAgentSession: (config) => pi.createAgentSession(config as any) as any,
    convertToLlm: (messages) => pi.convertToLlm(messages as any) as unknown[],
    compactPrompt: hostServices.compactPrompt ?? ((prompt, options) => compactMindosPromptForTokenBudget(prompt, options)),
  };
}

export async function createMindosPiCodingAgentRuntime(
  options: MindosPiCodingAgentRuntimeOptions,
) {
  const pi = await loadPiCodingAgent();
  return createMindosPiAgentRuntime({
    ...options,
    // ToolDefinition shape (not AgentTool) — it goes into SDK customTools.
    bashTool: pi.createBashToolDefinition(options.projectRoot),
    services: createMindosPiCodingAgentRuntimeServices(pi, options.hostServices),
  });
}
