import { nativeImport } from '../../foundation/native-import.js';
import {
  createMindosPiAgentRuntime,
  type MindosPiAgentRuntimeOptions,
  type MindosPiAgentRuntimeServices,
} from './session.js';
import { compactMindosPromptForTokenBudget } from '../prompt/index.js';

// The pi SDK must never be imported statically here: webpack would inline a
// private copy with broken `import.meta`, killing jiti's extension loader
// (every entry fails, the session runs with no KB tools). See
// foundation/native-import.ts for the full failure chain.

type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent');
type PiAiModule = typeof import('@earendil-works/pi-ai');

let piModulePromise: Promise<PiCodingAgentModule> | undefined;
let piAiModulePromise: Promise<PiAiModule> | undefined;

function loadPiCodingAgent(): Promise<PiCodingAgentModule> {
  piModulePromise ??= nativeImport<PiCodingAgentModule>('@earendil-works/pi-coding-agent');
  return piModulePromise;
}

function loadPiAi(): Promise<PiAiModule> {
  piAiModulePromise ??= nativeImport<PiAiModule>('@earendil-works/pi-ai');
  return piAiModulePromise;
}

type MindosPiCredential = {
  type: 'api_key' | 'oauth';
  [key: string]: unknown;
};

class MindosPiInMemoryCredentialStore {
  private readonly credentials = new Map<string, MindosPiCredential>();
  private readonly chains = new Map<string, Promise<unknown>>();

  async read(providerId: string): Promise<MindosPiCredential | undefined> {
    return this.credentials.get(providerId);
  }

  async list(): Promise<Array<{ providerId: string; type: 'api_key' | 'oauth' }>> {
    return [...this.credentials.entries()].map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    update: (current: MindosPiCredential | undefined) => Promise<MindosPiCredential | undefined>,
  ): Promise<MindosPiCredential | undefined> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const next = await update(this.credentials.get(providerId));
      if (next !== undefined) this.credentials.set(providerId, next);
      return this.credentials.get(providerId);
    });
    this.chains.set(providerId, operation.catch(() => undefined));
    return operation;
  }

  async delete(providerId: string): Promise<void> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const operation = previous.then(() => {
      this.credentials.delete(providerId);
    });
    this.chains.set(providerId, operation.catch(() => undefined));
    await operation;
  }
}

export type MindosPiCodingAgentRuntimeHostServices = Pick<
  MindosPiAgentRuntimeServices,
  | 'resolveModelConfig'
  | 'toRuntimeProvider'
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
  piAi: PiAiModule,
  hostServices: MindosPiCodingAgentRuntimeHostServices,
): MindosPiAgentRuntimeServices {
  return {
    ...hostServices,
    createModelRuntime: () => pi.ModelRuntime.create({
      credentials: new MindosPiInMemoryCredentialStore() as any,
      modelsPath: null,
      allowModelNetwork: false,
    }),
    createExtensionModelRegistry: (modelRuntime) => new pi.ModelRegistry(modelRuntime as any),
    clampThinkingLevel: (model, level) => piAi.clampThinkingLevel(model as any, level),
    createSettingsManager: (settings) => pi.SettingsManager.inMemory(settings as any),
    createSessionManager: ({ cwd, runtimeSession }) => {
      if (!runtimeSession?.sessionDir) return pi.SessionManager.inMemory(cwd);
      const manager = pi.SessionManager.continueRecent(cwd, runtimeSession.sessionDir);
      const entries = typeof manager.getEntries === 'function' ? manager.getEntries() : [];
      return {
        manager,
        bootstrapHistory: entries.length === 0,
        externalSessionId: typeof manager.getSessionId === 'function' ? manager.getSessionId() : undefined,
        sessionDir: typeof manager.getSessionDir === 'function' ? manager.getSessionDir() : runtimeSession.sessionDir,
        sessionFile: typeof manager.getSessionFile === 'function' ? manager.getSessionFile() : undefined,
      };
    },
    createResourceLoader: (config) => new pi.DefaultResourceLoader(config as any) as any,
    createAgentSession: (config) => pi.createAgentSession(config as any) as any,
    convertToLlm: (messages) => pi.convertToLlm(messages as any) as unknown[],
    compactPrompt: hostServices.compactPrompt ?? ((prompt, options) => compactMindosPromptForTokenBudget(prompt, options)),
  };
}

export async function createMindosPiCodingAgentRuntime(
  options: MindosPiCodingAgentRuntimeOptions,
) {
  const [pi, piAi] = await Promise.all([loadPiCodingAgent(), loadPiAi()]);
  return createMindosPiAgentRuntime({
    ...options,
    // ToolDefinition shape (not AgentTool) — it goes into SDK customTools.
    bashTool: pi.createBashToolDefinition(options.workDir ?? options.mindRoot),
    services: createMindosPiCodingAgentRuntimeServices(pi, piAi, options.hostServices),
  });
}
