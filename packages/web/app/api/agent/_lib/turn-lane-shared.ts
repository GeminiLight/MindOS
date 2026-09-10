import type {
  MindosAgentRuntimeSelection,
  MindosRuntimeAttachment,
} from '@geminilight/mindos/agent/runtime';
import type { MindosSelectedSkill } from '@geminilight/mindos/agent';
import type { MindosAgentModeContract } from '@geminilight/mindos/agent/mode';
import type { createMindosAgentPermissionPolicy } from '@geminilight/mindos/agent/mindos-pi/permission';
import { getProcessGlobal } from '@geminilight/mindos/agent/global-state';
import { getAgentRun } from '@geminilight/mindos/agent/ledger/run-ledger';
import { cancelAgentRunWithHandlers } from '@geminilight/mindos/agent/ledger/run-cancellation';
import type {
  AcpRuntimeOptions,
  AgentPermissionMode,
  NativeRuntimeOptions,
  RuntimeSessionBinding,
  SessionContextSelection,
  SessionWorkDir,
} from '@/lib/types';
import type { AgentTurnRequestContext } from './turn-request';
import type { AgentTurnCapsuleSeed } from './turn-capsule';

export type RuntimeLanePermissionPolicy = ReturnType<typeof createMindosAgentPermissionPolicy>;

export type RuntimeLaneLocalization = { agentTimeout: string };

export type RuntimeLaneBaseInput = {
  externalPrompt: string;
  chatSessionId?: string;
  executionCwd: string;
  permissionPolicy: RuntimeLanePermissionPolicy;
  agentMode: string;
  agentModeContract: MindosAgentModeContract;
  sessionContextMetadata: Record<string, unknown>;
  fileContextMetadata: Record<string, unknown>;
  retrievalMetadata: Record<string, unknown>;
  sessionWorkDir: SessionWorkDir & { path: string };
  sessionContextSelection: SessionContextSelection;
  assistantId?: string;
  runtimeAttachments: MindosRuntimeAttachment[];
  selectedSkills: MindosSelectedSkill[];
  requestSignal: AbortSignal;
  t: RuntimeLaneLocalization;
  capsule: AgentTurnCapsuleSeed;
};

export type NativeRuntimeLaneTurnInput = RuntimeLaneBaseInput & {
  nativePermissionMode: AgentPermissionMode;
  nativeRuntimeOptions: NativeRuntimeOptions;
  nativeRuntimeEnv?: NodeJS.ProcessEnv;
  requestContext: AgentTurnRequestContext;
};

export type AcpRuntimeLaneTurnInput = RuntimeLaneBaseInput & {
  acpRuntimeOptions: AcpRuntimeOptions;
  acpRuntimeEnvOverlay?: Record<string, string | undefined>;
  runtimeBinding?: RuntimeSessionBinding | null;
};

export type RunNativeRuntimeLaneTurnInput = NativeRuntimeLaneTurnInput & {
  nativeRuntime: MindosAgentRuntimeSelection;
};

export type RunAcpRuntimeLaneTurnInput = AcpRuntimeLaneTurnInput & {
  acpAgent: { id: string; name: string };
};

// ─── Client presence / disconnect grace ─────────────────────────────────────
//
// A browser SSE drop and a closed tab look identical on the server (the
// request signal aborts). The native lane must survive the former so the
// client can reattach through /api/agent-runs/reattach, but must not keep a
// codex/claude process alive for the full 600 s timeout after the latter.
// Presence counts every attached client (the original turn stream and every
// reattach stream); a run is canceled only after it has had no client for a
// whole grace window.
//
// The turns route and the reattach route are separate Next.js bundles, so the
// table is shared through the realm-wide symbol registry, like the ledger's
// cancel handlers. The key is Web-host state, not an agent-core key.

export const DEFAULT_AGENT_RUN_CLIENT_DISCONNECT_GRACE_MS = 60_000;

const AGENT_RUN_CLIENT_PRESENCE_KEY = Symbol.for('mindos.web.agentRunClientPresence');

