import type { MindOSSSEvent } from '../turn/index.js';
import { redactSensitiveText } from '../turn/index.js';
import { armPausableTurnTimer, getCurrentTurnDeadline } from '../turn/turn-deadline.js';
import type { MindosPermissionMode } from '../permission/index.js';
import type { MindosAgentMode } from '../mode.js';
import type {
  ClaudeCodeCliClient,
  ClaudeCodeCliPermissionPrompt,
} from './claude-code-cli.js';
import type { ClaudeCodeSdkModule } from './claude-code-sdk.js';
import type {
  CodexAppServerClient,
  CodexAppServerServerRequest,
} from './codex-app-server.js';
import { compactRuntimeFailureMessage } from './runtime-errors.js';
import type { MindosSelectedSkill } from '../selected-skills.js';
import type { MindosRuntimeAttachment } from './attachments.js';

/**
 * Types and helpers shared by the native runtime lanes (`run.ts` for Claude,
 * `run-codex.ts` for Codex): the public turn contract, timeout / abort
 * scoping, and the terminal-state tracking that turns a runtime-reported
 * failure into `result.error`.
 */

export type MindosNativeAgentRuntimeKind = 'codex' | 'claude';

export type MindosAgentRuntimeSelection = {
  id: string;
  name: string;
  kind: MindosNativeAgentRuntimeKind;
  externalSessionId?: string;
  binaryPath?: string;
};

export type MindosNativeAgentTurnServices = {
  createCodexClient?(options: {
    cwd: string;
    signal?: AbortSignal;
    handleServerRequest?: (request: CodexAppServerServerRequest) => Promise<unknown> | unknown;
  }): CodexAppServerClient | Promise<CodexAppServerClient>;
  createClaudeClient?(options: { cwd: string; signal?: AbortSignal }): ClaudeCodeCliClient | Promise<ClaudeCodeCliClient>;
  createClaudeCliClient?(options: { cwd: string; signal?: AbortSignal; command?: string; env?: NodeJS.ProcessEnv }): ClaudeCodeCliClient | Promise<ClaudeCodeCliClient>;
  createClaudeSdkClient?(options: { cwd: string; signal?: AbortSignal; command: string; env?: NodeJS.ProcessEnv }): ClaudeCodeCliClient | Promise<ClaudeCodeCliClient>;
  loadClaudeSdk?(): ClaudeCodeSdkModule | Promise<ClaudeCodeSdkModule>;
  createClaudePermissionPrompt?(options: {
    cwd: string;
    signal?: AbortSignal;
  }): ClaudeCodeCliPermissionPrompt | undefined | Promise<ClaudeCodeCliPermissionPrompt | undefined>;
  requestRuntimePermission?(
    request: MindosRuntimePermissionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimePermissionResult>;
  requestUserQuestion?(
    request: MindosRuntimeUserQuestionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimeUserQuestionResult>;
};

export type MindosRuntimePermissionOption = {
  id: string;
  label: string;
  description?: string;
  intent?: 'allow' | 'deny' | 'cancel';
  scope?: 'once' | 'session' | 'always' | 'turn';
};

export type MindosRuntimePermissionRisk = {
  level: 'low' | 'medium' | 'high';
  summary: string;
  reasons?: string[];
};

export type MindosRuntimePermissionRequest = {
  runtime: 'acp' | 'codex' | 'claude';
  toolCallId: string;
  toolName: string;
  input: unknown;
  options: MindosRuntimePermissionOption[];
  reason?: string;
  action?: string;
  resource?: string;
  risk?: MindosRuntimePermissionRisk;
};

export type MindosRuntimePermissionResult = {
  decision: string;
  cancelled?: boolean;
  decisionLabel?: string;
  decisionIntent?: 'allow' | 'deny' | 'cancel';
  decisionScope?: 'once' | 'session' | 'always' | 'turn';
};

export type MindosRuntimeUserQuestionOption = {
  label: string;
  description: string;
  preview?: string;
};

export type MindosRuntimeUserQuestion = {
  question: string;
  header: string;
  options: MindosRuntimeUserQuestionOption[];
  multiSelect?: boolean;
};

export type MindosRuntimeUserQuestionAnswer = {
  questionIndex: number;
  question: string;
  kind: 'option' | 'custom' | 'chat' | 'multi';
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
};

export type MindosRuntimeUserQuestionRequest = {
  runtime: 'codex' | 'claude';
  toolCallId: string;
  questions: MindosRuntimeUserQuestion[];
};

export type MindosRuntimeUserQuestionResult = {
  answers: MindosRuntimeUserQuestionAnswer[];
  cancelled?: boolean;
  error?: string;
};

export type MindosNativeAgentTurnOptions = {
  runtime: MindosAgentRuntimeSelection;
  cwd: string;
  prompt: string;
  attachments?: MindosRuntimeAttachment[];
  selectedSkills?: MindosSelectedSkill[];
  permissionMode?: MindosPermissionMode;
  agentMode?: MindosAgentMode;
  modelOverride?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  runtimeEnv?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  send(event: MindOSSSEvent): void;
  services?: MindosNativeAgentTurnServices;
};

export type MindosNativeAgentTurnResult = {
  externalSessionId?: string;
  error?: Error;
};
export function sendNativeRuntimeStatus(
  options: MindosNativeAgentTurnOptions,
  runtime: MindosNativeAgentRuntimeKind,
  message: string,
): void {
  options.send({ type: 'status', visible: true, runtime, message });
}
export function createNativeRuntimeTimeoutError(timeoutMs: number): Error & { code: 'TIMEOUT' } {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const error = new Error(`Native runtime timed out after ${seconds}s.`) as Error & { code: 'TIMEOUT' };
  error.code = 'TIMEOUT';
  return error;
}

export function isTimeoutError(value: unknown): value is Error & { code: 'TIMEOUT' } {
  return value instanceof Error && (value as { code?: unknown }).code === 'TIMEOUT';
}

/**
 * Marker for failures the runtime itself reported through its event stream
 * (Claude `result.is_error`, Codex `turn/failed`). The `error` SSE event has
 * already been forwarded to the client by the time the lane throws this, so
 * the catch blocks must not send a second one — but the lane still needs to
 * return `result.error`, otherwise callers record the run as `completed`.
 */
export const RUNTIME_REPORTED_ERROR_NAME = 'MindosRuntimeReportedError';

export function createRuntimeReportedError(message: string): Error {
  const error = new Error(message);
  error.name = RUNTIME_REPORTED_ERROR_NAME;
  return error;
}

export function isRuntimeReportedError(error: Error): boolean {
  return error.name === RUNTIME_REPORTED_ERROR_NAME;
}

/** True when the lane stopped because the user canceled, not because it timed out. */
export function isUserCancel(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) && !isTimeoutError(signal?.reason);
}

/**
 * Terminal-state tracker for a lane's event loop. Runtimes report failures as
 * `{type:'error'}` events without a following `done`; the lane must turn that
 * into a thrown error after the loop so `result.error` is populated.
 */
export type LaneTerminalState = { errorMessage?: string; sawDone: boolean };

export function trackLaneTerminalEvent(state: LaneTerminalState, event: MindOSSSEvent): void {
  if (event.type === 'error') state.errorMessage = event.message;
  if (event.type === 'done') state.sawDone = true;
}

export function throwIfLaneReportedError(state: LaneTerminalState): void {
  if (state.errorMessage !== undefined && !state.sawDone) {
    throw createRuntimeReportedError(state.errorMessage);
  }
}

export function errorFromRuntimeFailure(
  error: unknown,
  signal?: AbortSignal,
  runtime?: MindosNativeAgentRuntimeKind,
): Error {
  const reason = signal?.reason;
  if (signal?.aborted && isTimeoutError(reason)) return reason;
  // Transport failures can echo stderr/env contents; redact before the
  // message reaches SSE events or persisted run ledgers.
  const rawMessage = redactSensitiveText(error instanceof Error ? error.message : String(error));
  const compactMessage = compactRuntimeFailureMessage(rawMessage, {
    runtime,
    fallback: `${runtime === 'claude' ? 'Claude Code' : 'Codex'} native runtime error.`,
  });
  const compactError = new Error(compactMessage);
  if (error instanceof Error) compactError.name = error.name;
  return compactError;
}

export function throwIfNativeRuntimeTimedOut(signal?: AbortSignal): void {
  if (signal?.aborted && isTimeoutError(signal.reason)) {
    throw signal.reason;
  }
}

export function abortErrorFromSignal(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(reason ? String(reason) : 'Native runtime aborted.');
}

export function throwIfNativeRuntimeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortErrorFromSignal(signal);
  }
}

