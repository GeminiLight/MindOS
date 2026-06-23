import path from 'path';
import os from 'os';
import type { MindosPiCodingAgentRuntimeHostServices } from '@geminilight/mindos/agent/mindos-pi';
import { getModelConfig, hasImages } from '@/lib/agent/model';
import { estimateStringTokens, getOllamaContextWindow } from '@/lib/agent/context';
import { isProviderId, toPiProvider, type ProviderId } from '@/lib/agent/providers';
import { findProvider, isProviderEntryId } from '@/lib/custom-endpoints';
import { registerWebKbExtensionHost } from '@/lib/agent/kb-extension-host';
import { scanExtensionPaths } from '@/lib/pi-integration/extensions';
import { generateSkillsXml } from '@/lib/agent/skills-xml';
import { getSkillSearchPaths } from '@/lib/agent/skill-paths';
import { ensureMindosAgentMcpRuntimeConfig } from '@/lib/pi-integration/mcp-config';
import {
  resolveBuiltinWebRuntimePackagePath,
  resolveMindosWebRuntimeSourcePath,
} from './builtin-extension-runtime';
import {
  createMindosAgentPermissionPolicy,
  hasMindosExtensionScope,
  type MindosAgentPermissionPolicy,
} from '@geminilight/mindos/agent/mindos-pi/permission';

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

export function getMindosWebPiRuntimePaths(input: {
  projectRoot: string;
  mindRoot: string;
  serverSettings: WebServerSettings;
  permissionPolicy?: MindosAgentPermissionPolicy;
}): { agentDir: string; additionalSkillPaths: string[]; additionalExtensionPaths: string[] } {
  const policy = input.permissionPolicy ?? createMindosAgentPermissionPolicy('ask');
  const webAppDir = path.join(input.projectRoot, 'packages', 'web');
  const additionalExtensionPaths: string[] = [];

  // The kb-extension entry reads the web toolkit back from a process-global
  // slot at reload() time — register it before the loader can run.
  registerWebKbExtensionHost();

  if (hasMindosExtensionScope(policy, 'kb')) {
    additionalExtensionPaths.push(resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'agent', 'kb-extension.ts'));
  }
  if (hasMindosExtensionScope(policy, 'ask-user-question')) {
    additionalExtensionPaths.push(resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'agent', 'ask-user-question-bridge-extension.ts'));
  }
  if (hasMindosExtensionScope(policy, 'pi-web-access')) {
    additionalExtensionPaths.push(resolveBuiltinWebRuntimePackagePath(webAppDir, 'pi-web-access', 'index.ts'));
  }
  if (hasMindosExtensionScope(policy, 'user-extensions')) {
    additionalExtensionPaths.push(...scanExtensionPaths());
  }
  if (hasMindosExtensionScope(policy, 'pi-mcp-adapter')) {
    const mcpRuntimeConfig = ensureMindosAgentMcpRuntimeConfig();
    if (mcpRuntimeConfig.serverCount > 0) {
      additionalExtensionPaths.push(resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'agent', 'mindos-mcp-adapter-extension.ts'));
    }
  }
  if (hasMindosExtensionScope(policy, 'im')) {
    additionalExtensionPaths.push(resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'im', 'index.ts'));
  }
  if (hasMindosExtensionScope(policy, 'subagents')) {
    additionalExtensionPaths.push(resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'agent', 'subagent-ledger-extension.ts'));
  }
  if (hasMindosExtensionScope(policy, 'schedule-prompt')) {
    additionalExtensionPaths.push(resolveMindosWebRuntimeSourcePath(webAppDir, 'lib', 'schedule-prompt', 'index.ts'));
  }

  return {
    agentDir: path.join(os.homedir(), '.pi'),
    additionalSkillPaths: getSkillSearchPaths(input.projectRoot, input.mindRoot, input.serverSettings as any),
    additionalExtensionPaths,
  };
}

export function createWebMindosPiRuntimeHostServices(
  serverSettings: WebServerSettings,
): MindosPiCodingAgentRuntimeHostServices {
  return {
    resolveModelConfig: (input) => {
      let providerOverride: ProviderId | undefined;
      let customProviderConfig: { apiKey: string; model: string; baseUrl: string } | undefined;
      let customProviderEntry: ReturnType<typeof findProvider> | undefined;

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
          customProviderEntry = customProvider;
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
        providerEntry: customProviderEntry,
      });
    },
    toRuntimeProvider: (provider) => toPiProvider(provider as ProviderId),
    generateSkillsXml: (skills) => generateSkillsXml(skills as any),
    getOllamaContextWindow,
    estimateTokens: estimateStringTokens,
    onOllamaContext: ({ modelName, contextWindow, promptTokens, maxPromptTokens }) => {
      if (contextWindow) {
        console.log(`[agent] Ollama model="${modelName}" context=${contextWindow} promptTokens=${promptTokens} maxPromptTokens=${maxPromptTokens}`);
      }
      if (maxPromptTokens && promptTokens > maxPromptTokens) {
        console.warn(`[agent] Ollama context overflow: prompt ${promptTokens} tokens > ${maxPromptTokens} max (${contextWindow} ctx). Compacting...`);
      }
    },
    onOllamaCompactStrip: (section, sectionTokens) => {
      console.log(`[agent] Ollama compact: stripping section (${sectionTokens} tokens): ${section.slice(0, 80)}...`);
    },
    onOllamaCompacted: ({ beforeTokens, afterTokens }) => {
      console.log(`[agent] Ollama compacted: ${beforeTokens} -> ${afterTokens} tokens`);
    },
    onExtensionLoadErrors: (errors) => {
      for (const entry of errors) {
        console.error(`[agent] extension failed to load: ${entry.path}: ${entry.error}`);
      }
    },
  };
}
