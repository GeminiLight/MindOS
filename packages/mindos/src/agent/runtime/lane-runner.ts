import { randomUUID } from 'node:crypto';
import type { MindOSSSEvent } from '../turn/index.js';
import { resolveMindosAgentTimeoutMs } from '../turn/retry.js';
import {
  createTurnDeadline,
  registerTurnDeadlineForRun,
  runWithTurnDeadline,
} from '../turn/turn-deadline.js';
import type { MindosAgentModeContract } from '../mode.js';
import type {
  AgentNodeKind,
  AgentRunArchiveRef,
  AgentRunPermissionMode,
  AgentRunStatus,
  UpdateAgentRunInput,
} from '../ledger/run-ledger-types.js';
import {
  appendAgentRunEvent,
  completeAgentRun,
  failAgentRun,
  startAgentRun,
  updateAgentRun,
  type AgentRunRecord,
} from '../ledger/run-ledger.js';
import { appendSseEventToAgentRun } from '../ledger/run-timeline-events.js';
import {
  isAbortLikeError,
  registerAgentRunCancelHandler,
} from '../ledger/run-cancellation.js';
import {
  appendMindosAgentModeRunEvents,
  createMindosAgentModeRunArtifacts,
  mindosAgentModeArtifactsMetadata,
} from '../mode-run-events.js';
import {
  createAgentRunCapsule,
  finalizeAgentRunCapsule,
} from '../capsules/store.js';
import type {
  AgentRunCapsuleProvenance,
  AgentRunCapsuleRequest,
  AgentRunCapsuleRuntimeBinding,
  AgentRunCapsuleSource,
  AgentRunCapsuleStatus,
} from '../capsules/types.js';
import {
  runWithAgentRunContext,
  setAgentRunContextForResource,
  type AgentRunContext,
} from '../agent-run-context.js';
import {
  requestRuntimePermissionViaBridge,
  runWithRuntimePermissionBridge,
} from '../bridges/runtime-permission-bridge.js';
import {
  askUserQuestionViaBridge,
  runWithAskUserQuestionBridge,
} from '../bridges/user-question-bridge.js';
import type {
  MindosRuntimePermissionOption,
  MindosRuntimePermissionRequest,
  MindosRuntimePermissionResult,
  MindosRuntimePermissionRisk,
  MindosRuntimeUserQuestionRequest,
  MindosRuntimeUserQuestionResult,
} from './run-lane-shared.js';

/**
 * The RuntimeLane contract and its single caller (spec-runtime-lane-contract
 * 方案 1, wave-4 follow-up branch).
 *
 * Three web lane files used to copy the same ~200-line lifecycle each:
 * run-ledger start/complete/fail, capsule capture/finalize, mode artifacts,
 * cancel/timeout classification, client-disconnect grace and the bridge ALS
 * wiring. `runRuntimeLaneTurn` below is the ONE owner of that lifecycle; the
 * lanes (`lane-adapters.ts`) only adapt their protocol function to the
 * `RuntimeLane` contract.
 *
 * Barrel-mock identity (wiki/known-pitfalls/02 rule "把 lane 逻辑下沉 core"):
 * host tests replace runtime entrypoints by mocking the PACKAGE BARREL
 * (`@geminilight/mindos/agent/runtime` etc). Core-internal relative imports
 * resolve to leaf modules and bypass those mocks, so every runner function an
 * adapter calls is an injectable dep whose default binds the leaf module —
 * hosts pass the barrel-imported reference explicitly.
 */

export type RuntimeLaneKind = 'mindos' | 'codex' | 'claude' | 'acp';

export type LaneOpenInput = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * The mutable per-turn lane state. Adapters write what they learn during
 * open()/run() (external session id, archive ref, capsule binding, terminal
 * metadata) and the caller reads it on every terminal path — including the
 * throwing one, which is why this object, not the run result, carries it.
 */
