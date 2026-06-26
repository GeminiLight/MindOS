import {
  appendMindosRuntimeAttachmentPathContext,
  materializeMindosRuntimeAttachments,
} from '@geminilight/mindos/agent/runtime';
import { appendSseEventToAgentRun } from '@geminilight/mindos/agent';
import {
  resolveMindosAgentTimeoutMs,
  runMindosAcpAgentTurn,
  type MindOSSSEvent,
} from '@geminilight/mindos/agent/turn';
import { runWithAgentRunContext } from '@geminilight/mindos/agent/agent-run-context';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
  updateAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  createSession,
  promptStream,
  cancelPrompt,
  closeSession,
  setConfigOption,
  setMode,
} from '@/lib/acp/session';
import {
  agentRunErrorStatus,
  compactStringEnv,
  createAgentTurnSseResponse,
  sendAgentRunContext,
} from './turn-sse';
import type { RunAcpRuntimeLaneTurnInput } from './turn-lane-shared';

export function runAcpRuntimeLaneTurn(input: RunAcpRuntimeLaneTurnInput): Response {
  return createAgentTurnSseResponse((send) => runWithAgentRunContext({ chatSessionId: input.chatSessionId }, async () => {
    await runAcpRuntimeTurn(input, input.acpAgent, send);
  }), (err) => {
    if (err instanceof Error && (err as any).code === 'TIMEOUT') return input.t.agentTimeout;
    return err instanceof Error ? err.message : String(err);
  });
}

async function runAcpRuntimeTurn(
  input: RunAcpRuntimeLaneTurnInput,
  selectedAcpAgent: { id: string; name: string },
  send: (event: MindOSSSEvent) => void,
): Promise<void> {
  const materializedAttachments = await materializeMindosRuntimeAttachments(input.runtimeAttachments);
  const acpPrompt = appendMindosRuntimeAttachmentPathContext(
    input.externalPrompt,
    materializedAttachments.attachments,
    { includeImages: true },
  );
  let hasContent = false;
  let outputSummary = '';
  const acpRun = startAgentRun({
    agentKind: 'acp',
    runtimeId: selectedAcpAgent.id,
    displayName: selectedAcpAgent.name,
    cwd: input.executionCwd,
    permissionMode: input.permissionPolicy.permissionMode,
    inputSummary: input.externalPrompt,
    metadata: {
      agentMode: input.agentMode,
      source: 'selected-acp-runtime',
      phase: 'create_session',
      permissionCompilation: {
        requested: input.permissionPolicy.permissionMode,
        applied: input.permissionPolicy.acpPermissionMode,
        target: 'acp',
      },
      ...input.sessionContextMetadata,
      ...input.fileContextMetadata,
      sessionWorkDir: input.sessionWorkDir.path,
      sessionSpaces: input.sessionContextSelection.spaces.map((space) => space.path),
      sessionAssistants: input.sessionContextSelection.assistants.map((assistant) => assistant.id),
      ...(input.assistantId ? { assistantId: input.assistantId } : {}),
    },
  });
  sendAgentRunContext(send, acpRun);
  const acpResult = await runWithAgentRunContext({
    chatSessionId: input.chatSessionId,
    rootRunId: acpRun.rootRunId ?? acpRun.id,
    parentRunId: acpRun.id,
  }, () => (
    runMindosAcpAgentTurn({
      agentId: selectedAcpAgent.id,
      cwd: input.executionCwd,
      prompt: acpPrompt,
      signal: input.requestSignal,
      permissionRunId: acpRun.id,
      createSession: async (agentId, options) => {
        const optionEnv = compactStringEnv((options as { env?: Record<string, string | undefined> } | undefined)?.env);
        const mergedEnv = compactStringEnv({ ...(input.acpRuntimeEnvOverlay ?? {}), ...(optionEnv ?? {}) });
        const session = await createSession(agentId, {
          ...options,
          ...(mergedEnv ? { env: mergedEnv } : {}),
          permissionMode: input.permissionPolicy.acpPermissionMode,
        });
        await applyAcpRuntimeOptions(session.id, input.acpRuntimeOptions);
        updateAgentRun(acpRun.id, {
          archive: { sessionId: session.id },
          metadata: {
            phase: 'prompt',
            sessionId: session.id,
          },
        });
        return session;
      },
      timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
      hasContent: () => hasContent,
      onVisibleContent: () => { hasContent = true; },
      send: (event) => {
        if (event.type === 'text_delta') outputSummary += event.delta;
        appendSseEventToAgentRun(acpRun.id, event);
        send(event);
      },
      promptStream: async (sessionId, prompt, onUpdate) => {
        await promptStream(sessionId, prompt, onUpdate);
      },
      cancelPrompt,
      closeSession,
      errorMessage: (error) => ((error as any).code === 'TIMEOUT'
        ? input.t.agentTimeout
        : `ACP Agent Error: ${error.message}`),
    })
  ))
    .catch((error) => {
      failAgentRun(acpRun.id, {
        status: agentRunErrorStatus(error, input.requestSignal),
        error,
        outputSummary,
      });
      throw error;
    })
    .finally(async () => {
      await materializedAttachments.cleanup();
    });
  if (acpResult.error) {
    failAgentRun(acpRun.id, {
      status: agentRunErrorStatus(acpResult.error, input.requestSignal),
      error: acpResult.error,
      outputSummary,
    });
  } else {
    completeAgentRun(acpRun.id, { outputSummary });
  }
}

async function applyAcpRuntimeOptions(sessionId: string, options: RunAcpRuntimeLaneTurnInput['acpRuntimeOptions']): Promise<void> {
  if (options.modeId) {
    await setMode(sessionId, options.modeId);
  }
  const configValues = options.configValues ?? {};
  for (const [configId, value] of Object.entries(configValues)) {
    if (!configId.trim() || !value.trim()) continue;
    await setConfigOption(sessionId, configId, value);
  }
}
