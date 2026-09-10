import {
  createNativeRuntimeLane,
  runMindosNativeAgentTurn,
  runRuntimeLaneTurn,
} from '@geminilight/mindos/agent/runtime';
import { resolveMindosAgentTimeoutMs } from '@geminilight/mindos/agent/turn';
import {
  createClaudePermissionPromptConfig,
  resolveRuntimePermissionBaseUrl,
} from '@/lib/agent/claude-permission-prompt';
import { createAgentTurnSseResponse } from './turn-sse';
import type { AgentTurnRequestContext } from './turn-request';
import {
  armAgentRunClientDisconnectCancel,
  type RunNativeRuntimeLaneTurnInput,
} from './turn-lane-shared';

/**
 * Native (codex / claude) lane: a thin HTTP/SSE adapter over the core lane
 * runner (spec-runtime-lane-contract 方案 2). The ledger / capsule / grace /
 * terminal-classification lifecycle lives in `runRuntimeLaneTurn`; this file
 * only assembles the adapter, the lane seeds and the SSE shell.
 *
 * `runMindosNativeAgentTurn` is imported from the package BARREL and injected
 * as a dep: host tests mock the barrel module id, and a core-internal leaf
 * import would bypass those mocks (known-pitfalls barrel-mock rule).
 */
export function runNativeRuntimeLaneTurn(input: RunNativeRuntimeLaneTurnInput): Response {
  const lane = createNativeRuntimeLane({
    runtime: input.nativeRuntime,
    cwd: input.executionCwd,
    prompt: input.externalPrompt,
    attachments: input.runtimeAttachments,
    selectedSkills: input.selectedSkills,
    permissionMode: input.nativePermissionMode,
    agentMode: input.agentModeContract.mode,
    ...(input.nativeRuntimeOptions.modelOverride ? { modelOverride: input.nativeRuntimeOptions.modelOverride } : {}),
    ...(input.nativeRuntimeOptions.reasoningEffort ? { reasoningEffort: input.nativeRuntimeOptions.reasoningEffort } : {}),
    ...(input.nativeRuntimeEnv ? { runtimeEnv: input.nativeRuntimeEnv } : {}),
    createClaudePermissionPrompt: ({ permissionRunId }) => () => createClaudePermissionPromptConfig({
      runId: permissionRunId,
      baseUrl: resolveRuntimePermissionBaseUrlForAgentTurnContext(input.requestContext),
    }),
  }, {
    runTurn: runMindosNativeAgentTurn,
  });

  const permissionCompilation = {
    requested: input.agentModeContract.requestedPermissionMode ?? input.nativePermissionMode,
    applied: input.permissionPolicy.runtimePermissionMode,
    target: input.nativeRuntime.kind,
  };

  return createAgentTurnSseResponse((send) => runRuntimeLaneTurn(lane, {
    chatSessionId: input.chatSessionId,
    requestSignal: input.requestSignal,
    timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
    ledger: {
      agentKind: 'native-runtime',
      runtimeId: input.nativeRuntime.id,
      displayName: input.nativeRuntime.name,
      permissionMode: input.nativePermissionMode,
      inputSummary: input.externalPrompt,
      metadata: {
        agentMode: input.agentMode,
        agentModeContract: input.agentModeContract,
        runtimeKind: input.nativeRuntime.kind,
        source: 'selected-native-runtime',
        permissionCompilation,
        ...input.sessionContextMetadata,
        ...input.fileContextMetadata,
        ...input.retrievalMetadata,
        sessionWorkDir: input.sessionWorkDir.path,
        sessionSpaces: input.sessionContextSelection.spaces.map((space) => space.path),
        sessionAssistants: input.sessionContextSelection.assistants.map((assistant) => assistant.id),
        ...(input.assistantId ? { assistantId: input.assistantId } : {}),
      },
    },
    capsule: input.capsule,
    modeContract: input.agentModeContract,
    completionMetadata: {
      permissionCompilation,
      ...input.sessionContextMetadata,
      ...input.fileContextMetadata,
      ...input.retrievalMetadata,
    },
    disconnect: { arm: armAgentRunClientDisconnectCancel },
  }, send), (err) => {
    if (err instanceof Error && (err as { code?: unknown }).code === 'TIMEOUT') return input.t.agentTimeout;
    return err instanceof Error ? err.message : String(err);
  });
}

function resolveRuntimePermissionBaseUrlForAgentTurnContext(context: AgentTurnRequestContext): string {
  if (context.request) return resolveRuntimePermissionBaseUrl(context.request);
  if (process.env.MINDOS_INTERNAL_URL || process.env.MINDOS_URL || process.env.MINDOS_WEB_PORT) {
    return resolveRuntimePermissionBaseUrl(new Request('http://127.0.0.1/'));
  }
  throw new Error('Agent turn runner request context must include the original request for Claude Code permission callbacks.');
}