export type LaneSession = {
  kind: RuntimeLaneKind;
  runtimeId: string;
  cwd: string;
  externalSessionId?: string;
  /** Capsule finalize binding; `undefined` omits the field, `null` clears it. */
  capsuleBinding?: AgentRunCapsuleRuntimeBinding | null;
  archive?: AgentRunArchiveRef;
  /** Extra ledger metadata merged into complete AND fail records. */
  metadata?: Record<string, unknown>;
  capsulePatch?: Partial<Pick<AgentRunCapsuleRequest, 'model' | 'thinkingEffort' | 'runtimeBinding'>>;
  ledgerPatch?: { chatSessionId?: string };
  /** Pi: the runtime resource that carries the agent-run context WeakMap entry. */
  agentRunContextResource?: object;
  /** Adapter-private payload (the opened Pi runtime, materialized ACP attachments…). */
  handle?: unknown;
};

export type LaneTurnRequest = {
  /** Caller-owned signal: cancel handler + disconnect grace abort it; the HTTP request signal does not. */
  signal: AbortSignal;
  timeoutMs: number;
};

export type LaneRunResult = {
  externalSessionId?: string;
  /** Terminal failure reported by the runtime (frame already sent; do not rethrow). */
  error?: Error;
};

export interface LaneSink {
  /** Ledger-recording send: accumulates outputSummary, captures streamed error frames, appends to the run timeline. */
  send(event: MindOSSSEvent): void;
  requestPermission(
    request: MindosRuntimePermissionRequest,
    options?: { signal?: AbortSignal; requestId?: string; emitRequest?: boolean; emitResolved?: boolean },
  ): Promise<MindosRuntimePermissionResult>;
  askUser(
    request: MindosRuntimeUserQuestionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MindosRuntimeUserQuestionResult>;
  readonly permissionRunId: string;
  readonly runContext: AgentRunContext;
  updateRun(patch: UpdateAgentRunInput): void;
}

export interface RuntimeLane {
  kind: RuntimeLaneKind;
  open(input: LaneOpenInput): Promise<LaneSession>;
  run(session: LaneSession, turn: LaneTurnRequest, sink: LaneSink): Promise<LaneRunResult>;
  interrupt(session: LaneSession): Promise<void>;
  close(session: LaneSession, opts: { keepExternalSession: boolean }): Promise<void>;
}

/**
 * Client-presence disconnect grace port. The presence table itself is web-host
 * state (the reattach route shares it through the realm registry), so the
 * caller receives `arm` instead of owning the table (spec 数据流: "presence
 * 端口形态"). When absent, the run has no disconnect grace (standalone hosts).
 */
export type RuntimeLaneDisconnectPort = {
  arm(input: {
    runId: string;
    rootRunId: string;
    requestSignal: AbortSignal;
    graceMs?: number;
  }): () => void;
};

export type AgentTurnCapsuleSeed = {
  runId?: string;
  mindRoot: string;
  source: AgentRunCapsuleSource;
  request: AgentRunCapsuleRequest;
  provenance: AgentRunCapsuleProvenance;
};

export type RuntimeLaneTurnLedgerSeed = {
  agentKind: AgentNodeKind;
  runtimeId: string;
  displayName: string;
  permissionMode?: AgentRunPermissionMode;
  inputSummary: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeLaneTurnInput = {
  /** Explicit owner cancellation (IM/worker); distinct from a reconnectable HTTP disconnect. */
  signal?: AbortSignal;
  chatSessionId?: string;
  /** The HTTP/SSE request signal: watched by the disconnect grace, never linked to the run directly. */
  requestSignal?: AbortSignal;
  timeoutMs?: number;
  /** Pre-opened session (Pi's JSON init-error path); otherwise lane.open() runs first. */
  session?: LaneSession;
  openInput?: LaneOpenInput;
  ledger: RuntimeLaneTurnLedgerSeed;
  capsule: AgentTurnCapsuleSeed;
  modeContract: MindosAgentModeContract;
  /** Extra metadata merged into completeAgentRun (permissionCompilation, context metadata…). */
  completionMetadata?: Record<string, unknown>;
  /** Extra metadata merged into every failAgentRun path. */
  failureMetadata?: Record<string, unknown>;
  disconnect?: RuntimeLaneDisconnectPort;
};

// ─── Terminal classification ────────────────────────────────────────────────

/**
 * Classify a terminal error into the ledger status. Semantics identical to the
 * web `agentRunErrorStatus` helper the three lanes used (now a re-export).
 */
export function classifyLaneTerminalStatus(
  error: unknown,
  signal?: AbortSignal,
): 'failed' | 'canceled' | 'timed_out' {
  if (signal?.aborted || isAbortLikeError(error)) return 'canceled';
  return (error as { code?: unknown })?.code === 'TIMEOUT' ? 'timed_out' : 'failed';
}

export function sendAgentRunContextFrame(
  send: (event: MindOSSSEvent) => void,
  run: AgentRunRecord,
): void {
  send({
    type: 'agent_run_context',
    rootRunId: run.rootRunId ?? run.id,
    ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
    startedAt: run.startedAt,
  } as unknown as MindOSSSEvent);
}

// ─── Capsule tools (single source; web turn-capsule.ts re-exports) ──────────

export function laneCapsuleRuntimeBinding(input: {
  kind: AgentRunCapsuleRuntimeBinding['runtime'];
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: AgentRunCapsuleRuntimeBinding['status'];
  updatedAt?: number;
}): AgentRunCapsuleRuntimeBinding | null {
  const externalSessionId = input.externalSessionId?.trim();
  if (!externalSessionId) return null;
  const type = input.kind === 'mindos'
    ? 'mindos-pi-session'
    : input.kind === 'codex'
      ? 'codex-thread'
      : input.kind === 'claude'
        ? 'claude-session'
        : 'acp-session';
  return {
    type,
    runtime: input.kind,
    runtimeId: input.runtimeId,
    externalSessionId,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    status: input.status ?? 'active',
    updatedAt: input.updatedAt ?? Date.now(),
  };
}

export function captureLaneTurnCapsule(
  run: AgentRunRecord,
  seed: AgentTurnCapsuleSeed,
  requestPatch: Partial<Pick<AgentRunCapsuleRequest, 'model' | 'thinkingEffort' | 'runtimeBinding'>> = {},
): void {
  try {
    createAgentRunCapsule(seed.mindRoot, {
      id: run.id,
      runId: run.id,
      rootRunId: run.rootRunId ?? run.id,
      ...(run.chatSessionId ? { chatSessionId: run.chatSessionId } : {}),
      source: seed.source,
      request: { ...seed.request, ...requestPatch },
      provenance: seed.provenance,
      status: run.status,
    });
  } catch (error) {
    failAgentRun(run.id, {
      error,
      metadata: { capsuleCapture: 'failed' },
    });
    throw new Error(
      `MindOS could not create a recovery capsule before starting the run: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function finalizeLaneTurnCapsule(input: {
  mindRoot: string;
  runId: string;
  status: AgentRunCapsuleStatus;
  runtimeBinding?: AgentRunCapsuleRuntimeBinding | null;
  outputText?: string;
}): void {
  try {
    finalizeAgentRunCapsule(input.mindRoot, input.runId, {
      status: input.status,
      ...(input.runtimeBinding !== undefined ? { runtimeBinding: input.runtimeBinding } : {}),
      ...(input.outputText !== undefined ? { outputText: input.outputText } : {}),
    });
  } catch (error) {
    const message = `Run recovery capsule could not be finalized: ${error instanceof Error ? error.message : String(error)}`;
    appendAgentRunEvent(input.runId, {
      type: 'error',
      category: 'error',
      message,
      data: { kind: 'error', message, code: 'CAPSULE_FINALIZE_FAILED', recoverable: true },
      visibility: 'timeline',
      metadata: { capsuleCoverage: 'degraded' },
    });
    console.error(`[agent-turn] ${message}`);
  }
}

// ─── Permission request shaping (single source, spec 方案 8 / task item 4) ──

type PermissionDecisionShape = {
  label: string;
  description?: string;
  intent: 'allow' | 'deny' | 'cancel';
  scope?: 'once' | 'session';
};

const RUNTIME_PERMISSION_DECISION_SHAPES: Record<string, PermissionDecisionShape> = {
  accept: {
    label: 'Allow once',
    description: 'Run this action one time.',
    intent: 'allow',
    scope: 'once',
  },
  acceptForSession: {
    label: 'Allow for session',
    description: 'Allow matching actions for the rest of this session.',
    intent: 'allow',
    scope: 'session',
  },
  decline: {
    label: 'Deny',
    description: 'Reject this action.',
    intent: 'deny',
  },
  deny: {
    label: 'Deny',
    description: 'Reject this action.',
    intent: 'deny',
  },
  cancel: {
    label: 'Cancel',
    description: 'Cancel the pending action.',
    intent: 'cancel',
  },
};

/**
 * Shape one decision id into the canonical option. Unknown ids (runtime-
 * specific decisions) degrade to a bare id/label option so callers can still
 * map server-provided decision lists (Codex `availableDecisions`).
 */
export function runtimePermissionDecisionOption(id: string): MindosRuntimePermissionOption {
  const shape = RUNTIME_PERMISSION_DECISION_SHAPES[id];
  if (!shape) return { id, label: id };
  return {
    id,
    label: shape.label,
    ...(shape.description ? { description: shape.description } : {}),
    intent: shape.intent,
    ...(shape.scope ? { scope: shape.scope } : {}),
  };
}

/** The standard three-option set; `allowSessionScope: false` drops acceptForSession. */
export function buildRuntimePermissionOptions(
  input: { allowSessionScope?: boolean } = {},
): MindosRuntimePermissionOption[] {
  const ids = input.allowSessionScope === false
    ? ['accept', 'decline']
    : ['accept', 'acceptForSession', 'decline'];
  return ids.map(runtimePermissionDecisionOption);
}

/**
 * Build the canonical runtime permission request shared by the Codex lane,
 * the Claude SDK lane and the Claude MCP shim (web). One shaping source keeps
 * the three surfaces from drifting (the shim used to hard-code two options
 * and treated `acceptForSession` as a denial).
 */
export function buildRuntimePermissionRequest(input: {
  runtime: MindosRuntimePermissionRequest['runtime'];
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason?: string;
  action?: string;
  resource?: string;
  risk?: MindosRuntimePermissionRisk;
  allowSessionScope?: boolean;
}): MindosRuntimePermissionRequest {
  return {
    runtime: input.runtime,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: input.input,
    options: buildRuntimePermissionOptions({ allowSessionScope: input.allowSessionScope }),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.resource ? { resource: input.resource } : {}),
    ...(input.risk ? { risk: input.risk } : {}),
  };
}

// ─── The single caller ──────────────────────────────────────────────────────

function cancelReasonToAbortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const message = typeof reason === 'string' && reason.trim()
    ? reason
    : 'Agent run was canceled.';
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Run one turn on a RuntimeLane. Owns, exactly once per turn:
 * run-ledger start/complete/fail, capsule capture/finalize, mode artifacts,
 * cancel-handler + client-disconnect grace (presence port), the turn deadline
 * (bridge-wait pauses), cancel/timeout classification, streamed-error-frame
 * capture (unified across lanes — the ACP gap from #323), and the bridge ALS.
 *
 * Terminal rules (identical to the three web lanes today):
 * - `result.error` / streamed error frame → fail, NO rethrow (the frame is on
 *   the wire already; the SSE shell must not send a second one);
 * - thrown error → fail + rethrow so the SSE shell emits the error frame.
 *
 * No caller-level retry: ACP retries live in `runMindosAcpAgentTurn`, the Pi
 * transport retries stay within the session runner, native has none.
 */
export async function runRuntimeLaneTurn(
  lane: RuntimeLane,
  input: RuntimeLaneTurnInput,
  send: (event: MindOSSSEvent) => void,
): Promise<void> {
  const session = input.session ?? await lane.open(input.openInput ?? {});
  let closed = false;
  const closeSession = async (keepExternalSession: boolean) => {
    if (closed) return;
    closed = true;
    await lane.close(session, { keepExternalSession }).catch(() => {});
  };

  const outerChatSessionId = session.ledgerPatch?.chatSessionId ?? input.chatSessionId;
  try {
    await runWithAgentRunContext(
      { ...(outerChatSessionId ? { chatSessionId: outerChatSessionId } : {}) },
      async () => {
        await runLaneTurnWithRun(session, lane, input, send, closeSession);
      },
    );
  } finally {
    await closeSession(false);
  }
}

async function runLaneTurnWithRun(
  session: LaneSession,
  lane: RuntimeLane,
  input: RuntimeLaneTurnInput,
  send: (event: MindOSSSEvent) => void,
  closeSession: (keepExternalSession: boolean) => Promise<void>,
): Promise<void> {
  const chatSessionId = session.ledgerPatch?.chatSessionId ?? input.chatSessionId;
  const run = startAgentRun({
    ...(input.capsule.runId ? { id: input.capsule.runId } : {}),
    agentKind: input.ledger.agentKind,
    runtimeId: input.ledger.runtimeId,
    displayName: input.ledger.displayName,
    ...(chatSessionId ? { chatSessionId } : {}),
    cwd: session.cwd,
    ...(input.ledger.permissionMode ? { permissionMode: input.ledger.permissionMode } : {}),
    inputSummary: input.ledger.inputSummary,
    ...(input.ledger.metadata ? { metadata: input.ledger.metadata } : {}),
  });
  captureLaneTurnCapsule(run, input.capsule, session.capsulePatch ?? {});

  let outputSummary = '';
  let streamedError: Error | undefined;
  const runAbort = new AbortController();
  const runSignal = runAbort.signal;
  const abortFromOwner = () => runAbort.abort(input.signal?.reason ?? new DOMException('Agent run canceled', 'AbortError'));
  if (input.signal?.aborted) abortFromOwner();
  else input.signal?.addEventListener('abort', abortFromOwner, { once: true });
  const unregisterCancelHandler = registerAgentRunCancelHandler(run.id, ({ reason }) => {
    if (runSignal.aborted) return;
    runAbort.abort(cancelReasonToAbortError(reason));
  });
  // The request signal is deliberately not linked to the run: a dropped SSE
  // stream must be reattachable. A client that never comes back cancels the
  // run after the disconnect grace instead of holding the runtime until the
  // turn timeout. Every lane rides the presence model through this port.
  const releaseDisconnectGrace = input.disconnect && input.requestSignal
    ? input.disconnect.arm({
      runId: run.id,
      rootRunId: run.rootRunId ?? run.id,
      requestSignal: input.requestSignal,
    })
    : undefined;

  const sendWithLedger = (event: MindOSSSEvent) => {
    if (event.type === 'text_delta') outputSummary += event.delta;
    // Unified across lanes: an error frame is a failed turn even when the
    // lane returns without a structured error result (#323 for Pi/native,
    // closed here for ACP too — its terminal frame always pairs with
    // result.error, so this adds no behaviour change there).
    if (event.type === 'error') streamedError = new Error(event.message);
    appendSseEventToAgentRun(run.id, event);
    send(event);
  };
  sendAgentRunContextFrame(send, run);

  const permissionRunId = randomUUID();
  const timeoutMs = input.timeoutMs ?? resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS);
  const deadline = createTurnDeadline({ timeoutMs });
  const unregisterDeadline = registerTurnDeadlineForRun(permissionRunId, deadline);
  const runContext: AgentRunContext = {
    ...(chatSessionId ? { chatSessionId } : {}),
    rootRunId: run.rootRunId ?? run.id,
    parentRunId: run.id,
  };
  const sink: LaneSink = {
    send: sendWithLedger,
    permissionRunId,
    runContext,
    requestPermission: (request, options) => requestRuntimePermissionViaBridge(request, options ?? {}),
    askUser: (request, options) => askUserQuestionViaBridge({
      toolCallId: request.toolCallId,
      params: { questions: request.questions },
      ...(options?.signal ? { signal: options.signal } : {}),
    }),
    updateRun: (patch) => {
      updateAgentRun(run.id, patch);
    },
  };

  const recordModeArtifacts = (runStatus: AgentRunStatus) => {
    const artifacts = createMindosAgentModeRunArtifacts({
      contract: input.modeContract,
      outputSummary,
      runStatus,
    });
    appendMindosAgentModeRunEvents(run.id, artifacts);
    return artifacts;
  };
  const finalizeCapsule = (status: AgentRunCapsuleStatus) => {
    finalizeLaneTurnCapsule({
      mindRoot: input.capsule.mindRoot,
      runId: run.id,
      status,
      outputText: outputSummary,
      ...(session.capsuleBinding !== undefined ? { runtimeBinding: session.capsuleBinding } : {}),
    });
  };

  const restoreResourceContext = session.agentRunContextResource
    ? setAgentRunContextForResource(session.agentRunContextResource, runContext)
    : undefined;

  try {
    if (runSignal.aborted) throw runSignal.reason;
    const result = await runWithAgentRunContext(runContext, () => runWithTurnDeadline(deadline, () => (
      runWithRuntimePermissionBridge({
        runId: permissionRunId,
        send: sendWithLedger,
      }, () => runWithAskUserQuestionBridge({
        runId: permissionRunId,
        send: (event) => sendWithLedger(event as unknown as MindOSSSEvent),
      }, () => lane.run(session, { signal: runSignal, timeoutMs }, sink)))
    )));
    // Some adapters emit a terminal error but return a session binding without
    // an error field. Preserve that failure instead of recording false success.
    const terminalError = result.error ?? streamedError;
    if (terminalError) {
      if (!streamedError) sendWithLedger({ type: 'error', message: terminalError.message });
      const terminalStatus = classifyLaneTerminalStatus(terminalError, runSignal);
      const modeArtifacts = recordModeArtifacts(terminalStatus);
      failAgentRun(run.id, {
        status: terminalStatus,
        error: terminalError,
        outputSummary,
        ...(session.archive ? { archive: session.archive } : {}),
        metadata: {
          ...mindosAgentModeArtifactsMetadata(modeArtifacts),
          ...(input.failureMetadata ?? {}),
          ...(session.metadata ?? {}),
        },
      });
      finalizeCapsule(terminalStatus);
      return;
    }

    const modeArtifacts = recordModeArtifacts('completed');
    completeAgentRun(run.id, {
      outputSummary,
      ...(session.archive ? { archive: session.archive } : {}),
      metadata: {
        ...mindosAgentModeArtifactsMetadata(modeArtifacts),
        ...(input.completionMetadata ?? {}),
        ...(session.metadata ?? {}),
      },
    });
    finalizeCapsule('completed');
    await closeSession(true);
  } catch (error) {
    const terminalStatus = classifyLaneTerminalStatus(error, runSignal);
    const modeArtifacts = recordModeArtifacts(terminalStatus);
    failAgentRun(run.id, {
      status: terminalStatus,
      error,
      outputSummary,
      ...(session.archive ? { archive: session.archive } : {}),
      metadata: {
        ...mindosAgentModeArtifactsMetadata(modeArtifacts),
        ...(input.failureMetadata ?? {}),
        ...(session.metadata ?? {}),
      },
    });
    finalizeCapsule(terminalStatus);
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', abortFromOwner);
    restoreResourceContext?.();
    releaseDisconnectGrace?.();
    unregisterCancelHandler();
    unregisterDeadline();
  }
}
