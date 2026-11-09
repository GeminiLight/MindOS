/**
 * ACP Session Manager — High-level session lifecycle for ACP agents.
 * Uses @agentclientprotocol/sdk for all protocol handling.
 * Implements: initialize → session/new → session/prompt → session/cancel → close.
 *
 * Helpers live next door: session-rpc (handshake RPCs), session-registry
 * (table + admission), session-callbacks (update folding), session-parsers
 * (response parsing) and session-snapshot (read-only projections).
 */

import type {
  AcpSession,
  AcpSessionUpdate,
  AcpPromptResponse,
  AcpRegistryEntry,
  AcpMode,
  AcpConfigOption,
  AcpSessionInfo,
  AcpStopReason,
  AcpContentBlock,
  AcpSessionSnapshot,
} from './types.js';
import { isAcpCapabilitySupported } from './types.js';
import { buildAcpPromptBlocks, type AcpPromptImage } from './prompt-blocks.js';
import { killAgent } from './subprocess.js';
import { findAcpAgent } from './registry.js';
import { resolveConfiguredAcpAgentEntry } from './agent-descriptors.js';
import { rememberAcpHandshakeHealth } from './handshake-health.js';
import {
  AcpAuthenticationError,
  callAcpRpc,
  cancelAgentPromptBestEffort,
  closeAgentConnection,
  initializeAcpConnection,
  isAbortedBy,
  openAcpSessionWithAuth,
  resolveSessionMcpInheritance,
  type AcpSessionOptions,
} from './session-rpc.js';
import {
  beginPrompt,
  checkSessionLimits,
  clearActivePrompt,
  findSessionsByAgentSessionId,
  getSessionAndConn,
  getSessionTimeouts,
  newLocalSessionId,
  reapStaleSessions,
  registerSession,
  reserveSessionSlot,
  sessionConnections,
  sessions,
  settlePrompt,
  unregisterSession,
  updateSessionState,
} from './session-registry.js';
import {
  applySessionUpdate,
  installPromptCallbacks,
  sdkNotificationToUpdate,
} from './session-callbacks.js';
import {
  currentModeFromConfig,
  normalizeAcpSessionInfo,
  parseConfigOptions,
  parseCurrentModeId,
  parseModes,
} from './session-parsers.js';
import { buildAcpSessionSnapshot } from './session-snapshot.js';
import { resolveMindosAgentTimeoutMs } from '../../agent/turn/index.js';

export type { AcpSessionOptions } from './session-rpc.js';
export { buildAcpSessionSnapshot } from './session-snapshot.js';

export type AcpPromptOptions = {
  /**
   * Deadline for the whole prompt turn. Defaults to the agent turn budget
   * (`MINDOS_AGENT_TIMEOUT_MS`, 10 minutes) so the session layer never
   * cancels an agent that the lane is still willing to wait for.
   */
  timeoutMs?: number;
  /** Cancels the agent turn (best effort) and rejects the prompt when aborted. */
  signal?: AbortSignal;
  /** Attached images; only sent to agents that declared `promptCapabilities.image`. */
  images?: readonly AcpPromptImage[];
};

/* ── Public API — Session Lifecycle ───────────────────────────────────── */

/**
 * Create a new ACP session by spawning an agent process.
 */
export async function createSession(
  agentId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  const entry = await resolveAgentEntry(agentId, options);
  return createSessionFromEntry(entry, options);
}

/**
 * Create a session from a known registry entry (skips registry lookup).
 */
export function createSessionFromEntry(
  entry: AcpRegistryEntry,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  return withReservedSlot(entry.id, () => createSessionFromEntryReserved(entry, options));
}

async function resolveAgentEntry(agentId: string, options?: AcpSessionOptions): Promise<AcpRegistryEntry> {
  const entry = resolveConfiguredAcpAgentEntry(agentId, options?.overrides)
    ?? await findAcpAgent(agentId);
  if (!entry) {
    throw new Error(`ACP agent not found in registry: ${agentId}`);
  }
  return entry;
}

/**
 * Admission control shared by create and load: free idle slots first so a
 * stale session never blocks a new one, then reserve a slot synchronously
 * before any await so concurrent opens cannot overshoot the limits.
 */
async function withReservedSlot<T>(agentId: string, open: () => Promise<T>): Promise<T> {
  reapStaleSessions();
  checkSessionLimits(agentId);
  const releaseSlot = reserveSessionSlot(agentId);
  try {
    return await open();
  } finally {
    releaseSlot();
  }
}

