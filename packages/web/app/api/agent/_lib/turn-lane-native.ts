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
  createClaudePermissionPromptConfig,
  resolveRuntimePermissionBaseUrl,
} from '@/lib/agent/claude-permission-prompt';
import {
  agentRunErrorStatus,
  createAgentTurnSseResponse,
  sendAgentRunContext,
} from './turn-sse';
import type { AgentTurnRequestContext } from './turn-request';
import type { RunNativeRuntimeLaneTurnInput } from './turn-lane-shared';

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
  const nativeRun = startAgentRun({
    agentKind: 'native-runtime',
    runtimeId: nativeRuntime.id,
    displayName: nativeRuntime.name,
    cwd: input.executionCwd,
    permissionMode: input.nativePermissionMode,
    inputSummary: input.externalPrompt,
    metadata: {
      agentMode: input.agentMode,
      runtimeKind: nativeRuntime.kind,
      source: 'selected-native-runtime',
      permissionCompilation: {
        requested: input.nativePermissionMode,
        applied: input.permissionPolicy.runtimePermissionMode,
        target: nativeRuntime.kind,
      },
      ...input.sessionContextMetadata,
      ...input.fileContextMetadata,
      sessionWorkDir: input.sessionWorkDir.path,
      sessionSpaces: input.sessionContextSelection.spaces.map((space) => space.path),
      sessionAssistants: input.sessionContextSelection.assistants.map((assistant) => assistant.id),
      ...(input.assistantId ? { assistantId: input.assistantId } : {}),
    },
  });
  const sendWithLedger = (event: MindOSSSEvent) => {
    if (event.type === 'text_delta') outputSummary += event.delta;
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
        ...(input.nativeRuntimeOptions.modelOverride ? { modelOverride: input.nativeRuntimeOptions.modelOverride } : {}),
        ...(input.nativeRuntimeOptions.reasoningEffort ? { reasoningEffort: input.nativeRuntimeOptions.reasoningEffort } : {}),
        timeoutMs: resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS),
        ...(input.nativeRuntimeEnv ? { runtimeEnv: input.nativeRuntimeEnv } : {}),
        signal: input.requestSignal,
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
    if (result.error) {
      failAgentRun(nativeRun.id, {
        status: agentRunErrorStatus(result.error, input.requestSignal),
        error: result.error,
        outputSummary,
        ...(result.externalSessionId ? { archive: { sessionId: result.externalSessionId } } : {}),
        metadata: {
          runtimeKind: nativeRuntime.kind,
          ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
        },
      });
      return;
    }
    completeAgentRun(nativeRun.id, {
      outputSummary,
      ...(result.externalSessionId ? { archive: { sessionId: result.externalSessionId } } : {}),
      metadata: {
        runtimeKind: nativeRuntime.kind,
        permissionCompilation: {
          requested: input.nativePermissionMode,
          applied: input.permissionPolicy.runtimePermissionMode,
          target: nativeRuntime.kind,
        },
        ...input.sessionContextMetadata,
        ...input.fileContextMetadata,
        ...(result.externalSessionId ? { externalSessionId: result.externalSessionId } : {}),
      },
    });
  } catch (error) {
    failAgentRun(nativeRun.id, {
      status: agentRunErrorStatus(error, input.requestSignal),
      error,
      outputSummary,
    });
    throw error;
  }
}

function resolveRuntimePermissionBaseUrlForAgentTurnContext(context: AgentTurnRequestContext): string {
  if (context.request) return resolveRuntimePermissionBaseUrl(context.request);
  if (process.env.MINDOS_INTERNAL_URL || process.env.MINDOS_URL || process.env.MINDOS_WEB_PORT) {
    return resolveRuntimePermissionBaseUrl(new Request('http://127.0.0.1/'));
  }
  throw new Error('Agent turn runner request context must include the original request for Claude Code permission callbacks.');
}
