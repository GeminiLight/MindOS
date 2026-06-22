import { randomUUID } from 'crypto';
import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { metrics } from '@/lib/metrics';
import { readBaseUrlCompat, writeBaseUrlCompat, type ServerSettings } from '@/lib/settings';
import { resolveAgentTurnCompatMode } from '@/lib/agent/agent-turn-compat';
import {
  appendSseEventToAgentRun,
} from '@geminilight/mindos/agent';
import {
  runMindosNonStreamingFallback,
  resolveMindosAgentTimeoutMs,
  type MindOSSSEvent,
  type MindosUiAgentMessage,
} from '@geminilight/mindos/agent/turn';
import { runMindosPiAgentTurnSession } from '@geminilight/mindos/agent/mindos-pi';
import { runWithAskUserQuestionBridge } from '@geminilight/mindos/agent/bridges/user-question-bridge';
import {
  runWithAgentRunContext,
  setAgentRunContextForResource,
} from '@geminilight/mindos/agent/agent-run-context';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  createMindosAgentPermissionPolicy,
} from '@geminilight/mindos/agent/mindos-pi/permission';
import {
  agentRunErrorStatus,
  createAgentTurnSseResponse,
  formatMindosPiExtensionLoadStatus,
  sendAgentRunContext,
} from './turn-sse';

type PermissionPolicy = ReturnType<typeof createMindosAgentPermissionPolicy>;

type MindosPiTurnLocalization = {
  agentTimeout: string;
  proxyCompatMode: string;
  proxyCompatDetecting: string;
  proxyCompatFailed(message: string): string;
  proxyCompatAlsoFailed(message: string): string;
};

export type RunMindosPiTurnInput = {
  mindosUiMessages: MindosUiAgentMessage[];
  systemPrompt: string;
  turnPrompt: string;
  providerOverride?: string;
  modelOverride?: string;
  projectRoot: string;
  mindRoot: string;
  executionCwd: string;
  agentConfig: {
    enableThinking: boolean;
    thinkingBudget: number;
    contextStrategy: 'auto' | 'off';
  };
  serverSettings: ServerSettings;
  permissionPolicy: PermissionPolicy;
  chatSessionId?: string;
  agentMode: string;
  sessionContextMetadata: Record<string, unknown>;
  fileContextMetadata: Record<string, unknown>;
  sessionWorkDirPath: string;
  sessionSpaces: string[];
  sessionAssistants: string[];
  assistantId?: string;
  requestSignal: AbortSignal;
  stepLimit: number;
  t: MindosPiTurnLocalization;
};

