import { MindOSError, apiError, ErrorCodes } from '@/lib/errors';
import { metrics } from '@/lib/metrics';
import { type ServerSettings } from '@/lib/settings';
import type { MindosAgentModeContract } from '@geminilight/mindos/agent/mode';
import {
  resolveMindosAgentTimeoutMs,
  type MindosUiAgentMessage,
} from '@geminilight/mindos/agent/turn';
import {
  runMindosPiAgentTurnSession,
} from '@geminilight/mindos/agent/mindos-pi';
import {
  createMindosPiRuntimeLane,
  runRuntimeLaneTurn,
} from '@geminilight/mindos/agent/runtime';
import { createMindosAgentPermissionPolicy } from '@geminilight/mindos/agent/mindos-pi/permission';
import { getSessionDir } from '@/lib/pi-integration/session-store';
import { createAgentTurnSseResponse } from './turn-sse';
import type { AgentTurnCapsuleSeed } from './turn-capsule';
import {
  armAgentRunClientDisconnectCancel,
} from './turn-lane-shared';

type PermissionPolicy = ReturnType<typeof createMindosAgentPermissionPolicy>;

type MindosPiTurnLocalization = {
  agentTimeout: string;
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
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    thinkingBudget: number;
    contextStrategy: 'auto' | 'off';
  };
  serverSettings: ServerSettings;
  permissionPolicy: PermissionPolicy;
  chatSessionId?: string;
  agentMode: string;
  agentModeContract: MindosAgentModeContract;
  sessionContextMetadata: Record<string, unknown>;
  fileContextMetadata: Record<string, unknown>;
  retrievalMetadata: Record<string, unknown>;
  sessionWorkDirPath: string;
  sessionSpaces: string[];
  sessionAssistants: string[];
  assistantId?: string;
  requestSignal: AbortSignal;
  stepLimit: number;
  t: MindosPiTurnLocalization;
  capsule: AgentTurnCapsuleSeed;
};

/**
 * Embedded Pi lane: a thin HTTP/SSE adapter over the core lane runner
 * (spec-runtime-lane-contract 方案 2). The runtime is created BEFORE the SSE
 * shell so initialization failures stay JSON apiErrors (never half-opened
 * streams); the ledger / capsule / grace / terminal lifecycle lives in
 * `runRuntimeLaneTurn`, and pre-run frames and runtime adaptation live in
 * the core adapter with the web host deps injected below.
 *
 * `runMindosPiAgentTurnSession` is imported
 * from the package BARRELS and injected as deps so host vi.mock barrel
 * contracts keep intercepting (known-pitfalls barrel-mock rule).
 */
export async function runMindosPiTurn(input: RunMindosPiTurnInput): Promise<Response> {
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
      systemPrompt: input.systemPrompt,
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
      ...(input.chatSessionId ? { runtimeSession: { sessionDir: getSessionDir(input.chatSessionId) } } : {}),
      hostServices: createWebMindosPiRuntimeHostServices(input.serverSettings),
    }));

    // The runtime returns the post-compaction turn prompt; the lane runs it.
    const turnPrompt = runtime.turnPrompt;
    const lane = createMindosPiRuntimeLane({
      runtime,
      prompt: turnPrompt,
      cwd: input.executionCwd,
      stepLimit: input.stepLimit,
      thinkingLevel: input.agentConfig.thinkingLevel,
    }, {
      runPiSession: runMindosPiAgentTurnSession,
      recordToolExecution: () => metrics.recordToolExecution(),
      recordTokens: (inputTokens, outputTokens) => metrics.recordTokens(inputTokens, outputTokens),
      onStep: (step, maxSteps) => {
        if (process.env.NODE_ENV === 'development') console.log(`[agent-turn] Step ${step}/${maxSteps}`);
      },
    });
    const session = await lane.open({});
    const lastUserContent = runtime.lastUserContent;

    return createAgentTurnSseResponse((send) => runRuntimeLaneTurn(lane, {
      chatSessionId: input.chatSessionId,
      requestSignal: input.requestSignal,
      timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
      session,
      ledger: {
        agentKind: 'mindos-main',
        runtimeId: 'mindos',
        displayName: 'MindOS Agent',
        permissionMode: input.permissionPolicy.permissionMode,
        inputSummary: typeof lastUserContent === 'string' ? lastUserContent : JSON.stringify(lastUserContent),
        metadata: {
          agentMode: input.agentMode,
          agentModeContract: input.agentModeContract,
          sessionWorkDir: input.sessionWorkDirPath,
          permissionCompilation: {
            requested: input.agentModeContract.requestedPermissionMode ?? input.permissionPolicy.permissionMode,
            applied: input.permissionPolicy.runtimePermissionMode,
            target: 'mindos-pi',
          },
          ...input.sessionContextMetadata,
          ...input.fileContextMetadata,
          ...input.retrievalMetadata,
          sessionSpaces: input.sessionSpaces,
          sessionAssistants: input.sessionAssistants,
          ...(input.assistantId ? { assistantId: input.assistantId } : {}),
        },
      },
      capsule: input.capsule,
      modeContract: input.agentModeContract,
      disconnect: { arm: armAgentRunClientDisconnectCancel },
    }, send), (err) => {
      if (err instanceof Error && (err as { code?: unknown }).code === 'TIMEOUT') return input.t.agentTimeout;
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
