import { getMindRoot } from '@/lib/fs';
import { readSettings } from '@/lib/settings';
import { getProjectRoot } from '@/lib/project-root';
import type { Message as FrontendMessage } from '@/lib/types';
import { performActiveRecallWithReceipt } from '@/lib/agent/active-recall';
import { toMindosUiAgentMessages } from '@/lib/agent/to-agent-messages';
import { executeMindosPiRuntimeTurn, normalizeMindosAgentStepLimit } from '@geminilight/mindos/agent/turn';
import { buildMindosContextPrompt, buildMindosSystemPrompt } from '@geminilight/mindos/agent';
import type { MindosPermissionMode } from '@geminilight/mindos/agent/mindos-pi/permission';
import { resolveHeadlessAgentPermission, type HeadlessAgentEntryPoint } from './headless-permission-guard';

export interface HeadlessAgentRunOptions {
  userMessage: string;
  historyMessages?: FrontendMessage[];
  permissionMode?: MindosPermissionMode;
  maxSteps?: number;
  providerOverride?: string;
  modelOverride?: string;
  workDir?: string;
  entrypoint?: HeadlessAgentEntryPoint;
  automationId?: string;
  runId?: string;
  signal?: AbortSignal;
}

export interface HeadlessAgentRunResult {
  text: string;
  thinking: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; output: string; isError: boolean }>;
}

export async function runHeadlessAgent(options: HeadlessAgentRunOptions): Promise<HeadlessAgentRunResult> {
  options.signal?.throwIfAborted();
  const permissionDecision = resolveHeadlessAgentPermission({
    entrypoint: options.entrypoint,
    permissionMode: options.permissionMode,
  });
  const historyMessages = Array.isArray(options.historyMessages) ? options.historyMessages : [];
  const currentMessage: FrontendMessage = { role: 'user', content: options.userMessage, timestamp: Date.now() };
  const allMessages = [...historyMessages, currentMessage];
  const mindosUiMessages = toMindosUiAgentMessages(allMessages);
  const serverSettings = readSettings();
  const agentConfig = serverSettings.agent ?? {};
  const projectRoot = getProjectRoot();
  const mindRoot = getMindRoot();
  const workDir = options.workDir || mindRoot;

  const systemPrompt = buildMindosSystemPrompt({
    mindRoot,
    environment: {
      projectRoot,
      cwd: workDir,
    },
  });
  const activeRecall = agentConfig.activeRecall ?? {};
  const recalledKnowledge = (await performActiveRecallWithReceipt(mindRoot, options.userMessage, {
      maxTokens: activeRecall.maxTokens,
      maxFiles: activeRecall.maxFiles,
      minScore: activeRecall.minScore,
      excludePaths: [],
      preferredPaths: [],
    }, {
      trigger: activeRecall.enabled === false ? 'disabled' : options.entrypoint ?? 'headless',
      ...(options.automationId ? { automationId: options.automationId } : {}),
      ...(options.runId ? { runId: options.runId } : {}),
      ...(activeRecall.enabled === false ? { skip: true } : {}),
    }).catch((error) => {
      console.warn('[headless-agent] Active recall failed, continuing without:', error);
      return { items: [] };
    })).items;
  const turnPrompt = await buildMindosContextPrompt({
    prompt: options.userMessage,
    mindRoot,
    recalledKnowledge,
    fileContext: { contextParts: [], failedFiles: [] },
    sessionWorkDir: {
      path: workDir,
      label: workDir.split(/[\\/]/).filter(Boolean).pop() || workDir,
      source: options.workDir ? 'manual' : 'mind-root',
    },
  });

  const {
    createWebMindosPiRuntimeHostServices,
    getMindosWebPiRuntimePaths,
  } = await import('@/lib/agent/mindos-pi-runtime-host');
  const { createMindosAgentRuntime } = await import('@geminilight/mindos/agent/runtime/adapters/mindos');
  const { runWithKbPermissionPolicy } = await import('@/lib/agent/kb-extension');
  const { createMindosAgentPermissionPolicy } = await import('@geminilight/mindos/agent/mindos-pi/permission');
  const permissionPolicy = createMindosAgentPermissionPolicy(permissionDecision.permissionPolicyMode);
  const runtimePaths = getMindosWebPiRuntimePaths({ projectRoot, mindRoot, serverSettings, permissionPolicy });
  // Scope the kb tool policy to this request — see route.ts for the rationale.
  const runtime = await runWithKbPermissionPolicy(permissionPolicy, () => createMindosAgentRuntime({
    messages: mindosUiMessages,
    systemPrompt,
    turnPrompt,
    providerOverride: options.providerOverride,
    modelOverride: typeof options.modelOverride === 'string' ? options.modelOverride : undefined,
    projectRoot,
    agentDir: runtimePaths.agentDir,
    mindRoot,
    workDir,
    agentConfig,
    serverSettings,
    additionalSkillPaths: runtimePaths.additionalSkillPaths,
    additionalExtensionPaths: runtimePaths.additionalExtensionPaths,
    allowProjectBash: permissionPolicy.toolScope.terminal,
    permissionMode: permissionPolicy.permissionMode,
    hostServices: createWebMindosPiRuntimeHostServices(serverSettings),
  }));

  return executeMindosPiRuntimeTurn({
    runtime, mindRoot, cwd: workDir,
    permissionMode: permissionPolicy.permissionMode,
    maxSteps: normalizeMindosAgentStepLimit({ requestedMaxSteps: options.maxSteps, agentMaxSteps: agentConfig.maxSteps }),
    signal: options.signal,
    capsuleRequest: { messages: mindosUiMessages, runtime: { kind: 'mindos', id: 'mindos', name: 'MindOS' }, permissionMode: permissionPolicy.permissionMode, context: { attachedFiles: [], uploadedFiles: [], receiptIds: [], assetIds: [] } },
    source: options.entrypoint === 'im' ? 'event' : 'automation',
    runId: options.runId,
    metadata: { entrypoint: options.entrypoint ?? 'headless', automationId: options.automationId },
  });
}