type AgentRunClientPresence = {
  watchers: number;
  /** Set while the lane is armed; cleared when the run ends. */
  onIdle?: () => void;
  onAttached?: () => void;
};

function presenceTable(): Map<string, AgentRunClientPresence> {
  return getProcessGlobal(AGENT_RUN_CLIENT_PRESENCE_KEY, () => new Map<string, AgentRunClientPresence>());
}

function presenceFor(rootRunId: string): AgentRunClientPresence {
  const table = presenceTable();
  const existing = table.get(rootRunId);
  if (existing) return existing;
  const created: AgentRunClientPresence = { watchers: 0 };
  table.set(rootRunId, created);
  return created;
}

function dropPresenceIfUnused(rootRunId: string): void {
  const table = presenceTable();
  const entry = table.get(rootRunId);
  if (entry && entry.watchers === 0 && !entry.onIdle && !entry.onAttached) table.delete(rootRunId);
}

export function resolveAgentRunClientDisconnectGraceMs(
  raw: string | undefined = process.env.MINDOS_AGENT_CLIENT_DISCONNECT_GRACE_MS,
): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_AGENT_RUN_CLIENT_DISCONNECT_GRACE_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_AGENT_RUN_CLIENT_DISCONNECT_GRACE_MS;
}

/**
 * Count a client as attached to `rootRunId` until `signal` aborts or the
 * returned release function runs (whichever comes first). A signal that is
 * already aborted counts as an immediate detach.
 */
export function watchAgentRunClient(rootRunId: string, signal: AbortSignal | undefined): () => void {
  const entry = presenceFor(rootRunId);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal?.removeEventListener('abort', release);
    entry.watchers = Math.max(0, entry.watchers - 1);
    if (entry.watchers === 0) entry.onIdle?.();
    dropPresenceIfUnused(rootRunId);
  };

  entry.watchers += 1;
  entry.onAttached?.();
  if (signal?.aborted) {
    release();
    return () => {};
  }
  signal?.addEventListener('abort', release, { once: true });
  return release;
}

/**
 * Arm the disconnect grace for a lane-owned run. Cancels the run through
 * the ledger (so the cancel handler aborts the runtime and the ledger records
 * `canceled`) once every client has been gone for `graceMs`. Returns the
 * disposer the lane must call when the run ends.
 */
export function armAgentRunClientDisconnectCancel(input: {
  runId: string;
  rootRunId: string;
  requestSignal: AbortSignal;
  graceMs?: number;
}): () => void {
  const graceMs = input.graceMs ?? resolveAgentRunClientDisconnectGraceMs();
  const entry = presenceFor(input.rootRunId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const cancelForDisconnect = () => {
    timer = undefined;
    if (disposed || entry.watchers > 0) return;
    const record = getAgentRun(input.runId);
    if (!record || isTerminalRunStatus(record.status)) return;
    void cancelAgentRunWithHandlers(input.runId, {
      reason: `Client disconnected and did not reattach within ${Math.round(graceMs / 1000)}s.`,
      metadata: {
        canceledBy: 'client-disconnect',
        source: 'native-lane-disconnect-grace',
        graceMs,
      },
    });
  };

  entry.onIdle = () => {
    if (disposed) return;
    clearTimer();
    timer = setTimeout(cancelForDisconnect, graceMs);
  };
  entry.onAttached = () => {
    clearTimer();
  };

  const releaseRequestWatch = watchAgentRunClient(input.rootRunId, input.requestSignal);

  return () => {
    if (disposed) return;
    disposed = true;
    clearTimer();
    entry.onIdle = undefined;
    entry.onAttached = undefined;
    releaseRequestWatch();
    dropPresenceIfUnused(input.rootRunId);
  };
}

function isTerminalRunStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'timed_out';
}

/** Test hook: forget every tracked run. */
export function resetAgentRunClientPresenceForTest(): void {
  presenceTable().clear();
}
