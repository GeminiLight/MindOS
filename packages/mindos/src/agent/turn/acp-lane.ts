import {
  safeParseMindosJsonObject,
  sanitizeToolArgs,
  sanitizeToolOutput,
} from './tool-event-safety.js';
import {
  resolveMindosAgentTimeoutMs,
  runMindosAgentTurnWithRetry,
  runMindosWithTimeout,
} from './retry.js';
import { getCurrentTurnDeadline } from './turn-deadline.js';
import type { MindOSSSEvent } from './index.js';

/**
 * The ACP lane: turn contract types, the `session/update` → SSE mapping and
 * `runMindosAcpAgentTurn`. Split out of `index.ts` (which stayed over the
 * 1000-line budget) so the lane can grow a pooled-session lifecycle; `index.ts`
 * re-exports everything here, so consumers keep importing from the barrel.
 */

export type MindosAcpSessionUpdate = {
  type: string;
  text?: string;
  error?: string;
  permission?: {
    requestId: string;
    sessionId: string;
    toolCallId: string;
    toolName: string;
    status: 'pending' | 'resolved';
    options: Array<{ id: string; label: string; kind: string }>;
    selectedOptionId?: string;
    outcome?: string;
  };
  toolCall?: {
    toolCallId: string;
    title?: string;
    kind?: string;
    rawInput?: string;
    rawOutput?: string;
    status?: string;
  };
  plan?: {
    entries?: Array<{ status?: string; content?: string }>;
  };
};

export type MindosAcpUpdateMappingOptions = {
  suppressErrors?: boolean;
  permissionRunId?: string;
};

export function mapMindosAcpUpdateToSseEvents(
  update: MindosAcpSessionUpdate,
  options: MindosAcpUpdateMappingOptions = {},
): { events: MindOSSSEvent[]; hasVisibleContent: boolean } {
  switch (update.type) {
    case 'agent_message_chunk':
    case 'text':
      if (!update.text) return { events: [], hasVisibleContent: false };
      return { events: [{ type: 'text_delta', delta: update.text }], hasVisibleContent: true };

    case 'agent_thought_chunk':
      if (!update.text) return { events: [], hasVisibleContent: false };
      return { events: [{ type: 'thinking_delta', delta: update.text }], hasVisibleContent: true };

    case 'tool_call':
      if (!update.toolCall) return { events: [], hasVisibleContent: false };
      return {
        events: [{
          type: 'tool_start',
          toolCallId: update.toolCall.toolCallId,
          toolName: update.toolCall.title ?? update.toolCall.kind ?? 'tool',
          runtime: 'acp',
          args: sanitizeToolArgs(
            update.toolCall.title ?? update.toolCall.kind ?? 'tool',
            safeParseMindosJsonObject(update.toolCall.rawInput),
          ),
        }],
        hasVisibleContent: true,
      };

    case 'tool_call_update':
      if (!update.toolCall || (update.toolCall.status !== 'completed' && update.toolCall.status !== 'failed')) {
        return { events: [], hasVisibleContent: false };
      }
      return {
        events: [{
          type: 'tool_end',
          toolCallId: update.toolCall.toolCallId,
          output: sanitizeToolOutput(update.toolCall.rawOutput ?? ''),
          isError: update.toolCall.status === 'failed',
          runtime: 'acp',
        }],
        hasVisibleContent: false,
      };

    case 'permission_request':
      if (!update.permission) return { events: [], hasVisibleContent: false };
      return {
        events: [{
          type: 'runtime_permission_request',
          runId: options.permissionRunId ?? update.permission.sessionId,
          requestId: update.permission.requestId,
          runtime: 'acp',
          toolCallId: update.permission.toolCallId,
          toolName: update.permission.toolName,
          input: {},
          options: update.permission.options.map((option) => ({
            id: option.id,
            label: option.label,
            intent: option.kind.startsWith('reject') ? 'deny' : 'allow',
            scope: option.kind.endsWith('_always') ? 'session' : 'once',
          })),
          reason: 'ACP adapter requested permission for a tool call.',
        }],
        hasVisibleContent: false,
      };

    case 'permission_resolved':
      if (!update.permission) return { events: [], hasVisibleContent: false };
      return {
        events: [{
          type: 'runtime_permission_resolved',
          runId: options.permissionRunId ?? update.permission.sessionId,
          requestId: update.permission.requestId,
          runtime: 'acp',
          toolCallId: update.permission.toolCallId,
          decision: update.permission.selectedOptionId ?? update.permission.outcome ?? 'unknown',
          cancelled: update.permission.outcome === 'cancelled',
          decisionIntent: update.permission.outcome?.startsWith('reject') ? 'deny' : update.permission.outcome === 'cancelled' ? 'cancel' : 'allow',
          decisionScope: update.permission.outcome?.endsWith('_always') ? 'session' : 'once',
        }],
        hasVisibleContent: false,
      };

    case 'plan':
      if (!update.plan?.entries) return { events: [], hasVisibleContent: false };
      return {
        events: [{
          type: 'text_delta',
          delta: `\n\n${update.plan.entries.map((entry) => `${planEntryIcon(entry.status)} ${entry.content ?? ''}`).join('\n')}\n\n`,
        }],
        hasVisibleContent: true,
      };

    case 'error':
      if (options.suppressErrors) return { events: [], hasVisibleContent: false };
      return { events: [{ type: 'error', message: update.error ?? 'ACP agent error' }], hasVisibleContent: false };

    default:
      return { events: [], hasVisibleContent: false };
  }
}