export async function runMindosPiTurn(input: RunMindosPiTurnInput): Promise<Response> {
  let systemPrompt = input.systemPrompt;
  try {
    const {
      createWebMindosPiRuntimeHostServices,
      getMindosWebPiRuntimePaths,
    } = await import('@/lib/agent/mindos-pi-runtime-host');
    const runtimePaths = getMindosWebPiRuntimePaths({
      projectRoot: input.projectRoot,
      mindRoot: input.mindRoot,
      serverSettings: input.serverSettings,
      permissionPolicy: input.permissionPolicy,
    });
    const { createMindosAgentRuntime } = await import('@geminilight/mindos/agent/runtime/adapters/mindos');
    const { runWithKbPermissionPolicy } = await import('@/lib/agent/kb-extension');
    const runtime = await runWithKbPermissionPolicy(input.permissionPolicy, () => createMindosAgentRuntime({
      messages: input.mindosUiMessages,
      systemPrompt,
      turnPrompt: input.turnPrompt,
      providerOverride: input.providerOverride,
      modelOverride: input.modelOverride,
      projectRoot: input.projectRoot,
      agentDir: runtimePaths.agentDir,
      mindRoot: input.mindRoot,
      workDir: input.executionCwd,
      agentConfig: input.agentConfig,
      serverSettings: input.serverSettings,
      additionalSkillPaths: runtimePaths.additionalSkillPaths,
      additionalExtensionPaths: runtimePaths.additionalExtensionPaths,
      allowProjectBash: input.permissionPolicy.toolScope.terminal,
      permissionMode: input.permissionPolicy.permissionMode,
      hostServices: createWebMindosPiRuntimeHostServices(input.serverSettings),
    }));
    systemPrompt = runtime.systemPrompt;
    const {
      session,
      agentRunContextResource,
      llmHistoryMessages,
      lastUserContent,
      lastUserImages,
      fallbackTools,
      turnPrompt,
      contextUsage,
      apiKey,
      modelName,
      provider,
      baseUrl,
    } = runtime;
    const extensionLoadErrors = (runtime as { extensionLoadErrors?: Array<{ path: string; error: string }> }).extensionLoadErrors;
    const extensionLoadStatus = formatMindosPiExtensionLoadStatus(extensionLoadErrors);

    return createAgentTurnSseResponse(async (send) => {
      let outputSummary = '';
      const mainRun = startAgentRun({
        agentKind: 'mindos-main',
        runtimeId: 'mindos',
        displayName: 'MindOS Agent',
        chatSessionId: input.chatSessionId,
        cwd: input.executionCwd,
        permissionMode: input.permissionPolicy.permissionMode,
        inputSummary: typeof lastUserContent === 'string' ? lastUserContent : JSON.stringify(lastUserContent),
        metadata: {
          agentMode: input.agentMode,
          sessionWorkDir: input.sessionWorkDirPath,
          permissionCompilation: {
            requested: input.permissionPolicy.permissionMode,
            applied: input.permissionPolicy.runtimePermissionMode,
            target: 'mindos-pi',
          },
          ...input.sessionContextMetadata,
          ...input.fileContextMetadata,
          sessionSpaces: input.sessionSpaces,
          sessionAssistants: input.sessionAssistants,
          ...(input.assistantId ? { assistantId: input.assistantId } : {}),
        },
      });
      sendAgentRunContext(send, mainRun);
      const sendWithLedger = (event: MindOSSSEvent) => {
        if (event.type === 'text_delta') outputSummary += event.delta;
        appendSseEventToAgentRun(mainRun.id, event);
        send(event);
      };
      if (contextUsage) {
        sendWithLedger(contextUsage);
        if (contextUsage.action !== 'none' && contextUsage.message) {
          sendWithLedger({
            type: 'status',
            runtime: 'mindos',
            visible: true,
            message: contextUsage.message,
          });
        }
      }
      if (extensionLoadStatus) {
        sendWithLedger({
          type: 'status',
          runtime: 'mindos',
          visible: true,
          message: extensionLoadStatus,
        });
      }
      try {
        const agentRunContext = {
          chatSessionId: input.chatSessionId,
          rootRunId: mainRun.rootRunId ?? mainRun.id,
          parentRunId: mainRun.id,
        };
        const restoreAgentRunResourceContext = setAgentRunContextForResource(agentRunContextResource, agentRunContext);
        try {
          await runWithAgentRunContext(agentRunContext, async () => {
            const compatCache = readBaseUrlCompat();
            const effectiveBaseUrlKey = baseUrl || 'default';
            const compatMode = resolveAgentTurnCompatMode({
              provider,
              baseUrl,
              cachedMode: compatCache[effectiveBaseUrlKey],
            });
            const runProxyFallback = () => runMindosNonStreamingFallback({
              baseUrl: baseUrl ?? '',
              apiKey,
              model: modelName,
              systemPrompt,
              historyMessages: llmHistoryMessages,
              userContent: turnPrompt,
              tools: fallbackTools,
              send: sendWithLedger,
              signal: input.requestSignal,
              maxSteps: input.stepLimit,
            });

            const agentRunId = randomUUID();
            await runWithAskUserQuestionBridge({
              runId: agentRunId,
              send: (event) => sendWithLedger(event as unknown as MindOSSSEvent),
            }, () => runMindosPiAgentTurnSession({
              session: {
                subscribe: (callback) => { session.subscribe(callback); },
                prompt: async (prompt, options) => { await session.prompt(prompt, options as any); },
                steer: (message) => session.steer(message),
                abort: () => session.abort(),
              },
              prompt: turnPrompt,
              promptOptions: lastUserImages ? { images: lastUserImages } : undefined,
              stepLimit: input.stepLimit,
              timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
              signal: input.requestSignal,
              provider,
              baseUrl,
              effectiveBaseUrlKey,
              compatMode,
              send: sendWithLedger,
              runFallback: runProxyFallback,
              proxyMessages: {
                proxyCompatMode: input.t.proxyCompatMode,
                proxyCompatDetecting: input.t.proxyCompatDetecting,
                proxyCompatFailed: input.t.proxyCompatFailed,
                proxyCompatAlsoFailed: input.t.proxyCompatAlsoFailed,
              },
              onToolExecution: () => metrics.recordToolExecution(),
              onTokens: (inputTokens, outputTokens) => metrics.recordTokens(inputTokens, outputTokens),
              onStep: (step, maxSteps) => {
                if (process.env.NODE_ENV === 'development') console.log(`[agent-turn] Step ${step}/${maxSteps}`);
              },
              writeCompat: (key, mode) => {
                writeBaseUrlCompat(key, mode);
                console.log(`[agent-turn] Proxy compat detected: ${key} → ${mode} (cached)`);
              },
            }));
          });
        } finally {
          restoreAgentRunResourceContext();
        }
        completeAgentRun(mainRun.id, { outputSummary });
      } catch (error) {
        failAgentRun(mainRun.id, {
          status: agentRunErrorStatus(error, input.requestSignal),
          error,
          outputSummary,
        });
        throw error;
      }
    }, (err) => {
      if (err instanceof Error && (err as any).code === 'TIMEOUT') return input.t.agentTimeout;
      return err instanceof Error ? err.message : String(err);
    });
  } catch (err) {
    console.error('[agent-turn] Failed to initialize model:', err);
    if (err instanceof MindOSError) {
      return apiError(err.code, err.message);
    }
    if ((err as { code?: unknown })?.code === ErrorCodes.INVALID_REQUEST) {
      return apiError(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : 'Invalid ask request', 400);
    }
    return apiError(ErrorCodes.MODEL_INIT_FAILED, err instanceof Error ? err.message : 'Failed to initialize AI model', 500);
  }
}
