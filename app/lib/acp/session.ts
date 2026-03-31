/**
 * ACP Session Manager — High-level session lifecycle for ACP agents.
 * Manages session creation, prompt turns, cancellation, and cleanup.
 */

import type {
  AcpSession,
  AcpSessionState,
  AcpSessionUpdate,
  AcpPromptResponse,
  AcpRegistryEntry,
} from './types';
import {
  spawnAcpAgent,
  sendAndWait,
  sendMessage,
  onMessage,
  killAgent,
  type AcpProcess,
} from './subprocess';
import { findAcpAgent } from './registry';

/* ── State ─────────────────────────────────────────────────────────────── */

const sessions = new Map<string, AcpSession>();
const sessionProcesses = new Map<string, AcpProcess>();

/* ── Public API ────────────────────────────────────────────────────────── */

/**
 * Create a new ACP session by spawning an agent process.
 */
export async function createSession(
  agentId: string,
  options?: { env?: Record<string, string> },
): Promise<AcpSession> {
  const entry = await findAcpAgent(agentId);
  if (!entry) {
    throw new Error(`ACP agent not found in registry: ${agentId}`);
  }

  return createSessionFromEntry(entry, options);
}

/**
 * Create a session from a known registry entry (skips registry lookup).
 */
export async function createSessionFromEntry(
  entry: AcpRegistryEntry,
  options?: { env?: Record<string, string> },
): Promise<AcpSession> {
  const proc = spawnAcpAgent(entry, options);

  // Send session/new and wait for ack
  try {
    const response = await sendAndWait(proc, 'session/new', {}, 15_000);

    if (response.error) {
      killAgent(proc);
      throw new Error(`session/new failed: ${response.error.message}`);
    }
  } catch (err) {
    killAgent(proc);
    throw err;
  }

  const sessionId = `ses-${entry.id}-${Date.now()}`;
  const session: AcpSession = {
    id: sessionId,
    agentId: entry.id,
    state: 'idle',
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };

  sessions.set(sessionId, session);
  sessionProcesses.set(sessionId, proc);
  return session;
}

/**
 * Send a prompt to an active session and collect the full response.
 * For streaming, use promptStream() instead.
 */
export async function prompt(
  sessionId: string,
  text: string,
): Promise<AcpPromptResponse> {
  const { session, proc } = getSessionAndProc(sessionId);

  if (session.state === 'active') {
    throw new Error(`Session ${sessionId} is busy processing another prompt`);
  }

  updateSessionState(session, 'active');

  try {
    const response = await sendAndWait(proc, 'session/prompt', { text }, 60_000);

    if (response.error) {
      updateSessionState(session, 'error');
      throw new Error(`session/prompt error: ${response.error.message}`);
    }

    updateSessionState(session, 'idle');
    const result = response.result as Record<string, unknown>;
    return {
      sessionId,
      text: String(result?.text ?? ''),
      done: true,
      toolCalls: result?.toolCalls as AcpPromptResponse['toolCalls'],
      metadata: result?.metadata as AcpPromptResponse['metadata'],
    };
  } catch (err) {
    updateSessionState(session, 'error');
    throw err;
  }
}

/**
 * Send a prompt and receive streaming updates via callback.
 * Returns the final aggregated response.
 */
export async function promptStream(
  sessionId: string,
  text: string,
  onUpdate: (update: AcpSessionUpdate) => void,
): Promise<AcpPromptResponse> {
  const { session, proc } = getSessionAndProc(sessionId);

  if (session.state === 'active') {
    throw new Error(`Session ${sessionId} is busy processing another prompt`);
  }

  updateSessionState(session, 'active');

  return new Promise((resolve, reject) => {
    let aggregatedText = '';

    const unsub = onMessage(proc, (msg) => {
      // Handle streaming notifications (no id field, or notification pattern)
      if (msg.result && typeof msg.result === 'object') {
        const update = msg.result as Record<string, unknown>;
        const sessionUpdate: AcpSessionUpdate = {
          sessionId,
          type: (update.type as AcpSessionUpdate['type']) ?? 'text',
          text: update.text as string | undefined,
          toolCall: update.toolCall as AcpSessionUpdate['toolCall'],
          toolResult: update.toolResult as AcpSessionUpdate['toolResult'],
          error: update.error as string | undefined,
        };

        onUpdate(sessionUpdate);

        if (sessionUpdate.type === 'text' && sessionUpdate.text) {
          aggregatedText += sessionUpdate.text;
        }

        if (sessionUpdate.type === 'done') {
          unsub();
          updateSessionState(session, 'idle');
          resolve({
            sessionId,
            text: aggregatedText,
            done: true,
          });
        }

        if (sessionUpdate.type === 'error') {
          unsub();
          updateSessionState(session, 'error');
          reject(new Error(sessionUpdate.error ?? 'Unknown ACP error'));
        }
      }
    });

    // Send the prompt
    try {
      sendMessage(proc, 'session/prompt', { text, stream: true });
    } catch (err) {
      unsub();
      updateSessionState(session, 'error');
      reject(err);
    }
  });
}

/**
 * Cancel the current prompt turn on a session.
 */
export async function cancelPrompt(sessionId: string): Promise<void> {
  const { session, proc } = getSessionAndProc(sessionId);

  if (session.state !== 'active') return;

  try {
    await sendAndWait(proc, 'session/cancel', {}, 5_000);
  } catch {
    // Best-effort cancel — don't throw if the agent doesn't support it
  }

  updateSessionState(session, 'idle');
}

/**
 * Close a session and terminate the subprocess.
 */
export async function closeSession(sessionId: string): Promise<void> {
  const proc = sessionProcesses.get(sessionId);

  if (proc?.alive) {
    try {
      await sendAndWait(proc, 'session/close', {}, 5_000);
    } catch {
      // Best-effort close
    }
    killAgent(proc);
  }

  sessions.delete(sessionId);
  sessionProcesses.delete(sessionId);
}

/**
 * Get a session by its ID.
 */
export function getSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Get all active sessions.
 */
export function getActiveSessions(): AcpSession[] {
  return [...sessions.values()];
}

/**
 * Close all active sessions. Used for cleanup.
 */
export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.allSettled(ids.map(id => closeSession(id)));
}

/* ── Internal ──────────────────────────────────────────────────────────── */

function getSessionAndProc(sessionId: string): { session: AcpSession; proc: AcpProcess } {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const proc = sessionProcesses.get(sessionId);
  if (!proc?.alive) {
    updateSessionState(session, 'error');
    throw new Error(`Session process is dead: ${sessionId}`);
  }

  return { session, proc };
}

function updateSessionState(session: AcpSession, state: AcpSessionState): void {
  session.state = state;
  session.lastActivityAt = new Date().toISOString();
}
