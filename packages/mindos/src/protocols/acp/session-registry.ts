/**
 * ACP session registry — the in-memory session table, admission control
 * (slot reservation + limits) and stale-session reaping.
 */

import { randomUUID } from 'node:crypto';
import type { AcpSession, AcpSessionState } from './types.js';
import type { AcpConnection } from './subprocess.js';
import {
  closeAgentConnection,
  DEFAULT_ACP_RPC_TIMEOUTS,
  type AcpRpcTimeouts,
} from './session-rpc.js';

export const sessions = new Map<string, AcpSession>();
export const sessionConnections = new Map<string, AcpConnection>();
const sessionTimeouts = new Map<string, AcpRpcTimeouts>();

export const MAX_SESSIONS_PER_AGENT = 3;
export const MAX_TOTAL_SESSIONS = 10;

/* ── Session-state events ─────────────────────────────────────────────── */

export type AcpSessionChangedState = 'idle' | 'active' | 'error' | 'closed';

/** Identity of a pooled ACP session (matches the lane's `MindosAcpSessionPoolKey`). */
export type AcpSessionPoolKey = {
  agentId: string;
  cwd: string;
  externalSessionId: string;
};

type AcpSessionChangedEvent = {
  type: 'acp.session.changed';
  agentId: string;
  sessionId: string;
  state: AcpSessionChangedState;
};

/**
 * Injectable for tests; the production default is a process-global emitter that
 * `server/events/bus.ts` registers at module load (`Symbol.for` registry, same
 * reasoning as `agent/global-state.ts`), forwarding to the server event bus so
 * `useRuntimeSessionProjection` refreshes on session state changes instead of
 * only at turn boundaries. The registry itself lives below the server layer and
 * must not import it (spec-knowledge-layering-and-export-surface). Emission
 * must never break the session lifecycle, so every failure is swallowed.
 */
let sessionChangedEmitter: ((event: AcpSessionChangedEvent) => void) | undefined;

const SESSION_CHANGED_EMITTER_KEY = Symbol.for('mindos.acpSessionChangedEmitter');

export function setAcpSessionChangedEmitterForTest(
  emitter: ((event: AcpSessionChangedEvent) => void) | undefined,
): void {
  sessionChangedEmitter = emitter;
}

function globalSessionChangedEmitter(): ((event: AcpSessionChangedEvent) => void) | undefined {
  const emitter = (globalThis as unknown as Record<symbol, unknown>)[SESSION_CHANGED_EMITTER_KEY];
  return typeof emitter === 'function' ? (emitter as (event: AcpSessionChangedEvent) => void) : undefined;
}

function emitAcpSessionChanged(sessionId: string, agentId: string, state: AcpSessionChangedState): void {
  try {
    const event: AcpSessionChangedEvent = { type: 'acp.session.changed', agentId, sessionId, state };
    const emitter = sessionChangedEmitter ?? globalSessionChangedEmitter();
    if (emitter) emitter(event);
  } catch {
    // Observers must not break session bookkeeping.
  }
}

/* ── Parked (pooled idle) sessions ────────────────────────────────────── */

type ParkedEntry = {
  key: AcpSessionPoolKey;
  parkedAt: number;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Idle, resumable sessions kept alive between turns so the next turn with the
 * same key skips the agent spawn + handshake. Lives beside `sessions` so the
 * two tables cannot drift; a parked session is still a registered session in
 * state `idle`.
 */
const parkedSessions = new Map<string, ParkedEntry>();

function clearParkedEntry(sessionId: string): void {
  const entry = parkedSessions.get(sessionId);
  if (!entry) return;
  clearTimeout(entry.timer);
  parkedSessions.delete(sessionId);
}

/**
 * Drop a parked session for good: free its slot synchronously and tear the
 * agent connection down in the background, keeping the agent-side session
 * (parked sessions are resumable, so a later turn can `session/load` it).
 */
function evictParkedSession(sessionId: string): void {
  const entry = parkedSessions.get(sessionId);
  clearParkedEntry(sessionId);
  const session = sessions.get(sessionId);
  const conn = sessionConnections.get(sessionId);
  if (!session && !conn && !entry) return;
  const timeouts = getSessionTimeouts(sessionId);
  unregisterSession(sessionId);
  if (conn) {
    void closeAgentConnection(conn, session?.agentSessionId ?? sessionId, {
      closeAgentSession: false,
      timeoutMs: timeouts.close,
      capabilities: session?.agentCapabilities,
    }).catch(() => {});
  }
}

/** Evict the least-recently-parked session (optionally scoped to one agent). True when one was evicted. */
function evictLeastRecentlyParked(agentId?: string): boolean {
  let oldestId: string | undefined;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [sessionId, entry] of parkedSessions) {
    if (agentId && entry.key.agentId !== agentId) continue;
    if (entry.parkedAt < oldestAt) {
      oldestAt = entry.parkedAt;
      oldestId = sessionId;
    }
  }
  if (!oldestId) return false;
  evictParkedSession(oldestId);
  return true;
}