async function createSessionFromEntryReserved(
  entry: AcpRegistryEntry,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  const startedAt = Date.now();
  const sessionCwd = options?.cwd ?? process.cwd();
  const initialized = await initializeAcpConnection(entry, options, startedAt);
  const { conn, agentCapabilities, authMethods, timeouts } = initialized;

  // Phase 3: session/new
  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;
  let currentModeId: string | undefined;
  let agentSessionId: string | undefined;
  const mcpInheritance = resolveSessionMcpInheritance(options, agentCapabilities);

  try {
    const newResult = await openAcpSessionWithAuth({
      entry,
      initialized,
      label: 'session/new',
      signal: options?.signal,
      startedAt,
      run: () => conn.connection.newSession({
        cwd: sessionCwd,
        mcpServers: mcpInheritance.servers,
      }),
    });

    if (typeof newResult.sessionId === 'string') {
      agentSessionId = newResult.sessionId;
    }
    modes = parseModes(newResult.modes);
    currentModeId = parseCurrentModeId(newResult.modes);
    configOptions = parseConfigOptions(newResult.configOptions);
    currentModeId ??= currentModeFromConfig(configOptions);
  } catch (sessionErr) {
    killAgent(conn.process);
    // Aborts are not health facts; authentication failures were already recorded at their own stage.
    if (isAbortedBy(options?.signal, sessionErr) || sessionErr instanceof AcpAuthenticationError) throw sessionErr;
    const msg = (sessionErr as Error).message ?? '';
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-new',
      startedAt,
      message: msg,
      capabilities: agentCapabilities,
    });
    throw new Error(`${entry.id}: session/new failed: ${msg}`);
  }

  const sessionId = newLocalSessionId(entry.id);
  const session: AcpSession = {
    id: sessionId,
    agentId: entry.id,
    agentSessionId,
    state: 'idle',
    cwd: options?.cwd,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    agentCapabilities,
    modes,
    configOptions,
    currentModeId,
    authMethods,
    mcpServers: mcpInheritance.summaries,
  };

  registerSession(session, conn, timeouts);
  rememberAcpHandshakeHealth({
    agentId: entry.id,
    status: 'ready',
    stage: 'session-new',
    startedAt,
    capabilities: agentCapabilities,
    session,
  });
  return session;
}

/**
 * Reopen an existing agent-side session. Goes through the same admission
 * control as create; the local id is fresh, `agentSessionId` carries the
 * agent-side id being reopened.
 */
export async function loadSession(
  agentId: string,
  existingSessionId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  return loadSessionFromEntry(await resolveAgentEntry(agentId, options), existingSessionId, options);
}

/** {@link loadSession} for a known registry entry (skips registry lookup). */
export function loadSessionFromEntry(
  entry: AcpRegistryEntry,
  existingSessionId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  return withReservedSlot(entry.id, () => openExistingSessionReserved(entry, existingSessionId, 'reopen', options));
}

/**
 * Branch an agent-side session into a new one (`session/fork`). The returned
 * session is live on its own connection; the source session is left untouched.
 */
export async function forkSession(
  agentId: string,
  sourceSessionId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  return forkSessionFromEntry(await resolveAgentEntry(agentId, options), sourceSessionId, options);
}

/** {@link forkSession} for a known registry entry (skips registry lookup). */
export function forkSessionFromEntry(
  entry: AcpRegistryEntry,
  sourceSessionId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  return withReservedSlot(entry.id, () => openExistingSessionReserved(entry, sourceSessionId, 'fork', options));
}

type ExistingSessionMethod = 'session/resume' | 'session/load' | 'session/fork';

/**
 * `session/resume` restores a session without replaying its history, so it is
 * preferred; `session/load` (which streams the whole history back) remains for
 * agents that only offer that.
 */
function chooseExistingSessionMethod(
  intent: 'reopen' | 'fork',
  capabilities: AcpSession['agentCapabilities'],
): ExistingSessionMethod | null {
  if (intent === 'fork') return isAcpCapabilitySupported(capabilities?.sessionCapabilities?.fork) ? 'session/fork' : null;
  if (isAcpCapabilitySupported(capabilities?.sessionCapabilities?.resume)) return 'session/resume';
  return capabilities?.loadSession ? 'session/load' : null;
}

/**
 * Codex cannot fork a thread that is still open in another app-server process:
 * the fork opens, then its first turn fails because the thread's encrypted
 * reasoning cannot be read. So release idle local sessions holding the source
 * first (the agent-side session stays; the next turn on it resumes). A turn in
 * flight is never killed for a fork.
 */
