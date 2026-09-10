import { randomUUID } from 'crypto';
import { runMindosNativeAgentTurn } from '@geminilight/mindos/agent/runtime';
import type { MindosAgentRuntimeSelection } from '@geminilight/mindos/agent/runtime';
import { appendSseEventToAgentRun } from '@geminilight/mindos/agent';
import {
  resolveMindosAgentTimeoutMs,
  type MindOSSSEvent,
} from '@geminilight/mindos/agent/turn';
import {
  askUserQuestionViaBridge,
  runWithAskUserQuestionBridge,
} from '@geminilight/mindos/agent/bridges/user-question-bridge';
import {
  requestRuntimePermissionViaBridge,
  runWithRuntimePermissionBridge,
} from '@geminilight/mindos/agent/bridges/runtime-permission-bridge';
import { runWithAgentRunContext } from '@geminilight/mindos/agent/agent-run-context';
import {
  completeAgentRun,
  failAgentRun,
  startAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  appendMindosAgentModeRunEvents,
  createMindosAgentModeRunArtifacts,
  mindosAgentModeArtifactsMetadata,
} from '@geminilight/mindos/agent/mode-run-events';
import type { AgentRunStatus } from '@geminilight/mindos/agent/ledger/run-ledger-types';
import type { MindosAgentModeContract } from '@geminilight/mindos/agent/mode';
import {
  registerAgentRunCancelHandler,
} from '@geminilight/mindos/agent/ledger/run-cancellation';
import {
  createClaudePermissionPromptConfig,
  resolveRuntimePermissionBaseUrl,
} from '@/lib/agent/claude-permission-prompt';
import {
  agentRunErrorStatus,
  createAgentTurnSseResponse,
  sendAgentRunContext,
} from './turn-sse';
import type { AgentTurnRequestContext } from './turn-request';
import { armAgentRunClientDisconnectCancel, type RunNativeRuntimeLaneTurnInput } from './turn-lane-shared';
import {
  capsuleRuntimeBinding,
  captureAgentTurnCapsule,
  finalizeAgentTurnCapsule,
} from './turn-capsule';

export function runNativeRuntimeLaneTurn(input: RunNativeRuntimeLaneTurnInput): Response {
  return createAgentTurnSseResponse((send) => runWithAgentRunContext({ chatSessionId: input.chatSessionId }, async () => {
    await runNativeRuntimeTurn(input, input.nativeRuntime, send);
  }), (err) => {
    if (err instanceof Error && (err as any).code === 'TIMEOUT') return input.t.agentTimeout;
    return err instanceof Error ? err.message : String(err);
  });
}

