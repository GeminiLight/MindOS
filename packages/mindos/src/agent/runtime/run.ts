import type { MindosNativeAgentTurnOptions, MindosNativeAgentTurnResult } from './run-lane-shared.js';
import {
  createClaudeCodeCliClient,
  createClaudeCodeCliStdioTransport,
  type ClaudeCodeCliClient,
  type ClaudeCodeCliPermissionMode,
} from './claude-code-cli.js';
import {
  appendMindosRuntimeAttachmentPathContext,
  materializeMindosRuntimeAttachments,
} from './attachments.js';
import {
  errorFromRuntimeFailure,
  isRuntimeReportedError,
  isUserCancel,
  iterateWithNativeRuntimeAbort,
  sendNativeRuntimeStatus,
  throwIfLaneReportedError,
  throwIfNativeRuntimeTimedOut,
  trackLaneTerminalEvent,
  withNativeRuntimeTimeout,
  type LaneTerminalState,
} from './run-lane-shared.js';
import { runCodexNativeAgentTurn } from './run-codex.js';

export type {
  MindosAgentRuntimeSelection,
  MindosNativeAgentRuntimeKind,
  MindosNativeAgentTurnOptions,
  MindosNativeAgentTurnResult,
  MindosNativeAgentTurnServices,
  MindosRuntimePermissionOption,
  MindosRuntimePermissionRequest,
  MindosRuntimePermissionResult,
  MindosRuntimePermissionRisk,
  MindosRuntimeUserQuestion,
  MindosRuntimeUserQuestionAnswer,
  MindosRuntimeUserQuestionOption,
  MindosRuntimeUserQuestionRequest,
  MindosRuntimeUserQuestionResult,
} from './run-lane-shared.js';

/**
 * Native runtime turn entrypoint. The Codex lane lives in `run-codex.ts`
 * (pooled app-server via the process supervisor); the Claude lane stays here
 * and runs one `claude --print` process per turn. MindOS deliberately does not
 * embed the Claude Agent SDK: the CLI is what the user already installed and
 * signed in to, and ACP (`claude-agent-acp`) covers the richer integration.
 */
export async function runMindosNativeAgentTurn(
  options: MindosNativeAgentTurnOptions,
): Promise<MindosNativeAgentTurnResult> {
  const scoped = withNativeRuntimeTimeout(options);
  try {
    if (scoped.options.runtime.kind === 'claude') {
      return await runClaudeNativeAgentTurn(scoped.options);
    }

    return await runCodexNativeAgentTurn(scoped.options);
  } finally {
    scoped.cleanup();
  }
}
async function runClaudeNativeAgentTurn(options: MindosNativeAgentTurnOptions): Promise<MindosNativeAgentTurnResult> {
  let client: ClaudeCodeCliClient | undefined;
  let sessionId = options.runtime.externalSessionId;
  const turnState = { sessionId };

  try {
    sendNativeRuntimeStatus(options, 'claude', sessionId
      ? 'Resuming Claude Code locally.'
      : 'Starting Claude Code locally.');
    client = await resolveClaudeClient(options);
    try {
      sessionId = await runClaudeTurnWithClient(options, client, turnState);
    } finally {
      // A failed turn may already have bound a session; keep it resumable.
      sessionId = turnState.sessionId;
    }
    throwIfNativeRuntimeTimedOut(options.signal);

    return sessionId ? { externalSessionId: sessionId } : {};
  } catch (error) {
    const err = errorFromRuntimeFailure(error, options.signal, 'claude');
    if (isUserCancel(options.signal)) {
      // The session stays resumable after a user cancel, so do not mark the
      // binding failed; a neutral status keeps the client from rendering a
      // "Stream Error" while the ledger still records `canceled` via `error`.
      sendNativeRuntimeStatus(options, 'claude', 'Canceled by user.');
    } else if (!isRuntimeReportedError(err)) {
      if (sessionId) {
        options.send({
          type: 'runtime_binding',
          runtime: 'claude',
          externalSessionId: sessionId,
          cwd: options.cwd,
          status: 'failed',
          reason: err.message,
        });
      }
      options.send({ type: 'error', message: `Claude Code native runtime error: ${err.message}` });
    }
    return { error: err, ...(sessionId ? { externalSessionId: sessionId } : {}) };
  } finally {
    await client?.close?.();
  }
}