export function settleIteratorReturn<T>(iterator: AsyncIterator<T>): void {
  const result = iterator.return?.();
  if (result && typeof (result as PromiseLike<IteratorResult<T>>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
  }
}

export async function nextWithNativeRuntimeAbort<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  throwIfNativeRuntimeAborted(signal);

  const nextPromise = Promise.resolve(iterator.next());
  nextPromise.catch(() => {});
  if (!signal) return nextPromise;

  let removeAbortListener = () => {};
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(abortErrorFromSignal(signal));
    removeAbortListener = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
  });

  try {
    return await Promise.race([nextPromise, abortPromise]);
  } catch (error) {
    if (signal.aborted) {
      throw abortErrorFromSignal(signal);
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

export async function* iterateWithNativeRuntimeAbort<T>(
  iterable: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncIterable<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let completed = false;
  try {
    while (true) {
      const next = await nextWithNativeRuntimeAbort(iterator, signal);
      if (next.done) {
        completed = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!completed) {
      settleIteratorReturn(iterator);
    }
  }
}

export function withNativeRuntimeTimeout(options: MindosNativeAgentTurnOptions): {
  options: MindosNativeAgentTurnOptions;
  cleanup(): void;
} {
  const timeoutMs = options.timeoutMs;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { options, cleanup: () => {} };
  }

  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(options.signal?.reason ?? new Error('Native runtime aborted.'));
    }
  };
  if (options.signal?.aborted) {
    abortFromParent();
  } else {
    options.signal?.addEventListener('abort', abortFromParent, { once: true });
  }

  // Pausable when the lane caller runs the turn under a TurnDeadline: a
  // pending permission / question bridge wait freezes the native turn clock
  // (bounded by the deadline's total-pause cap) instead of consuming it.
  const disposeTimer = armPausableTurnTimer({
    timeoutMs,
    ...(getCurrentTurnDeadline() ? { deadline: getCurrentTurnDeadline() } : {}),
    onTimeout: () => {
      if (!controller.signal.aborted) {
        controller.abort(createNativeRuntimeTimeoutError(timeoutMs));
      }
    },
  });

  return {
    options: {
      ...options,
      signal: controller.signal,
    },
    cleanup: () => {
      disposeTimer();
      options.signal?.removeEventListener('abort', abortFromParent);
    },
  };
}