async function runNativeRuntimeTurn(
  input: RunNativeRuntimeLaneTurnInput,
  nativeRuntime: MindosAgentRuntimeSelection,
  send: (event: MindOSSSEvent) => void,
): Promise<void> {
  const runtimeRunId = randomUUID();
  let outputSummary = '';
  let streamedError: Error | undefined;
  const nativeRun = startAgentRun({
    ...(input.capsule.runId ? { id: input.capsule.runId } : {}),
    agentKind: 'native-runtime',
    runtimeId: nativeRuntime.id,
    displayName: nativeRuntime.name,
    cwd: input.executionCwd,
    permissionMode: input.nativePermissionMode,
    inputSummary: input.externalPrompt,
    metadata: {
      agentMode: input.agentMode,
      agentModeContract: input.agentModeContract,
      runtimeKind: nativeRuntime.kind,
      source: 'selected-native-runtime',
      permissionCompilation: {
        requested: input.agentModeContract.requestedPermissionMode ?? input.nativePermissionMode,
        applied: input.permissionPolicy.runtimePermissionMode,
        target: nativeRuntime.kind,
      },
      ...input.sessionContextMetadata,
      ...input.fileContextMetadata,
      ...input.retrievalMetadata,
      sessionWorkDir: input.sessionWorkDir.path,
      sessionSpaces: input.sessionContextSelection.spaces.map((space) => space.path),
      sessionAssistants: input.sessionContextSelection.assistants.map((assistant) => assistant.id),
      ...(input.assistantId ? { assistantId: input.assistantId } : {}),
    },
  });
  captureAgentTurnCapsule(nativeRun, input.capsule);
  const nativeRunAbort = new AbortController();
  const nativeRunSignal = nativeRunAbort.signal;
  const unregisterCancelHandler = registerAgentRunCancelHandler(nativeRun.id, ({ reason }) => {
    if (nativeRunSignal.aborted) return;
    nativeRunAbort.abort(cancelReasonToAbortError(reason));
  });
  // The request signal is deliberately not linked to the run: a dropped SSE
  // stream must be reattachable. A client that never comes back cancels the
  // run after the disconnect grace instead of holding the runtime until the
  // 600 s timeout.
  const releaseDisconnectGrace = armAgentRunClientDisconnectCancel({
    runId: nativeRun.id,
    rootRunId: nativeRun.rootRunId ?? nativeRun.id,
    requestSignal: input.requestSignal,
  });
  const sendWithLedger = (event: MindOSSSEvent) => {
    if (event.type === 'text_delta') outputSummary += event.delta;
    if (event.type === 'error') streamedError = new Error(event.message);
    appendSseEventToAgentRun(nativeRun.id, event);
    send(event);
  };
  sendAgentRunContext(send, nativeRun);
  try {
    const result = await runWithAgentRunContext({
      chatSessionId: input.chatSessionId,
      rootRunId: nativeRun.rootRunId ?? nativeRun.id,
      parentRunId: nativeRun.id,
    }, () => (
      runWithRuntimePermissionBridge({
        runId: runtimeRunId,
        send: sendWithLedger,
      }, () => runWithAskUserQuestionBridge({
        runId: runtimeRunId,
        send: (event) => sendWithLedger(event as unknown as MindOSSSEvent),
      }, () => runMindosNativeAgentTurn({
        runtime: nativeRuntime,
        cwd: input.executionCwd,
        prompt: input.externalPrompt,
        attachments: input.runtimeAttachments,
        selectedSkills: input.selectedSkills,
        permissionMode: input.nativePermissionMode,
        agentMode: input.agentModeContract.mode,
        ...(input.nativeRuntimeOptions.modelOverride ? { modelOverride: input.nativeRuntimeOptions.modelOverride } : {}),
        ...(input.nativeRuntimeOptions.reasoningEffort ? { reasoningEffort: input.nativeRuntimeOptions.reasoningEffort } : {}),
        timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
        ...(input.nativeRuntimeEnv ? { runtimeEnv: input.nativeRuntimeEnv } : {}),
        signal: nativeRunSignal,
        send: sendWithLedger,
        services: {
          ...(nativeRuntime.kind === 'claude' ? {
            createClaudePermissionPrompt: () => createClaudePermissionPromptConfig({
              runId: runtimeRunId,
              baseUrl: resolveRuntimePermissionBaseUrlForAgentTurnContext(input.requestContext),
            }),
          } : {}),
          requestRuntimePermission: requestRuntimePermissionViaBridge,
          requestUserQuestion: (request, callOptions) => askUserQuestionViaBridge({
            toolCallId: request.toolCallId,
            params: { questions: request.questions },
            signal: callOptions?.signal,
          }),
        },
      }))
    )));
    // Some adapters emit a terminal error but return a session binding without
    // an error field. Preserve that failure instead of recording false success.
    const terminalError = result.error ?? streamedError;
    if (terminalError) {
      const terminalStatus = agentRunErrorStatus(terminalError, nativeRunSignal);
      const modeArtifacts = recordModeArtifacts(
        nativeRun.id,
        input.agentModeContract,
        outputSummary,
        terminalStatus,
      );
      failAgentRun(nativeRun.id, {
        status: terminalStatus,
        error: terminalError,
        outputSummary,
        ...(result.externalSessionId ? { archive: { sessionId: result.externalSessionId } } : {}),
        metadata: {
          ...mindosAgentModeArtifactsMetadata(modeArtifacts),
          runtimeKind: nativeRuntime.kind,
          ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
        },
      });
      finalizeAgentTurnCapsule({
        mindRoot: input.capsule.mindRoot,
        runId: nativeRun.id,
        status: terminalStatus,
        outputText: outputSummary,
        ...(result.externalSessionId ? {
          runtimeBinding: capsuleRuntimeBinding({
            kind: nativeRuntime.kind,
            runtimeId: nativeRuntime.id,
            externalSessionId: result.externalSessionId,
            cwd: input.executionCwd,
          }),
        } : {}),
      });
      return;
    }
    const modeArtifacts = recordModeArtifacts(
      nativeRun.id,
      input.agentModeContract,
      outputSummary,
      'completed',
    );
    completeAgentRun(nativeRun.id, {
      outputSummary,
      ...(result.externalSessionId ? { archive: { sessionId: result.externalSessionId } } : {}),
      metadata: {
        ...mindosAgentModeArtifactsMetadata(modeArtifacts),
        runtimeKind: nativeRuntime.kind,
        permissionCompilation: {
          requested: input.agentModeContract.requestedPermissionMode ?? input.nativePermissionMode,
          applied: input.permissionPolicy.runtimePermissionMode,
          target: nativeRuntime.kind,
        },
        ...input.sessionContextMetadata,
        ...input.fileContextMetadata,
        ...input.retrievalMetadata,
        ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
      },
    });
    finalizeAgentTurnCapsule({
      mindRoot: input.capsule.mindRoot,
      runId: nativeRun.id,
      status: 'completed',
      outputText: outputSummary,
      ...(result.externalSessionId ? {
        runtimeBinding: capsuleRuntimeBinding({
          kind: nativeRuntime.kind,
          runtimeId: nativeRuntime.id,
          externalSessionId: result.externalSessionId,
          cwd: input.executionCwd,
        }),
      } : {}),
    });
  } catch (error) {
    const terminalStatus = agentRunErrorStatus(error, nativeRunSignal);
    const modeArtifacts = recordModeArtifacts(
      nativeRun.id,
      input.agentModeContract,
      outputSummary,
      terminalStatus,
    );
    failAgentRun(nativeRun.id, {
      status: terminalStatus,
      error,
      outputSummary,
      metadata: {
        ...mindosAgentModeArtifactsMetadata(modeArtifacts),
        runtimeKind: nativeRuntime.kind,
      },
    });
    finalizeAgentTurnCapsule({
      mindRoot: input.capsule.mindRoot,
      runId: nativeRun.id,
      status: terminalStatus,
      outputText: outputSummary,
    });
    throw error;
  } finally {
    releaseDisconnectGrace();
    unregisterCancelHandler();
  }
}

function recordModeArtifacts(
  runId: string,
  contract: MindosAgentModeContract,
  outputSummary: string,
  runStatus: AgentRunStatus,
) {
  const artifacts = createMindosAgentModeRunArtifacts({
    contract,
    outputSummary,
    runStatus,
  });
  appendMindosAgentModeRunEvents(runId, artifacts);
  return artifacts;
}

function cancelReasonToAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const message = typeof reason === 'string' && reason.trim()
    ? reason
    : 'Agent run was canceled.';
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function resolveRuntimePermissionBaseUrlForAgentTurnContext(context: AgentTurnRequestContext): string {
  if (context.request) return resolveRuntimePermissionBaseUrl(context.request);
  if (process.env.MINDOS_INTERNAL_URL || process.env.MINDOS_URL || process.env.MINDOS_WEB_PORT) {
    return resolveRuntimePermissionBaseUrl(new Request('http://127.0.0.1/'));
  }
  throw new Error('Agent turn runner request context must include the original request for Claude Code permission callbacks.');
}
