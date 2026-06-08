import path from 'path';
import os from 'os';
import type {
  MindosAskMode,
  MindosExecutableTool,
} from '@geminilight/mindos/session';
import type { MindosPiCodingAgentRuntimeHostServices } from '@geminilight/mindos/session/pi-coding-agent';
import { getModelConfig, hasImages } from '@/lib/agent/model';
import { getChatTools, getOrganizeTools, getRequestScopedTools } from '@/lib/agent/tools';
import { estimateStringTokens, getOllamaContextWindow } from '@/lib/agent/context';
import { isProviderId, toPiProvider, type ProviderId } from '@/lib/agent/providers';
import { findProvider, isProviderEntryId } from '@/lib/custom-endpoints';
import { setKbMode } from '@/lib/agent/kb-extension';
import { scanExtensionPaths } from '@/lib/pi-integration/extensions';
import { generateSkillsXml } from '@/lib/agent/skills-xml';
import { getSkillSearchPaths } from '@/lib/agent/skill-paths';

type WebServerSettings = {
  disabledSkills?: string[];
  skillPaths?: {
    enableAgentsDir?: boolean;
    custom?: string[];
  };
  ai?: {
    providers?: unknown[];
  };
};

export function getMindosWebRequestTools(mode: MindosAskMode): MindosExecutableTool[] {
  const tools = mode === 'organize'
    ? getOrganizeTools()
    : mode === 'chat'
      ? getChatTools()
      : getRequestScopedTools();
  return tools as unknown as MindosExecutableTool[];
}

export function getMindosWebPiRuntimePaths(input: {
  projectRoot: string;
  mindRoot: string;
  serverSettings: WebServerSettings;
}): { agentDir: string; additionalSkillPaths: string[]; additionalExtensionPaths: string[] } {
  const webAppDir = path.join(input.projectRoot, 'packages', 'web');
  return {
    agentDir: path.join(os.homedir(), '.pi'),
    additionalSkillPaths: getSkillSearchPaths(input.projectRoot, input.mindRoot, input.serverSettings as any),
    additionalExtensionPaths: [
      ...scanExtensionPaths(),
      path.join(webAppDir, 'lib', 'agent', 'kb-extension.ts'),
      path.join(webAppDir, 'node_modules', 'pi-mcp-adapter', 'index.ts'),
      path.join(webAppDir, 'lib', 'im', 'index.ts'),
      path.join(webAppDir, 'node_modules', 'pi-subagents', 'src', 'extension', 'index.ts'),
      path.join(webAppDir, 'lib', 'agent', 'web-search-extension.ts'),
      path.join(webAppDir, 'node_modules', 'pi-web-access', 'index.ts'),
      path.join(webAppDir, 'lib', 'schedule-prompt', 'index.ts'),
    ],
  };
}

export function createWebMindosPiRuntimeHostServices(
  serverSettings: WebServerSettings,
): MindosPiCodingAgentRuntimeHostServices {
  return {
    resolveModelConfig: (input) => {
      let providerOverride: ProviderId | undefined;
      let customProviderConfig: { apiKey: string; model: string; baseUrl: string } | undefined;

      if (input.providerOverride) {
        if (isProviderEntryId(input.providerOverride)) {
          const customProvider = findProvider((serverSettings.ai?.providers ?? []) as any, input.providerOverride);
          if (!customProvider) {
            const error = new Error('Provider not found') as Error & { code?: string; status?: number };
            error.code = 'INVALID_REQUEST';
            error.status = 400;
            throw error;
          }
          providerOverride = customProvider.protocol;
          customProviderConfig = {
            apiKey: customProvider.apiKey,
            model: customProvider.model,
            baseUrl: customProvider.baseUrl,
          };
        } else if (isProviderId(input.providerOverride)) {
          providerOverride = input.providerOverride;
        }
      }

      const modelOverride = input.modelOverride?.trim() || undefined;
      return getModelConfig({
        provider: providerOverride,
        apiKey: customProviderConfig?.apiKey,
        model: modelOverride ?? customProviderConfig?.model,
        baseUrl: customProviderConfig?.baseUrl,
        hasImages: hasImages(input.messages as any),
      });
    },
    toRuntimeProvider: (provider) => toPiProvider(provider as ProviderId),
    setKbMode: (mode) => setKbMode(mode === 'organize' ? 'organize' : mode === 'chat' ? 'chat' : 'agent'),
    generateSkillsXml: (skills) => generateSkillsXml(skills as any),
    getOllamaContextWindow,
    estimateTokens: estimateStringTokens,
    onOllamaContext: ({ modelName, contextWindow, promptTokens, maxPromptTokens }) => {
      if (contextWindow) {
        console.log(`[ask] Ollama model="${modelName}" context=${contextWindow} promptTokens=${promptTokens} maxPromptTokens=${maxPromptTokens}`);
      }
      if (maxPromptTokens && promptTokens > maxPromptTokens) {
        console.warn(`[ask] Ollama context overflow: prompt ${promptTokens} tokens > ${maxPromptTokens} max (${contextWindow} ctx). Compacting...`);
      }
    },
    onOllamaCompactStrip: (section, sectionTokens) => {
      console.log(`[ask] Ollama compact: stripping section (${sectionTokens} tokens): ${section.slice(0, 80)}...`);
    },
    onOllamaCompacted: ({ beforeTokens, afterTokens }) => {
      console.log(`[ask] Ollama compacted: ${beforeTokens} -> ${afterTokens} tokens`);
    },
  };
}