async function runClaudeTurnWithClient(
  options: MindosNativeAgentTurnOptions,
  client: ClaudeCodeCliClient,
  state: { sessionId?: string },
): Promise<string | undefined> {
  let sessionId = state.sessionId;
  const materialized = await materializeMindosRuntimeAttachments(options.attachments);
  try {
    const permissionPrompt = await options.services?.createClaudePermissionPrompt?.({
      cwd: options.cwd,
      signal: options.signal,
    });
    const prompt = appendMindosRuntimeAttachmentPathContext(
      options.prompt,
      materialized.attachments,
      { includeImages: true },
    );
    const reasoningEffort = isClaudeReasoningEffort(options.reasoningEffort)
      ? options.reasoningEffort
      : undefined;
    const turnEvents = client.startTurn({
      prompt,
      cwd: options.cwd,
      attachments: materialized.attachments,
      selectedSkills: options.selectedSkills,
      ...(sessionId ? { sessionId } : {}),
      ...(options.modelOverride ? { model: options.modelOverride } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      permissionMode: claudeCliPermissionModeForMindosMode(options.permissionMode, options.agentMode),
      ...(permissionPrompt ? { permissionPrompt } : {}),
      signal: options.signal,
    });
    const terminal: LaneTerminalState = { sawDone: false };
    for await (const event of iterateWithNativeRuntimeAbort(turnEvents, options.signal)) {
      if (event.type === 'session_id') {
        sessionId = event.sessionId;
        state.sessionId = event.sessionId;
        options.send({
          type: 'runtime_binding',
          runtime: 'claude',
          externalSessionId: event.sessionId,
          cwd: options.cwd,
        });
        sendNativeRuntimeStatus(options, 'claude', 'Claude Code is connected and working in this chat.');
        continue;
      }
      trackLaneTerminalEvent(terminal, event);
      options.send(event);
    }
    throwIfLaneReportedError(terminal);
    return sessionId;
  } finally {
    await materialized.cleanup();
  }
}

function isClaudeReasoningEffort(value: string | undefined): value is 'low' | 'medium' | 'high' | 'xhigh' {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function claudeCliPermissionModeForMindosMode(
  mode: MindosNativeAgentTurnOptions['permissionMode'],
  agentMode?: MindosNativeAgentTurnOptions['agentMode'],
): ClaudeCodeCliPermissionMode {
  if (agentMode === 'plan') return 'plan';
  switch (mode ?? 'ask') {
    case 'read':
      return 'dontAsk';
    case 'ask':
      return 'default';
    case 'auto':
      return 'auto';
    case 'full':
      return 'bypassPermissions';
  }
}
async function resolveClaudeClient(options: MindosNativeAgentTurnOptions): Promise<ClaudeCodeCliClient> {
  const command = requireClaudeLocalCliPath(options);
  if (options.services?.createClaudeClient) {
    return options.services.createClaudeClient({ cwd: options.cwd, signal: options.signal });
  }
  return resolveClaudeCliClient(options, command);
}

async function resolveClaudeCliClient(
  options: MindosNativeAgentTurnOptions,
  command = requireClaudeLocalCliPath(options),
): Promise<ClaudeCodeCliClient> {
  if (options.services?.createClaudeCliClient) {
    return options.services.createClaudeCliClient({
      cwd: options.cwd,
      signal: options.signal,
      command,
      ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
    });
  }

  return createClaudeCodeCliClient(createClaudeCodeCliStdioTransport({
    command,
    ...(options.runtimeEnv ? { env: options.runtimeEnv } : {}),
  }));
}

function isNativeCliBinaryPath(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !value.startsWith('sdk:');
}

function requireClaudeLocalCliPath(options: MindosNativeAgentTurnOptions): string {
  if (isNativeCliBinaryPath(options.runtime.binaryPath)) return options.runtime.binaryPath;
  throw new Error('Claude Code requires a local claude executable detected by MindOS. Install Claude Code and restart MindOS.');
}