async function releaseLocalHoldersOfForkSource(agentId: string, sourceSessionId: string): Promise<void> {
  const holders = findSessionsByAgentSessionId(agentId, sourceSessionId);
  if (holders.some((holder) => holder.state === 'active')) {
    throw new Error('Cannot fork this session while a turn is still running on it. Wait for the turn to finish.');
  }
  for (const holder of holders) await closeSession(holder.id, { closeAgentSession: false });
}

async function openExistingSessionReserved(
  entry: AcpRegistryEntry,
  existingSessionId: string,
  intent: 'reopen' | 'fork',
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  if (intent === 'fork') await releaseLocalHoldersOfForkSource(entry.id, existingSessionId);
  const startedAt = Date.now();
  const loadCwd = options?.cwd ?? process.cwd();
  const initialized = await initializeAcpConnection(entry, options, startedAt);
  const { conn, agentCapabilities, authMethods, timeouts } = initialized;

  const method = chooseExistingSessionMethod(intent, agentCapabilities);
  if (!method) {
    const message = intent === 'fork'
      ? `Agent ${entry.id} does not support session/fork`
      : `Agent ${entry.id} does not support session/resume or session/load`;
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-load',
      startedAt,
      message,
      capabilities: agentCapabilities,
    });
    killAgent(conn.process);
    throw new Error(message);
  }

  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;
  let currentModeId: string | undefined;
  const mcpInheritance = resolveSessionMcpInheritance(options, agentCapabilities);
  let loadedInfo: AcpSessionInfo = { sessionId: existingSessionId };
  let agentSessionId = existingSessionId;

  try {
    const request = { sessionId: existingSessionId, cwd: loadCwd, mcpServers: mcpInheritance.servers };
    const loadResult = await openAcpSessionWithAuth({
      entry,
      initialized,
      label: method,
      signal: options?.signal,
      startedAt,
      run: async () => {
        if (method === 'session/fork') {
          const forked = await conn.connection.unstable_forkSession(request);
          agentSessionId = forked.sessionId;
          return forked;
        }
        return method === 'session/resume'
          ? conn.connection.resumeSession(request)
          : conn.connection.loadSession(request);
      },
    });
    modes = parseModes(loadResult.modes);
    currentModeId = parseCurrentModeId(loadResult.modes);
    configOptions = parseConfigOptions(loadResult.configOptions);
    currentModeId ??= currentModeFromConfig(configOptions);
    loadedInfo = normalizeAcpSessionInfo(loadResult, agentSessionId);
  } catch (err) {
    killAgent(conn.process);
    if (isAbortedBy(options?.signal, err) || err instanceof AcpAuthenticationError) throw err;
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-load',
      startedAt,
      message: (err as Error).message,
      capabilities: agentCapabilities,
    });
    throw new Error(`${method} failed: ${(err as Error).message}`);
  }

  // A reopened agent-side session now lives on this connection: release any
  // local session still bound to it, keeping the agent's session. A fork is a
  // new session, so the source's local sessions stay as they are.
  if (intent === 'reopen') {
    for (const previous of findSessionsByAgentSessionId(entry.id, existingSessionId)) {
      await closeSession(previous.id, { closeAgentSession: false });
    }
  }

  const session: AcpSession = {
    id: newLocalSessionId(entry.id),
    agentId: entry.id,
    agentSessionId,
    state: 'idle',
    cwd: options?.cwd,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    agentCapabilities,
    modes,
    configOptions,
    currentModeId,
    authMethods,
    mcpServers: mcpInheritance.summaries,
    ...(loadedInfo.title ? { title: loadedInfo.title } : {}),
    ...(loadedInfo.preview ? { preview: loadedInfo.preview } : {}),
    ...(loadedInfo.messageCount !== undefined ? { messageCount: loadedInfo.messageCount } : {}),
    ...(loadedInfo.turnCount !== undefined ? { turnCount: loadedInfo.turnCount } : {}),
    ...(loadedInfo.messages ? { messages: loadedInfo.messages } : {}),
    ...(loadedInfo.turns ? { turns: loadedInfo.turns } : {}),
    ...(loadedInfo.title || loadedInfo.updatedAt ? {
      sessionInfo: {
        ...(loadedInfo.title ? { title: loadedInfo.title } : {}),
        ...(loadedInfo.updatedAt ? { updatedAt: loadedInfo.updatedAt } : {}),
      },
    } : {}),
  };

  registerSession(session, conn, timeouts);
  rememberAcpHandshakeHealth({
    agentId: entry.id,
    status: 'ready',
    stage: 'session-load',
    startedAt,
    capabilities: agentCapabilities,
    session,
  });
  return session;
}