function planEntryIcon(status: string | undefined): string {
  if (status === 'completed') return '✅';
  if (status === 'in_progress') return '⚡';
  return '⏳';
}

export type MindosAcpAgentTurnSession = {
  id: string;
  agentSessionId?: string;
  agentCapabilities?: { loadSession?: boolean };
};

export type MindosAcpAgentTurnSessionOptions = {
  cwd: string;
  permissionMode?: 'readonly' | 'ask' | 'auto' | 'full';
  /** Aborts the handshake and kills the agent process when the turn is cancelled. */
  signal?: AbortSignal;
};

export type MindosAcpAgentTurnPromptOptions = {
  signal?: AbortSignal;
  /** Remaining lane budget for this prompt; the session layer cancels the agent when it elapses. */
  timeoutMs?: number;
};

export type MindosAcpAgentTurnCloseOptions = {
  closeAgentSession?: boolean;
};

/** Identity of a pooled ACP session; a lane reuses a live session with the same key. */
export type MindosAcpSessionPoolKey = {
  agentId: string;
  cwd: string;
  externalSessionId: string;
};

export type MindosAcpAgentTurnServices = {
  createSession(agentId: string, options: MindosAcpAgentTurnSessionOptions): Promise<MindosAcpAgentTurnSession>;
  loadSession?(
    agentId: string,
    existingSessionId: string,
    options: MindosAcpAgentTurnSessionOptions,
  ): Promise<MindosAcpAgentTurnSession>;
  promptStream(
    sessionId: string,
    prompt: string,
    onUpdate: (update: MindosAcpSessionUpdate) => void,
    options?: MindosAcpAgentTurnPromptOptions,
  ): Promise<void>;
  cancelPrompt?(sessionId: string): Promise<void>;
  closeSession(sessionId: string, options?: MindosAcpAgentTurnCloseOptions): Promise<void>;
  /**
   * Take a live pooled session for `key` instead of opening a fresh one. When
   * it returns a session, the lane skips `loadSession`/`createSession` (and the
   * agent spawn + handshake) and treats the turn as resumed; `undefined` (or a
   * throw) falls back to opening. Optional: callers that do not pool keep the
   * open-per-turn behaviour.
   */
  acquireSession?(key: MindosAcpSessionPoolKey): Promise<MindosAcpAgentTurnSession | undefined>;
  /**
   * Park a finished session for reuse by the next turn with the same key.
   * Returns true when the session was parked (so the lane must not close it)
   * and false when it could not be parked (dead process, unresumable, pooling
   * off), in which case the lane closes it as before. Optional.
   */
  releaseSession?(
    session: MindosAcpAgentTurnSession,
    key: MindosAcpSessionPoolKey,
  ): Promise<boolean> | boolean;
};

export type MindosAcpAgentTurnOptions = MindosAcpAgentTurnServices & {
  agentId: string;
  cwd: string;
  prompt: string;
  maxRetries?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  hasContent(): boolean;
  onVisibleContent?(): void;
  send(event: MindOSSSEvent): void;
  permissionRunId?: string;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryDelay?: (attempt: number) => number;
  timeoutMessage?: (timeoutMs: number) => string;
  errorMessage?: (error: Error) => string;
  externalSessionId?: string;
  onSessionReady?(
    session: MindosAcpAgentTurnSession,
    details: { resumed: boolean; externalSessionId?: string },
  ): void | Promise<void>;
};

