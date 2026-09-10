/**
 * ACP session pool — the public lifecycle the Web turn lane uses to keep a
 * resumable agent session alive between turns.
 *
 * The parked table itself lives in `session-registry.ts` (beside `sessions`, so
 * the two cannot drift); this module adds the reuse/park validation and the
 * global pooling switch. A session is pooled only when it is alive, idle,
 * resumable (`loadSession`) and matches the requested (cwd, externalSessionId),
 * so a stale or wedged session is closed instead of handed back.
 */

import {
  isProcessPoolingEnabled,
  resolveIdleTtlMs,
} from '../../agent/runtime/process-supervisor.js';
import type { AcpSession } from './types.js';
import {
  evictParkedAcpSession,
  parkSession,
  resetParkedSessionsForTest,
  sessionConnections,
  sessions,
  takeParkedSession,
  type AcpSessionPoolKey,
} from './session-registry.js';

export const ACP_SESSION_IDLE_TTL_MS = 60_000;
export const ACP_SESSION_IDLE_TTL_ENV = 'MINDOS_ACP_SESSION_IDLE_TTL_MS';

function resolveAcpSessionIdleTtlMs(): number {
  return resolveIdleTtlMs(ACP_SESSION_IDLE_TTL_ENV, ACP_SESSION_IDLE_TTL_MS);
}

function isReusablePooledSession(
  session: AcpSession | undefined,
  connAlive: boolean,
  key: AcpSessionPoolKey,
): session is AcpSession {
  return !!session
    && connAlive
    && session.state === 'idle'
    && session.agentSessionId === key.externalSessionId
    && (session.cwd ?? undefined) === key.cwd;
}

/**
 * Take the live pooled session for `key`, or `undefined` when there is none (or
 * the parked one died / drifted while idle, in which case it is closed). The
 * returned session is a normal registered session in state `idle`; the caller
 * runs its prompt and then parks it again with `parkAcpSession`.
 */
export function takePooledAcpSession(key: AcpSessionPoolKey): AcpSession | undefined {
  const sessionId = takeParkedSession(key);
  if (!sessionId) return undefined;
  const session = sessions.get(sessionId);
  const conn = sessionConnections.get(sessionId);
  if (isReusablePooledSession(session, !!conn?.process.alive, key)) {
    return session;
  }
  // Taken but unusable: free the slot and tear the (possibly dead) agent down.
  evictParkedAcpSession(sessionId);
  return undefined;
}

/**
 * Park a finished session for reuse by the next turn with the same key. Returns
 * true when parked (the lane must not close it) and false when it cannot be
 * pooled (pooling off, dead process, not idle, unresumable, identity mismatch),
 * in which case the lane closes it as before.
 */
export function parkAcpSession(
  sessionId: string,
  key: AcpSessionPoolKey,
  options?: { idleTtlMs?: number },
): boolean {
  if (!isProcessPoolingEnabled()) return false;
  const session = sessions.get(sessionId);
  const conn = sessionConnections.get(sessionId);
  if (!session || !conn?.process.alive) return false;
  if (!session.agentCapabilities?.loadSession) return false;
  if (!isReusablePooledSession(session, true, key)) return false;
  parkSession(sessionId, key, options?.idleTtlMs ?? resolveAcpSessionIdleTtlMs());
  return true;
}

/** Clear every parked entry and its TTL timer (tests, hot reload). Sessions stay registered; close them via `closeAllSessions`. */
export function resetAcpSessionPoolForTest(): void {
  resetParkedSessionsForTest();
}