/**
 * List resumable sessions from the agent.
 */
export async function listSessions(
  sessionId: string,
  options?: { cursor?: string; cwd?: string },
): Promise<{ sessions: AcpSessionInfo[]; nextCursor?: string }> {
  const { session, conn } = getSessionAndConn(sessionId);

  if (!isAcpCapabilitySupported(session.agentCapabilities?.sessionCapabilities?.list)) {
    throw new Error('Agent does not support session/list');
  }

  const result = await callAcpRpc(() => conn.connection.listSessions({
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  }), { label: 'session/list', timeoutMs: getSessionTimeouts(sessionId).sessionList });

  return {
    sessions: (result.sessions ?? []).map(s => normalizeAcpSessionInfo(s)),
    nextCursor: result.nextCursor ?? undefined,
  };
}

export async function listSessionsForAgent(
  agentId: string,
  options?: AcpSessionOptions & { cursor?: string; cwd?: string },
): Promise<{ sessions: AcpSessionInfo[]; nextCursor?: string }> {
  const startedAt = Date.now();
  const entry = await resolveAgentEntry(agentId, options);

  const { conn, agentCapabilities, timeouts } = await initializeAcpConnection(entry, options, startedAt);

  if (!isAcpCapabilitySupported(agentCapabilities?.sessionCapabilities?.list)) {
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'ready',
      stage: 'session-list',
      startedAt,
      message: 'Agent does not support session/list',
      capabilities: agentCapabilities,
    });
    killAgent(conn.process);
    throw new Error('Agent does not support session/list');
  }

  try {
    const result = await callAcpRpc(() => conn.connection.listSessions({
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.cwd ? { cwd: options.cwd } : {}),
    }), { label: 'session/list', timeoutMs: timeouts.sessionList, signal: options?.signal });
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'ready',
      stage: 'session-list',
      startedAt,
      capabilities: agentCapabilities,
    });
    return {
      sessions: (result.sessions ?? []).map(s => normalizeAcpSessionInfo(s)),
      nextCursor: result.nextCursor ?? undefined,
    };
  } catch (err) {
    if (isAbortedBy(options?.signal, err)) throw err;
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-list',
      startedAt,
      message: (err as Error).message,
      capabilities: agentCapabilities,
    });
    throw new Error(`session/list failed: ${(err as Error).message}`);
  } finally {
    killAgent(conn.process);
  }
}

/* ── Public API — Prompt ──────────────────────────────────────────────── */

/**
 * Send a prompt and collect the full response.
 * Text arrives via session/update notifications (handled by SDK → Client.sessionUpdate).
 */
export function prompt(
  sessionId: string,
  text: string,
  options: AcpPromptOptions = {},
): Promise<AcpPromptResponse> {
  return runPrompt(sessionId, text, options);
}

/**
 * Send a prompt and receive streaming updates via callback.
 */
export function promptStream(
  sessionId: string,
  text: string,
  onUpdate: (update: AcpSessionUpdate) => void,
  options: AcpPromptOptions = {},
): Promise<AcpPromptResponse> {
  return runPrompt(sessionId, text, { ...options, onUpdate });
}

async function runPrompt(
  sessionId: string,
  text: string,
  options: AcpPromptOptions & { onUpdate?: (update: AcpSessionUpdate) => void },
): Promise<AcpPromptResponse> {
  const { session, conn } = getSessionAndConn(sessionId);

  if (session.state === 'active') {
    throw new Error(`Session ${sessionId} is busy processing another prompt`);
  }

  const promptId = beginPrompt(session);
  const wireSessionId = session.agentSessionId ?? sessionId;
  const onUpdate = options.onUpdate;
  const timeoutMs = options.timeoutMs ?? resolveMindosAgentTimeoutMs(process.env.MINDOS_AGENT_TIMEOUT_MS);

  let aggregatedText = '';
  const releaseCallbacks = installPromptCallbacks(conn, {
    onSessionUpdate: (params) => {
      const update = sdkNotificationToUpdate(sessionId, params);
      applySessionUpdate(session, update);
      if (['available_commands_update', 'current_mode_update', 'config_option_update'].includes(update.type)) updateSessionState(session, session.state);
      onUpdate?.(update);
      if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
        aggregatedText += update.text;
      }
    },
    onPermissionRequest: (event) => {
      const update: AcpSessionUpdate = { sessionId, type: 'permission_request', permission: event };
      applySessionUpdate(session, update);
      onUpdate?.(update);
    },
    onPermissionResolved: (event) => {
      const update: AcpSessionUpdate = { sessionId, type: 'permission_resolved', permission: event };
      applySessionUpdate(session, update);
      onUpdate?.(update);
    },
  });

  try {
    const cancelAgentTurn = () => cancelAgentPromptBestEffort(conn, wireSessionId);
    const result = await callAcpRpc(() => conn.connection.prompt({
      sessionId: wireSessionId,
      prompt: buildAcpPromptBlocks(text, options.images, session.agentCapabilities?.promptCapabilities),
    }), {
      label: 'Prompt',
      timeoutMs,
      signal: options.signal,
      onTimeout: cancelAgentTurn,
      onAbort: cancelAgentTurn,
    });

    onUpdate?.({ sessionId, type: 'done' });
    settlePrompt(session, promptId, 'idle');
    return {
      sessionId,
      text: aggregatedText,
      done: true,
      stopReason: result.stopReason as AcpStopReason,
    };
  } catch (err) {
    settlePrompt(session, promptId, 'error');
    throw err;
  } finally {
    releaseCallbacks();
  }
}

