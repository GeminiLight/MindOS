import {
  appendMindosRuntimeAttachmentPathContext,
  materializeMindosRuntimeAttachments,
} from '@geminilight/mindos/agent/runtime';
import { randomUUID } from 'crypto';
import type {
  MindosRuntimePermissionOption,
  MindosRuntimePermissionResult,
} from '@geminilight/mindos/agent/runtime';
import { appendSseEventToAgentRun } from '@geminilight/mindos/agent';
import {
  resolveMindosAgentTimeoutMs,
  runMindosAcpAgentTurn,
  type MindOSSSEvent,
} from '@geminilight/mindos/agent/turn';
import {
  requestRuntimePermissionViaBridge,
  runWithRuntimePermissionBridge,
} from '@geminilight/mindos/agent/bridges/runtime-permission-bridge';
import type {
  AcpClientCallbacks,
  AcpPermissionEvent,
} from '@geminilight/mindos/protocols/acp';
import { runWithAgentRunContext } from '@geminilight/mindos/agent/agent-run-context';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
  updateAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  createSession,
  loadSession,
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
  const runtimeRunId = randomUUID();
  const sendWithLedger = (event: MindOSSSEvent) => {
    if (event.type === 'text_delta') outputSummary += event.delta;
    appendSseEventToAgentRun(acpRun.id, event);
    send(event);
  };
  sendAgentRunContext(send, acpRun);
  const acpResult = await runWithAgentRunContext(
    {
      chatSessionId: input.chatSessionId,
      rootRunId: acpRun.rootRunId ?? acpRun.id,
      parentRunId: acpRun.id,
    },
    () => runWithRuntimePermissionBridge(
      {
        runId: runtimeRunId,
        send: sendWithLedger,
      },
      () => runMindosAcpAgentTurn({
        agentId: selectedAcpAgent.id,
        cwd: input.executionCwd,
        prompt: acpPrompt,
        signal: input.requestSignal,
        permissionRunId: runtimeRunId,
        createSession: async (agentId, options) => {
          const session = await createSession(agentId, acpSessionOptions(
            input,
            options,
            createAcpPermissionResolver(input.requestSignal),
          ));
          await applyAcpRuntimeOptions(session.id, input.acpRuntimeOptions);
          return session;
        },
        loadSession: async (agentId, existingSessionId, options) => {
          const session = await loadSession(agentId, existingSessionId, acpSessionOptions(
            input,
            options,
            createAcpPermissionResolver(input.requestSignal),
          ));
          await applyAcpRuntimeOptions(session.id, input.acpRuntimeOptions);
          return session;
        },
        externalSessionId: resumableAcpBindingExternalSessionId(input.runtimeBinding),
        onSessionReady: (session, details) => {
          updateAgentRun(acpRun.id, {
            archive: { sessionId: details.externalSessionId ?? session.id },
            metadata: {
              phase: 'prompt',
              sessionId: session.id,
              resumed: details.resumed,
              ...(details.externalSessionId ? { externalSessionId: details.externalSessionId } : {}),
            },
          });
        },
        timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
        hasContent: () => hasContent,
        onVisibleContent: () => { hasContent = true; },
        send: sendWithLedger,
        promptStream: async (sessionId, prompt, onUpdate) => {
          await promptStream(sessionId, prompt, onUpdate);
        },
        cancelPrompt,
        closeSession,
        errorMessage: (error) => ((error as any).code === 'TIMEOUT'
          ? input.t.agentTimeout
          : `ACP Agent Error: ${error.message}`),
      }),
    ),
  )
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

function acpSessionOptions(
  input: RunAcpRuntimeLaneTurnInput,
  options: { cwd: string; permissionMode?: 'readonly' | 'ask' | 'auto' | 'full'; env?: Record<string, string | undefined> },
  resolvePermissionRequest?: AcpClientCallbacks['resolvePermissionRequest'],
) {
  const { env: optionRawEnv, ...baseOptions } = options;
  const optionEnv = compactStringEnv(optionRawEnv);
  const mergedEnv = compactStringEnv({ ...(input.acpRuntimeEnvOverlay ?? {}), ...(optionEnv ?? {}) });
  return {
    ...baseOptions,
    ...(mergedEnv ? { env: mergedEnv } : {}),
    permissionMode: input.permissionPolicy.acpPermissionMode,
    ...(resolvePermissionRequest ? { resolvePermissionRequest } : {}),
  };
}

function createAcpPermissionResolver(signal: AbortSignal): NonNullable<AcpClientCallbacks['resolvePermissionRequest']> {
  return async ({ event, params }) => {
    const result = await requestRuntimePermissionViaBridge({
      runtime: 'acp',
      toolCallId: event.toolCallId || event.requestId,
      toolName: event.toolName || 'ACP tool',
      input: params.toolCall ?? {},
      options: acpPermissionEventOptionsToRuntimeOptions(event),
      reason: 'ACP adapter requested permission for a tool call.',
    }, {
      signal,
      requestId: event.requestId,
      emitRequest: false,
      emitResolved: false,
    });
    return acpPermissionResponseFromRuntimeResult(event, result);
  };
}

function acpPermissionEventOptionsToRuntimeOptions(event: AcpPermissionEvent): MindosRuntimePermissionOption[] {
  if (event.options.length === 0) {
    return [{ id: 'cancel', label: 'Cancel', intent: 'cancel', scope: 'once' }];
  }
  return event.options.map((option) => ({
    id: option.id,
    label: option.label,
    intent: option.kind.startsWith('reject') ? 'deny' : 'allow',
    scope: option.kind.endsWith('_always') ? 'session' : 'once',
  }));
}

function acpPermissionResponseFromRuntimeResult(
  event: AcpPermissionEvent,
  result: MindosRuntimePermissionResult,
): Awaited<ReturnType<NonNullable<AcpClientCallbacks['resolvePermissionRequest']>>> {
  if (result.cancelled || result.decisionIntent === 'cancel') {
    return { outcome: { outcome: 'cancelled' } };
  }
  const exact = event.options.find((option) => option.id === result.decision);
  if (exact) return { outcome: { outcome: 'selected', optionId: exact.id } };
  const wantsDeny = result.decisionIntent === 'deny';
  const wantsAlways = result.decisionScope === 'always' || result.decisionScope === 'session';
  const selected = wantsDeny
    ? event.options.find((option) => option.kind === (wantsAlways ? 'reject_always' : 'reject_once')) ??
      event.options.find((option) => option.kind.startsWith('reject'))
    : event.options.find((option) => option.kind === (wantsAlways ? 'allow_always' : 'allow_once')) ??
      event.options.find((option) => option.kind.startsWith('allow'));
  return selected
    ? { outcome: { outcome: 'selected', optionId: selected.id } }
    : { outcome: { outcome: 'cancelled' } };
}

function resumableAcpBindingExternalSessionId(binding: RunAcpRuntimeLaneTurnInput['runtimeBinding']): string | undefined {
  if (binding?.runtime !== 'acp' || binding.kind !== 'acp-session') return undefined;
  if (binding.status && binding.status !== 'active') return undefined;
  return binding.externalSessionId?.trim() || undefined;
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
