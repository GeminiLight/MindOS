import {
  createAcpRuntimeLane,
  runRuntimeLaneTurn,
} from '@geminilight/mindos/agent/runtime';
import { runMindosAcpAgentTurn, resolveMindosAgentTimeoutMs } from '@geminilight/mindos/agent/turn';
import {
  parkAcpSession,
  takePooledAcpSession,
} from '@geminilight/mindos/protocols/acp';
import {
  createSession,
  loadSession,
  promptStream,
  cancelPrompt,
  closeSession,
  setConfigOption,
  setMode,
} from '@/lib/acp/session';
import { createAgentTurnSseResponse } from './turn-sse';
import {
  armAgentRunClientDisconnectCancel,
  type RunAcpRuntimeLaneTurnInput,
} from './turn-lane-shared';

/**
 * ACP lane: a thin HTTP/SSE adapter over the core lane runner
 * (spec-runtime-lane-contract 方案 2). Attachment materialization, env
 * overlay merging, pooled-session acquire/park, runtime-option application
 * and the permission resolver mapping live in the core adapter; this file only
 * injects the web host's session/pool services and the lane seeds.
 *
 * `runMindosAcpAgentTurn` is imported from the package BARREL and injected as
 * a dep so host vi.mock barrel contracts keep intercepting (known-pitfalls
 * barrel-mock rule).
 */
export function runAcpRuntimeLaneTurn(input: RunAcpRuntimeLaneTurnInput): Response {
  const lane = createAcpRuntimeLane({
    agent: input.acpAgent,
    cwd: input.executionCwd,
    prompt: input.externalPrompt,
    attachments: input.runtimeAttachments,
    initialCapsuleBinding: input.capsule.request.runtimeBinding,
    ...(resumableAcpBindingExternalSessionId(input.runtimeBinding)
      ? { resumeExternalSessionId: resumableAcpBindingExternalSessionId(input.runtimeBinding) }
      : {}),
    acpPermissionMode: input.permissionPolicy.acpPermissionMode,
    ...(input.acpRuntimeEnvOverlay ? { envOverlay: input.acpRuntimeEnvOverlay } : {}),
    runtimeOptions: input.acpRuntimeOptions,
    errorMessage: (error) => ((error as { code?: unknown }).code === 'TIMEOUT'
      ? input.t.agentTimeout
      : `ACP Agent Error: ${error.message}`),
  }, {
    runAcpTurn: runMindosAcpAgentTurn,
    createSession: (agentId, options) => createSession(agentId, options),
    loadSession: (agentId, externalSessionId, options) => loadSession(agentId, externalSessionId, options),
    promptStream: async (sessionId, prompt, onUpdate, options) => {
      await promptStream(sessionId, prompt, onUpdate, options);
    },
    cancelPrompt: (sessionId) => cancelPrompt(sessionId),
    closeSession: (sessionId, options) => closeSession(sessionId, options),
    setMode: (sessionId, modeId) => setMode(sessionId, modeId),
    setConfigOption: async (sessionId, configId, value) => {
      await setConfigOption(sessionId, configId, value);
    },
    takePooledSession: (key) => takePooledAcpSession(key),
    parkPooledSession: (sessionId, key) => parkAcpSession(sessionId, key),
  });

  const permissionCompilation = {
    requested: input.agentModeContract.requestedPermissionMode ?? input.permissionPolicy.permissionMode,
    applied: input.permissionPolicy.acpPermissionMode,
    target: 'acp',
  };

  return createAgentTurnSseResponse((send) => runRuntimeLaneTurn(lane, {
    chatSessionId: input.chatSessionId,
    requestSignal: input.requestSignal,
    timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
    ledger: {
      agentKind: 'acp',
      runtimeId: input.acpAgent.id,
      displayName: input.acpAgent.name,
      permissionMode: input.permissionPolicy.permissionMode,
      inputSummary: input.externalPrompt,
      metadata: {
        agentMode: input.agentMode,
        agentModeContract: input.agentModeContract,
        source: 'selected-acp-runtime',
        phase: 'create_session',
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
      source: 'selected-acp-runtime',
      permissionCompilation,
      ...input.sessionContextMetadata,
      ...input.fileContextMetadata,
      ...input.retrievalMetadata,
    },
    failureMetadata: { source: 'selected-acp-runtime' },
    disconnect: { arm: armAgentRunClientDisconnectCancel },
  }, send), (err) => {
    if (err instanceof Error && (err as { code?: unknown }).code === 'TIMEOUT') return input.t.agentTimeout;
    return err instanceof Error ? err.message : String(err);
  });
}

function resumableAcpBindingExternalSessionId(binding: RunAcpRuntimeLaneTurnInput['runtimeBinding']): string | undefined {
  if (binding?.runtime !== 'acp' || binding.kind !== 'acp-session') return undefined;
  if (binding.status && binding.status !== 'active') return undefined;
  return binding.externalSessionId?.trim() || undefined;
}