/* ── Public API — Session Control ─────────────────────────────────────── */

export async function cancelPrompt(sessionId: string): Promise<void> {
  const { session, conn } = getSessionAndConn(sessionId);
  if (session.state !== 'active') return;

  const wireSessionId = session.agentSessionId ?? sessionId;
  try {
    await conn.connection.cancel({ sessionId: wireSessionId });
  } catch {
    // Best-effort cancel
  }
  // Hand the session to the next prompt now; the cancelled RPC settles later
  // and must not touch state or callbacks any more.
  clearActivePrompt(session);
  updateSessionState(session, 'idle');
}

export async function setMode(sessionId: string, modeId: string): Promise<void> {
  const { session, conn } = getSessionAndConn(sessionId);
  const wireSessionId = session.agentSessionId ?? sessionId;
  await callAcpRpc(() => conn.connection.setSessionMode({ sessionId: wireSessionId, modeId }), { label: 'session/set_mode', timeoutMs: getSessionTimeouts(sessionId).sessionOpen });
  session.currentModeId = modeId;
  updateSessionState(session, session.state);
}

export async function setConfigOption(
  sessionId: string,
  configId: string,
  value: string,
): Promise<AcpConfigOption[]> {
  const { session, conn } = getSessionAndConn(sessionId);
  const wireSessionId = session.agentSessionId ?? sessionId;

  if (session.configOptions) {
    const option = session.configOptions.find(item => item.configId === configId);
    if (!option || !option.options.some(item => item.id === value)) {
      throw new Error(`The selected ${configId} option is no longer available. Refresh the Agent options and choose again.`);
    }
  }

  const result = await callAcpRpc(() => conn.connection.setSessionConfigOption({
    sessionId: wireSessionId,
    configId,
    value,
  }), { label: 'session/set_config_option', timeoutMs: getSessionTimeouts(sessionId).sessionOpen });

  const configOptions = parseConfigOptions(result.configOptions);
  if (configOptions) {
    session.configOptions = configOptions;
    session.currentModeId = currentModeFromConfig(configOptions) ?? session.currentModeId;
  }
  updateSessionState(session, session.state);
  return session.configOptions ?? [];
}

export async function closeSession(
  sessionId: string,
  options: { closeAgentSession?: boolean } = {},
): Promise<void> {
  const session = sessions.get(sessionId);
  const conn = sessionConnections.get(sessionId);

  if (conn) {
    await closeAgentConnection(conn, session?.agentSessionId ?? sessionId, {
      closeAgentSession: options.closeAgentSession,
      timeoutMs: getSessionTimeouts(sessionId).close,
      capabilities: session?.agentCapabilities,
    });
  }

  unregisterSession(sessionId);
}

/* ── Public API — Queries ─────────────────────────────────────────────── */

export function getSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

/** Read-only: stale sessions are reaped at admission and by the periodic reaper, never here. */
export function getActiveSessions(): AcpSession[] {
  return [...sessions.values()];
}

export function getSessionSnapshot(sessionId: string): AcpSessionSnapshot | undefined {
  const session = sessions.get(sessionId);
  return session ? buildAcpSessionSnapshot(session) : undefined;
}

export function getActiveSessionSnapshots(): AcpSessionSnapshot[] {
  return [...sessions.values()].map(buildAcpSessionSnapshot);
}

export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.allSettled(ids.map(id => closeSession(id)));
}