export type MindosAcpAgentTurnResult = {
  error?: Error;
};

/**
 * An `error` update reported by the ACP agent during a prompt. The lane
 * carries it out of the attempt so the turn ends as a failure (ledger
 * `failed`, no `done`), mirroring the native lane's reported-error contract.
 */
export class MindosAcpReportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MindosAcpReportedError';
  }
}

function abortReasonOf(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Reject as soon as `signal` aborts; `onAbort` runs once before the rejection. */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort?: () => void): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(abortReasonOf(signal));
  }
  let cleanup = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const handler = () => {
      onAbort?.();
      reject(abortReasonOf(signal));
    };
    signal.addEventListener('abort', handler, { once: true });
    cleanup = () => signal.removeEventListener('abort', handler);
  });
  return Promise.race([promise, aborted]).finally(cleanup);
}

/** The lane's own budget expired (`runMindosWithTimeout`); the agent may be wedged, so the session is closed, not parked. */
function isTurnTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'TIMEOUT';
}

/** A live turn's session plus the identity needed to park or close it. */
type CurrentAcpTurnSession = {
  session: MindosAcpAgentTurnSession;
  /** Present only for a resumable session; without it the session cannot be pooled. */
  key?: MindosAcpSessionPoolKey;
  externalSessionId?: string;
};

export async function runMindosAcpAgentTurn(options: MindosAcpAgentTurnOptions): Promise<MindosAcpAgentTurnResult> {
  let current: CurrentAcpTurnSession | undefined;

  /**
   * End the live session: park it for the next turn when the host pools and the
   * turn ended cleanly (success, retryable error, user cancel), otherwise close
   * it. A timed-out turn is always closed because the agent may be stuck.
   */
  const finishCurrentSession = async (timedOut: boolean) => {
    if (!current) return;
    const { session, key, externalSessionId } = current;
    current = undefined;
    if (!timedOut && key && options.releaseSession) {
      try {
        if (await options.releaseSession(session, key)) return;
      } catch {
        // A failed park falls through to closing the session.
      }
    }
    await options.closeSession(session.id, { closeAgentSession: !externalSessionId }).catch(() => {});
  };

  try {
    const timeoutMs = options.timeoutMs ?? resolveMindosAgentTimeoutMs();
    const timeoutMessage = options.timeoutMessage?.(timeoutMs) ?? `ACP agent execution timeout after ${timeoutMs / 1000} seconds`;
    const lastError = await runMindosAgentTurnWithRetry({
      maxRetries: options.maxRetries,
      signal: options.signal,
      hasContent: options.hasContent,
      send: options.send,
      sleep: options.sleep,
      retryDelay: options.retryDelay,
      // A retryable error parks the session (unless it timed out) so the next
      // attempt — or the next turn — reuses the same live agent process.
      onAttemptError: (error) => finishCurrentSession(isTurnTimeoutError(error)),
      execute: async () => {
        // One budget per attempt covers session open and the prompt: a
        // handshake that hangs must time out (and honour cancel) exactly like
        // a hanging prompt does. When the turn runs under a TurnDeadline,
        // bridge-wait pauses extend this attempt budget too (bounded by the
        // deadline's total-pause cap).
        const turnDeadline = getCurrentTurnDeadline();
        const pausedBaselineMs = turnDeadline?.pausedMsSoFar() ?? 0;
        const deadline = Date.now() + timeoutMs;
        const remainingMs = () => Math.max(
          1,
          deadline + ((turnDeadline?.pausedMsSoFar() ?? 0) - pausedBaselineMs) - Date.now(),
        );

        const sessionOpen = await openAcpTurnSessionScoped(options, remainingMs(), timeoutMessage);
        const session = sessionOpen.session;
        const externalSessionId = resumableAcpSessionId(
          session,
          sessionOpen.resumed ? options.externalSessionId : undefined,
        );
        current = {
          session,
          ...(externalSessionId
            ? {
              key: { agentId: options.agentId, cwd: options.cwd, externalSessionId },
              externalSessionId,
            }
            : {}),
        };
        await options.onSessionReady?.(session, {
          resumed: sessionOpen.resumed,
          ...(externalSessionId ? { externalSessionId } : {}),
        });
        if (externalSessionId) {
          options.send({
            type: 'runtime_binding',
            runtime: 'acp',
            externalSessionId,
            cwd: options.cwd,
            status: 'active',
          });
        }

        let reportedError: MindosAcpReportedError | undefined;
        const promptTimeoutMs = remainingMs();
        await runMindosWithTimeout(
          raceWithAbort(
            options.promptStream(session.id, options.prompt, (update) => {
              if (update.type === 'error') {
                // Recorded, not forwarded: the retry wrapper emits exactly one
                // SSE error for the terminal failure of the whole turn.
                reportedError ??= new MindosAcpReportedError(update.error ?? 'ACP agent error');
                return;
              }
              const mapped = mapMindosAcpUpdateToSseEvents(update, {
                permissionRunId: options.permissionRunId,
              });
              if (mapped.hasVisibleContent) options.onVisibleContent?.();
              for (const event of mapped.events) options.send(event);
            }, { signal: options.signal, timeoutMs: promptTimeoutMs }),
            options.signal,
            () => { void options.cancelPrompt?.(session.id).catch(() => {}); },
          ),
          promptTimeoutMs,
          timeoutMessage,
        );
        if (reportedError) throw reportedError;
      },
    });

    if (lastError) {
      options.send({ type: 'error', message: options.errorMessage?.(lastError) ?? `ACP Agent Error: ${lastError.message}` });
      return { error: lastError };
    }

    options.send({ type: 'done' });
    return {};
  } finally {
    // Success parks the live session; a failed attempt already finished it in
    // onAttemptError, so this is a no-op there.
    await finishCurrentSession(false);
  }
}