/** Record a session as parked and start its idle TTL (fires `evictParkedSession`). */
export function parkSession(sessionId: string, key: AcpSessionPoolKey, idleTtlMs: number): void {
  clearParkedEntry(sessionId);
  const timer = setTimeout(() => evictParkedSession(sessionId), Math.max(1, idleTtlMs));
  timer.unref?.();
  parkedSessions.set(sessionId, { key, parkedAt: Date.now(), timer });
}

/** Remove and return the parked session id matching `key` (its TTL timer is cleared). */
export function takeParkedSession(key: AcpSessionPoolKey): string | undefined {
  for (const [sessionId, entry] of parkedSessions) {
    if (
      entry.key.agentId === key.agentId
      && entry.key.cwd === key.cwd
      && entry.key.externalSessionId === key.externalSessionId
    ) {
      clearParkedEntry(sessionId);
      return sessionId;
    }
  }
  return undefined;
}

export function isSessionParked(sessionId: string): boolean {
  return parkedSessions.has(sessionId);
}

/** Evict a specific parked session now (a taken session that failed validation). */
export function evictParkedAcpSession(sessionId: string): void {
  evictParkedSession(sessionId);
}

/** Clear every parked entry + timer without closing sessions (tests, hot reload). */
export function resetParkedSessionsForTest(): void {
  for (const sessionId of [...parkedSessions.keys()]) clearParkedEntry(sessionId);
}

/**
 * Slots reserved by createSessionFromEntry() / loadSession() calls that are
 * still awaiting the agent handshake. Counted alongside `sessions` so
 * concurrent opens cannot overshoot the limits during the async window.
 */
let pendingSessionTotal = 0;
const pendingSessionsPerAgent = new Map<string, number>();

