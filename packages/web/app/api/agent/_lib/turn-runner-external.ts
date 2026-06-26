import { randomUUID } from 'crypto';
import {
  appendMindosRuntimeAttachmentPathContext,
  materializeMindosRuntimeAttachments,
  runMindosNativeAgentTurn,
  type MindosRuntimeAttachment,
} from '@geminilight/mindos/agent/runtime';
import {
  appendSseEventToAgentRun,
  type MindosSelectedSkill,
} from '@geminilight/mindos/agent';
import {
  resolveMindosAgentTimeoutMs,
  runMindosAcpAgentTurn,
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
  updateAgentRun,
} from '@geminilight/mindos/agent/ledger/run-ledger';
import {
  createMindosAgentPermissionPolicy,
  type MindosPermissionMode,
} from '@geminilight/mindos/agent/mindos-pi/permission';
import type { MindosAgentRuntimeSelection } from '@geminilight/mindos/agent/runtime';
import type { AcpRuntimeOptions, AgentPermissionMode, NativeRuntimeOptions, SessionContextSelection, SessionWorkDir } from '@/lib/types';
import { createSession, promptStream, cancelPrompt, closeSession, setConfigOption, setMode } from '@/lib/acp/session';
import { createClaudePermissionPromptConfig, resolveRuntimePermissionBaseUrl } from '@/lib/agent/claude-permission-prompt';
import {
  agentRunErrorStatus,
  compactStringEnv,
  createAgentTurnSseResponse,
  omitEnvKeys,
  sendAgentRunContext,
} from './turn-sse';
import type { AgentTurnRequestContext } from './turn-request';

type PermissionPolicy = ReturnType<typeof createMindosAgentPermissionPolicy>;

type ExternalTurnLocalization = { agentTimeout: string };

export type RunExternalRuntimeTurnInput = {
  externalPrompt: string;
  chatSessionId?: string;
  executionCwd: string;
  nativePermissionMode: AgentPermissionMode;
  permissionPolicy: PermissionPolicy;
  agentMode: string;
  sessionContextMetadata: Record<string, unknown>;
  fileContextMetadata: Record<string, unknown>;
  sessionWorkDir: SessionWorkDir & { path: string };
  sessionContextSelection: SessionContextSelection;
  assistantId?: string;
  runtimeAttachments: MindosRuntimeAttachment[];
  selectedSkills: MindosSelectedSkill[];
  nativeRuntimeOptions: NativeRuntimeOptions;
  acpRuntimeOptions: AcpRuntimeOptions;
  nativeRuntimeEnv?: NodeJS.ProcessEnv;
  requestSignal: AbortSignal;
  requestContext: AgentTurnRequestContext;
  acpRuntimeEnvOverlay?: Record<string, string | undefined>;
  t: ExternalTurnLocalization;
};

export type RunNativeRuntimeLaneTurnInput = RunExternalRuntimeTurnInput & {
  nativeRuntime: MindosAgentRuntimeSelection;
};

export type RunAcpRuntimeLaneTurnInput = RunExternalRuntimeTurnInput & {
  acpAgent: { id: string; name: string };
};

export function runNativeRuntimeLaneTurn(input: RunNativeRuntimeLaneTurnInput): Response {
  return createAgentTurnSseResponse((send) => runWithAgentRunContext({ chatSessionId: input.chatSessionId }, async () => {
    await runNativeRuntimeTurn(input, input.nativeRuntime, send);
  }), (err) => {
    if (err instanceof Error && (err as any).code === 'TIMEOUT') return input.t.agentTimeout;
    return err instanceof Error ? err.message : String(err);
  });
}

export function runAcpRuntimeLaneTurn(input: RunAcpRuntimeLaneTurnInput): Response {
  return createAgentTurnSseResponse((send) => runWithAgentRunContext({ chatSessionId: input.chatSessionId }, async () => {
    await runAcpRuntimeTurn(input, input.acpAgent, send);
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

async function applyAcpRuntimeOptions(sessionId: string, options: AcpRuntimeOptions): Promise<void> {
  if (options.modeId) {
    await setMode(sessionId, options.modeId);
  }
  const configValues = options.configValues ?? {};
  for (const [configId, value] of Object.entries(configValues)) {
    if (!configId.trim() || !value.trim()) continue;
    await setConfigOption(sessionId, configId, value);
  }
}

function resolveRuntimePermissionBaseUrlForAgentTurnContext(context: AgentTurnRequestContext): string {
  if (context.request) return resolveRuntimePermissionBaseUrl(context.request);
  if (process.env.MINDOS_INTERNAL_URL || process.env.MINDOS_URL || process.env.MINDOS_WEB_PORT) {
    return resolveRuntimePermissionBaseUrl(new Request('http://127.0.0.1/'));
  }
  throw new Error('Agent turn runner request context must include the original request for Claude Code permission callbacks.');
}