/**
 * Open (resume or create) the session under the attempt's remaining budget
 * and abort signal. A session that arrives after the lane already gave up is
 * closed so the agent process does not outlive the turn.
 */
async function openAcpTurnSessionScoped(
  options: MindosAcpAgentTurnOptions,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<{ session: MindosAcpAgentTurnSession; resumed: boolean }> {
  let gaveUp = false;
  const opening = openAcpTurnSession(options);
  opening.then((late) => {
    if (!gaveUp) return;
    const keepAgentSession = !!resumableAcpSessionId(late.session, late.resumed ? options.externalSessionId : undefined);
    void options.closeSession(late.session.id, { closeAgentSession: !keepAgentSession }).catch(() => {});
  }, () => {});
  try {
    return await runMindosWithTimeout(raceWithAbort(opening, options.signal), timeoutMs, timeoutMessage);
  } catch (error) {
    gaveUp = true;
    throw error;
  }
}

async function openAcpTurnSession(
  options: MindosAcpAgentTurnOptions,
): Promise<{ session: MindosAcpAgentTurnSession; resumed: boolean }> {
  const externalSessionId = options.externalSessionId?.trim();
  const sessionOptions: MindosAcpAgentTurnSessionOptions = {
    cwd: options.cwd,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  // A live pooled session for this (agentId, cwd, externalSessionId) skips the
  // spawn + handshake entirely. A miss (undefined) or a failure to re-apply
  // runtime options falls through to the normal resume/create path.
  if (externalSessionId && options.acquireSession) {
    try {
      const pooled = await options.acquireSession({
        agentId: options.agentId,
        cwd: options.cwd,
        externalSessionId,
      });
      if (pooled) return { session: pooled, resumed: true };
    } catch (error) {
      // A cancelled turn must not fall through to a fresh session.
      if (options.signal?.aborted) throw error;
    }
  }
  if (externalSessionId && options.loadSession) {
    try {
      return {
        session: await options.loadSession(options.agentId, externalSessionId, sessionOptions),
        resumed: true,
      };
    } catch (error) {
      // A cancelled turn must not fall through to a fresh session.
      if (options.signal?.aborted) throw error;
      options.send({
        type: 'status',
        runtime: 'acp',
        visible: true,
        message: 'Could not resume the previous ACP session, so MindOS started a fresh ACP session.',
      });
    }
  }

  return {
    session: await options.createSession(options.agentId, sessionOptions),
    resumed: false,
  };
}

function resumableAcpSessionId(
  session: MindosAcpAgentTurnSession,
  fallbackExternalSessionId?: string,
): string | undefined {
  const externalSessionId = session.agentSessionId?.trim() || fallbackExternalSessionId?.trim();
  if (!externalSessionId) return undefined;
  return session.agentCapabilities?.loadSession ? externalSessionId : undefined;
}