export function reserveSessionSlot(agentId: string): () => void {
  pendingSessionTotal += 1;
  pendingSessionsPerAgent.set(agentId, (pendingSessionsPerAgent.get(agentId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pendingSessionTotal = Math.max(0, pendingSessionTotal - 1);
    const remaining = (pendingSessionsPerAgent.get(agentId) ?? 1) - 1;
    if (remaining <= 0) pendingSessionsPerAgent.delete(agentId);
    else pendingSessionsPerAgent.set(agentId, remaining);
  };
}

export function checkSessionLimits(agentId: string): void {
  // Idle pooled (parked) sessions yield their slot before a new open is
  // rejected: total-limit pressure evicts the least-recently-parked session of
  // any agent; per-agent pressure evicts that agent's least-recently-parked one.
  // Active (non-parked) sessions are never evicted, so the limits themselves
  // are unchanged.
  if (sessions.size + pendingSessionTotal >= MAX_TOTAL_SESSIONS) {
    evictLeastRecentlyParked();
  }
  if (sessions.size + pendingSessionTotal >= MAX_TOTAL_SESSIONS) {
    throw new Error(`Maximum concurrent sessions (${MAX_TOTAL_SESSIONS}) reached. Close existing sessions first.`);
  }
  const agentCount = () => [...sessions.values()].filter(s => s.agentId === agentId).length
    + (pendingSessionsPerAgent.get(agentId) ?? 0);
  if (agentCount() >= MAX_SESSIONS_PER_AGENT) {
    evictLeastRecentlyParked(agentId);
  }
  if (agentCount() >= MAX_SESSIONS_PER_AGENT) {
    throw new Error(`Maximum concurrent sessions for agent "${agentId}" (${MAX_SESSIONS_PER_AGENT}) reached.`);
  }
}

export function newLocalSessionId(agentId: string): string {
  // Random suffix: two creates in the same millisecond must not collide.
  return `ses-${agentId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function registerSession(session: AcpSession, conn: AcpConnection, timeouts: AcpRpcTimeouts): void {
  sessions.set(session.id, session);
  sessionConnections.set(session.id, conn);
  sessionTimeouts.set(session.id, timeouts);
  ensureReaper();
  emitAcpSessionChanged(session.id, session.agentId, session.state);
}

export function unregisterSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  clearParkedEntry(sessionId);
  sessions.delete(sessionId);
  sessionConnections.delete(sessionId);
  sessionTimeouts.delete(sessionId);
  activePrompts.delete(sessionId);
  stopReaperWhenIdle();
  if (session) emitAcpSessionChanged(sessionId, session.agentId, 'closed');
}

export function getSessionTimeouts(sessionId: string): AcpRpcTimeouts {
  return sessionTimeouts.get(sessionId) ?? DEFAULT_ACP_RPC_TIMEOUTS;
}

/** Local sessions already bound to the same agent-side session (a resume replaces them). */
export function findSessionsByAgentSessionId(agentId: string, agentSessionId: string): AcpSession[] {
  return [...sessions.values()].filter(
    (session) => session.agentId === agentId && session.agentSessionId === agentSessionId,
  );
}

export function getSessionAndConn(sessionId: string): { session: AcpSession; conn: AcpConnection } {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const conn = sessionConnections.get(sessionId);
  if (!conn?.process.alive) {
    updateSessionState(session, 'error');
    throw new Error(`Session process is dead: ${sessionId}`);
  }

  return { session, conn };
}

export function updateSessionState(session: AcpSession, state: AcpSessionState): void {
  session.state = state;
  session.lastActivityAt = new Date().toISOString();
  emitAcpSessionChanged(session.id, session.agentId, state);
}

/* ── Prompt ownership ─────────────────────────────────────────────────── */

/**
 * The prompt currently allowed to drive a session's state. `cancelPrompt`
 * hands the session to the next prompt before the cancelled RPC settles, so
 * a prompt may only flip the state to idle/error while it still owns it.
 */
const activePrompts = new Map<string, string>();

export function beginPrompt(session: AcpSession): string {
  const promptId = randomUUID();
  activePrompts.set(session.id, promptId);
  updateSessionState(session, 'active');
  return promptId;
}

export function settlePrompt(session: AcpSession, promptId: string, state: 'idle' | 'error'): boolean {
  if (activePrompts.get(session.id) !== promptId) return false;
  activePrompts.delete(session.id);
  updateSessionState(session, state);
  return true;
}

export function clearActivePrompt(session: AcpSession): void {
  activePrompts.delete(session.id);
}

/* ── Session reaping ──────────────────────────────────────────────────── */

const STALE_SESSION_MS = 30 * 60 * 1000; // 30 minutes
const REAP_INTERVAL_MS = 60 * 1000;
let reaperTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Reaping runs at admission (so a stale session never blocks a new one) and
 * on a timer that lives while any session exists. Read-only getters must not
 * reap: a GET /api/acp/session listing sessions should never kill processes.
 */
function ensureReaper(): void {
  if (reaperTimer) return;
  reaperTimer = setInterval(reapStaleSessions, REAP_INTERVAL_MS);
  reaperTimer.unref?.();
}

function stopReaperWhenIdle(): void {
  if (sessions.size > 0 || !reaperTimer) return;
  clearInterval(reaperTimer);
  reaperTimer = undefined;
}

export function reapStaleSessions(): void {
  const now = Date.now();
  // Snapshot first: the loop mutates the Map.
  for (const [id, session] of [...sessions]) {
    const lastActivity = new Date(session.lastActivityAt).getTime();
    if (now - lastActivity <= STALE_SESSION_MS || session.state === 'active') continue;
    // Free the slot synchronously so a limit check that runs right after this
    // sees it; the agent process is torn down in the background.
    const conn = sessionConnections.get(id);
    const timeouts = getSessionTimeouts(id);
    unregisterSession(id);
    if (conn) {
      void closeAgentConnection(conn, session.agentSessionId ?? id, {
        timeoutMs: timeouts.close,
        capabilities: session.agentCapabilities,
      }).catch(() => {});
    }
  }
}
