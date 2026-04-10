/**
 * ACP Session Manager — High-level session lifecycle for ACP agents.
 * Manages session creation, prompt turns, cancellation, and cleanup.
 * Implements full ACP spec: initialize → session/new → session/prompt → session/cancel → close.
 */

import type {
  AcpSession,
  AcpSessionState,
  AcpSessionUpdate,
  AcpPromptResponse,
  AcpRegistryEntry,
  AcpAgentCapabilities,
  AcpMode,
  AcpConfigOption,
  AcpSessionInfo,
  AcpStopReason,
  AcpAuthMethod,
  AcpContentBlock,
} from './types';
import {
  spawnAcpAgent,
  sendAndWait,
  sendMessage,
  onMessage,
  onNotification,
  killAgent,
  installAutoApproval,
  type AcpProcess,
} from './subprocess';
import { findAcpAgent } from './registry';

/* ── State ─────────────────────────────────────────────────────────────── */

const sessions = new Map<string, AcpSession>();
const sessionProcesses = new Map<string, AcpProcess>();
const autoApprovalCleanups = new Map<string, () => void>();

/* ── Public API — Session Lifecycle ───────────────────────────────────── */

/**
 * Create a new ACP session by spawning an agent process.
 * Full ACP lifecycle: spawn → initialize → authenticate (if needed) → session/new.
 */
export async function createSession(
  agentId: string,
  options?: { env?: Record<string, string>; cwd?: string },
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
  options?: { env?: Record<string, string>; cwd?: string },
): Promise<AcpSession> {
  const proc = spawnAcpAgent(entry, options);

  // Install auto-approval BEFORE initialize so any early permission requests
  // from the agent don't cause a hang waiting for TTY input.
  const unsubApproval = installAutoApproval(proc);

  let agentCapabilities: AcpAgentCapabilities | undefined;
  let authMethods: AcpAuthMethod[] | undefined;

  // Phase 1: Initialize — negotiate protocol and capabilities
  try {
    const response = await sendAndWait(proc, 'initialize', {
      protocolVersion: 1,
      capabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'mindos', version: '0.6.29' },
    }, 30_000);

    if (response.error) {
      unsubApproval();
      killAgent(proc);
      throw new Error(`initialize failed: ${response.error.message}`);
    }

    // Parse agent capabilities from response
    const initResult = response.result as Record<string, unknown> | undefined;
    if (initResult) {
      agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
      authMethods = parseAuthMethods(initResult.authMethods);
    }
  } catch (err) {
    unsubApproval();
    killAgent(proc);
    throw err;
  }

  // Phase 2: Authenticate (if agent declares auth methods)
  if (authMethods && authMethods.length > 0) {
    try {
      const authResponse = await sendAndWait(proc, 'authenticate', {
        methodId: authMethods[0].id,
      }, 15_000);

      if (authResponse.error) {
        // Authentication failed — non-fatal, log and continue
        console.warn(`ACP authenticate warning for ${entry.id}: ${authResponse.error.message}`);
      }
    } catch {
      // Best-effort auth — agent may not require it
    }
  }

  // Phase 3: session/new — create the conversation session
  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;
  let agentSessionId: string | undefined;

  try {
    const newResponse = await sendAndWait(proc, 'session/new', {
      cwd: options?.cwd ?? process.cwd(),
      mcpServers: [],
    }, 15_000);

    if (newResponse.error) {
      const errMsg = newResponse.error.message ?? 'session/new failed';
      if (/auth/i.test(errMsg)) {
        unsubApproval();
        killAgent(proc);
        throw new Error(`${entry.id}: ${errMsg}`);
      }
      console.warn(`ACP session/new warning for ${entry.id}: ${errMsg}`);
    } else {
      const newResult = newResponse.result as Record<string, unknown> | undefined;
      if (newResult) {
        // The agent assigns its own sessionId — we MUST use it for all future RPC calls
        if (typeof newResult.sessionId === 'string') {
          agentSessionId = newResult.sessionId;
        }
        modes = parseModes(newResult.modes);
        configOptions = parseConfigOptions(newResult.configOptions);
      }
    }
  } catch (sessionErr) {
    if (sessionErr instanceof Error && /auth/i.test(sessionErr.message)) throw sessionErr;
  }

  // Reap stale sessions lazily on each new session creation
  reapStaleSessions();

  const sessionId = `ses-${entry.id}-${Date.now()}`;
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
    authMethods,
  };

  sessions.set(sessionId, session);
  sessionProcesses.set(sessionId, proc);
  autoApprovalCleanups.set(sessionId, unsubApproval);
  return session;
}

/**
 * Load/resume an existing session on an agent.
 * Requires agent to declare `loadSession` capability.
 */
export async function loadSession(
  agentId: string,
  existingSessionId: string,
  options?: { env?: Record<string, string>; cwd?: string },
): Promise<AcpSession> {
  const entry = await findAcpAgent(agentId);
  if (!entry) {
    throw new Error(`ACP agent not found in registry: ${agentId}`);
  }

  const proc = spawnAcpAgent(entry, options);
  const unsubApproval = installAutoApproval(proc);

  let agentCapabilities: AcpAgentCapabilities | undefined;

  // Initialize
  try {
    const initResponse = await sendAndWait(proc, 'initialize', {
      protocolVersion: 1,
      capabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'mindos', version: '0.6.29' },
    }, 30_000);

    if (initResponse.error) {
      unsubApproval();
      killAgent(proc);
      throw new Error(`initialize failed: ${initResponse.error.message}`);
    }

    const initResult = initResponse.result as Record<string, unknown> | undefined;
    if (initResult) {
      agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
    }
  } catch (err) {
    unsubApproval();
    killAgent(proc);
    throw err;
  }

  // Check if agent supports loadSession
  if (!agentCapabilities?.loadSession) {
    unsubApproval();
    killAgent(proc);
    throw new Error(`Agent ${agentId} does not support session/load (loadSession capability not declared)`);
  }

  // session/load — resume the existing session
  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;

  try {
    const loadResponse = await sendAndWait(proc, 'session/load', {
      sessionId: existingSessionId,
      cwd: options?.cwd ?? process.cwd(),
      mcpServers: [],
    }, 15_000);

    if (loadResponse.error) {
      unsubApproval();
      killAgent(proc);
      throw new Error(`session/load failed: ${loadResponse.error.message}`);
    }

    const loadResult = loadResponse.result as Record<string, unknown> | undefined;
    if (loadResult) {
      modes = parseModes(loadResult.modes);
      configOptions = parseConfigOptions(loadResult.configOptions);
    }
  } catch (err) {
    unsubApproval();
    killAgent(proc);
    throw err;
  }

  const session: AcpSession = {
    id: existingSessionId,
    agentId: entry.id,
    agentSessionId: existingSessionId,
    state: 'idle',
    cwd: options?.cwd,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    agentCapabilities,
    modes,
    configOptions,
  };

  sessions.set(existingSessionId, session);
  sessionProcesses.set(existingSessionId, proc);
  autoApprovalCleanups.set(existingSessionId, unsubApproval);
  return session;
}

/**
 * List resumable sessions from the agent.
 * Requires agent to declare `sessionCapabilities.list`.
 */
export async function listSessions(
  sessionId: string,
  options?: { cursor?: string; cwd?: string },
): Promise<{ sessions: AcpSessionInfo[]; nextCursor?: string }> {
  const { session, proc } = getSessionAndProc(sessionId);

  if (!session.agentCapabilities?.sessionCapabilities?.list) {
    throw new Error('Agent does not support session/list');
  }

  const response = await sendAndWait(proc, 'session/list', {
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  }, 10_000);

  if (response.error) {
    throw new Error(`session/list failed: ${response.error.message}`);
  }

  const result = response.result as Record<string, unknown> | undefined;
  const rawSessions = Array.isArray(result?.sessions) ? result.sessions : [];

  return {
    sessions: rawSessions.map((s: unknown) => {
      const obj = s as Record<string, unknown>;
      return {
        sessionId: String(obj.sessionId ?? ''),
        title: typeof obj.title === 'string' ? obj.title : undefined,
        cwd: typeof obj.cwd === 'string' ? obj.cwd : undefined,
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
      };
    }),
    nextCursor: typeof result?.nextCursor === 'string' ? result.nextCursor : undefined,
  };
}

/* ── Public API — Prompt ──────────────────────────────────────────────── */

/**
 * Send a prompt to an active session and collect the full response.
 * Aggregates text from session/update notifications (primary content delivery mechanism
 * for agents like Gemini CLI that send text via streaming notifications, not in the
 * final JSON-RPC response).
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
  const wireSessionId = session.agentSessionId ?? sessionId;

  // Collect text from streaming notifications while sendAndWait waits for the final response
  let notificationText = '';
  const unsubNotify = onNotification(proc, (notif) => {
    if (notif.method !== 'session/update' || !notif.params) return;
    const update = parseNotificationToUpdate(sessionId, notif.params);
    if (!update) return;
    if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
      notificationText += update.text;
    }
  });

  try {
    const response = await sendAndWait(proc, 'session/prompt', {
      sessionId: wireSessionId,
      prompt: [{ type: 'text', text }] satisfies AcpContentBlock[],
      ...(session.cwd ? { context: { cwd: session.cwd } } : {}),
    }, 120_000);

    unsubNotify();

    if (response.error) {
      updateSessionState(session, 'error');
      throw new Error(`session/prompt error: ${response.error.message}`);
    }

    updateSessionState(session, 'idle');
    const result = response.result as Record<string, unknown>;
    const responseText = typeof result?.text === 'string' ? result.text : '';
    return {
      sessionId,
      text: notificationText || responseText,
      done: true,
      stopReason: parseStopReason(result?.stopReason),
      toolCalls: result?.toolCalls as AcpPromptResponse['toolCalls'],
      metadata: result?.metadata as AcpPromptResponse['metadata'],
    };
  } catch (err) {
    unsubNotify();
    updateSessionState(session, 'error');
    throw err;
  }
}

/**
 * Send a prompt and receive streaming updates via callback.
 * Handles both:
 *   1. JSON-RPC notifications (session/update) — the standard ACP streaming mechanism
 *   2. JSON-RPC responses with update data — backward compat for older agents
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
  const wireSessionId = session.agentSessionId ?? sessionId;

  return new Promise((resolve, reject) => {
    let aggregatedText = '';
    let stopReason: AcpStopReason = 'end_turn';
    let settled = false;
    let promptRpcId: string;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    // ── 1. Notifications: primary streaming channel ──
    const unsubNotify = onNotification(proc, (notif) => {
      if (settled) return;
      if (notif.method !== 'session/update' || !notif.params) return;

      const update = parseNotificationToUpdate(sessionId, notif.params);
      if (!update) return;

      onUpdate(update);

      if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
        aggregatedText += update.text;
      }
      if (update.type === 'config_option_update' && update.configOptions) {
        session.configOptions = update.configOptions;
      }
      if (update.type === 'error') {
        settle(() => {
          updateSessionState(session, 'error');
          reject(new Error(update.error ?? 'Unknown ACP error'));
        });
      }
      if (update.type === 'done') {
        settle(() => {
          updateSessionState(session, 'idle');
          resolve({ sessionId, text: aggregatedText, done: true, stopReason });
        });
      }
    });

    // ── 2. Responses: completion signal + legacy streaming fallback ──
    const unsubMsg = onMessage(proc, (msg) => {
      if (settled) return;

      // Final response — matches the RPC ID of our prompt request
      if (String(msg.id) === promptRpcId) {
        if (msg.error) {
          settle(() => {
            updateSessionState(session, 'error');
            reject(new Error(`session/prompt error: ${msg.error!.message}`));
          });
          return;
        }
        const result = msg.result as Record<string, unknown> | undefined;
        if (result?.stopReason) stopReason = parseStopReason(result.stopReason);
        const responseText = typeof result?.text === 'string' ? result.text : '';
        if (responseText && !aggregatedText) aggregatedText = responseText;

        onUpdate({ sessionId, type: 'done' });
        settle(() => {
          updateSessionState(session, 'idle');
          resolve({ sessionId, text: aggregatedText, done: true, stopReason });
        });
        return;
      }

      // Legacy: responses with update-like result (for agents that stream via responses)
      if (msg.result && typeof msg.result === 'object') {
        const raw = msg.result as Record<string, unknown>;
        const update = parseSessionUpdate(sessionId, raw);
        onUpdate(update);
        if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
          aggregatedText += update.text;
        }
        if (update.type === 'done') {
          if (raw.stopReason) stopReason = parseStopReason(raw.stopReason);
          settle(() => {
            updateSessionState(session, 'idle');
            resolve({ sessionId, text: aggregatedText, done: true, stopReason });
          });
        }
        if (update.type === 'error') {
          settle(() => {
            updateSessionState(session, 'error');
            reject(new Error(update.error ?? 'Unknown ACP error'));
          });
        }
      }
    });

    // ── 3. Process exit guard ──
    const onExit = () => {
      settle(() => {
        updateSessionState(session, 'error');
        reject(new Error('ACP agent process exited unexpectedly during prompt'));
      });
    };
    proc.proc.once('exit', onExit);

    const cleanup = () => {
      unsubNotify();
      unsubMsg();
      proc.proc.removeListener('exit', onExit);
    };

    // ── 4. Send the prompt ──
    try {
      promptRpcId = sendMessage(proc, 'session/prompt', {
        sessionId: wireSessionId,
        prompt: [{ type: 'text', text }] satisfies AcpContentBlock[],
        stream: true,
        ...(session.cwd ? { context: { cwd: session.cwd } } : {}),
      });
    } catch (err) {
      settle(() => {
        updateSessionState(session, 'error');
        reject(err);
      });
    }
  });
}

/* ── Public API — Session Control ─────────────────────────────────────── */

/**
 * Cancel the current prompt turn on a session.
 */
export async function cancelPrompt(sessionId: string): Promise<void> {
  const { session, proc } = getSessionAndProc(sessionId);

  if (session.state !== 'active') return;

  const wireSessionId = session.agentSessionId ?? sessionId;
  try {
    await sendAndWait(proc, 'session/cancel', { sessionId: wireSessionId }, 10_000);
  } catch {
    // Best-effort cancel
  }

  updateSessionState(session, 'idle');
}

/**
 * Set the operating mode for a session.
 */
export async function setMode(sessionId: string, modeId: string): Promise<void> {
  const { session, proc } = getSessionAndProc(sessionId);

  const wireSessionId = session.agentSessionId ?? sessionId;
  const response = await sendAndWait(proc, 'session/set_mode', {
    sessionId: wireSessionId,
    modeId,
  }, 10_000);

  if (response.error) {
    throw new Error(`session/set_mode failed: ${response.error.message}`);
  }

  session.lastActivityAt = new Date().toISOString();
}

/**
 * Set a configuration option for a session.
 */
export async function setConfigOption(
  sessionId: string,
  configId: string,
  value: string,
): Promise<AcpConfigOption[]> {
  const { session, proc } = getSessionAndProc(sessionId);

  const wireSessionId = session.agentSessionId ?? sessionId;
  const response = await sendAndWait(proc, 'session/set_config_option', {
    sessionId: wireSessionId,
    configId,
    value,
  }, 10_000);

  if (response.error) {
    throw new Error(`session/set_config_option failed: ${response.error.message}`);
  }

  const result = response.result as Record<string, unknown> | undefined;
  const configOptions = parseConfigOptions(result?.configOptions);
  if (configOptions) {
    session.configOptions = configOptions;
  }

  session.lastActivityAt = new Date().toISOString();
  return session.configOptions ?? [];
}

/**
 * Close a session and terminate the subprocess.
 */
export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  const proc = sessionProcesses.get(sessionId);

  if (proc?.alive) {
    const wireSessionId = session?.agentSessionId ?? sessionId;
    try {
      await sendAndWait(proc, 'session/close', { sessionId: wireSessionId }, 5_000);
    } catch {
      // Best-effort close — many agents (e.g. Gemini) don't support this method
    }
    killAgent(proc);
  }

  sessions.delete(sessionId);
  sessionProcesses.delete(sessionId);
  const cleanup = autoApprovalCleanups.get(sessionId);
  if (cleanup) {
    cleanup();
    autoApprovalCleanups.delete(sessionId);
  }
}

/* ── Public API — Queries ─────────────────────────────────────────────── */

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

/* ── Internal — Session helpers ───────────────────────────────────────── */

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

/* ── Internal — Parsers ───────────────────────────────────────────────── */

function parseStopReason(raw: unknown): AcpStopReason {
  const valid: AcpStopReason[] = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'];
  return valid.includes(raw as AcpStopReason) ? (raw as AcpStopReason) : 'end_turn';
}

function parseAgentCapabilities(raw: unknown): AcpAgentCapabilities | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    loadSession: obj.loadSession === true,
    mcpCapabilities: typeof obj.mcpCapabilities === 'object' ? obj.mcpCapabilities as AcpAgentCapabilities['mcpCapabilities'] : undefined,
    promptCapabilities: typeof obj.promptCapabilities === 'object' ? obj.promptCapabilities as AcpAgentCapabilities['promptCapabilities'] : undefined,
    sessionCapabilities: typeof obj.sessionCapabilities === 'object' ? obj.sessionCapabilities as AcpAgentCapabilities['sessionCapabilities'] : undefined,
  };
}

function parseAuthMethods(raw: unknown): AcpAuthMethod[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? ''),
      description: typeof m.description === 'string' ? m.description : undefined,
    }))
    .filter(m => m.id && m.name);
}

function parseModes(raw: unknown): AcpMode[] | undefined {
  // Handle nested format: { availableModes: [...], currentModeId: "..." }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.availableModes)) {
      return parseModes(obj.availableModes);
    }
  }
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map(m => ({
      id: String(m.id ?? ''),
      name: String(m.name ?? ''),
      description: typeof m.description === 'string' ? m.description : undefined,
    }))
    .filter(m => m.id && m.name);
}

function parseConfigOptions(raw: unknown): AcpConfigOption[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map(o => ({
      type: 'select' as const,
      configId: String(o.configId ?? o.id ?? ''),
      category: String(o.category ?? 'other'),
      label: typeof o.label === 'string' ? o.label : undefined,
      currentValue: String(o.currentValue ?? ''),
      options: Array.isArray(o.options) ? o.options.map((opt: unknown) => {
        const optObj = opt as Record<string, unknown>;
        return { id: String(optObj.id ?? ''), label: String(optObj.label ?? '') };
      }) : [],
    }))
    .filter(o => o.configId);
}

/** Parse a raw session/update notification into a typed AcpSessionUpdate. */
function parseSessionUpdate(sessionId: string, raw: Record<string, unknown>): AcpSessionUpdate {
  const type = raw.type as AcpSessionUpdate['type'] ?? 'text';

  const base: AcpSessionUpdate = { sessionId, type };

  switch (type) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk':
    case 'text':
      base.text = typeof raw.text === 'string' ? raw.text
        : typeof raw.content === 'string' ? raw.content
        : undefined;
      break;

    case 'tool_call':
    case 'tool_call_update':
      if (raw.toolCall && typeof raw.toolCall === 'object') {
        base.toolCall = raw.toolCall as AcpSessionUpdate['toolCall'];
      } else {
        base.toolCall = {
          toolCallId: String(raw.toolCallId ?? ''),
          title: typeof raw.title === 'string' ? raw.title : undefined,
          kind: raw.kind as AcpSessionUpdate['toolCall'] extends { kind: infer K } ? K : undefined,
          status: (raw.status as 'pending' | 'in_progress' | 'completed' | 'failed') ?? 'pending',
          rawInput: typeof raw.rawInput === 'string' ? raw.rawInput : undefined,
          rawOutput: typeof raw.rawOutput === 'string' ? raw.rawOutput : undefined,
        };
      }
      break;

    case 'plan':
      if (raw.entries && Array.isArray(raw.entries)) {
        base.plan = { entries: raw.entries as AcpSessionUpdate['plan'] extends { entries: infer E } ? E : never };
      } else if (raw.plan && typeof raw.plan === 'object') {
        base.plan = raw.plan as AcpSessionUpdate['plan'];
      }
      break;

    case 'available_commands_update':
      base.availableCommands = Array.isArray(raw.availableCommands) ? raw.availableCommands : undefined;
      break;

    case 'current_mode_update':
      base.currentModeId = typeof raw.currentModeId === 'string' ? raw.currentModeId : undefined;
      break;

    case 'config_option_update':
      base.configOptions = parseConfigOptions(raw.configOptions);
      break;

    case 'session_info_update':
      base.sessionInfo = {
        title: typeof raw.title === 'string' ? raw.title : undefined,
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
      };
      break;

    case 'error':
      base.error = typeof raw.error === 'string' ? raw.error : String(raw.message ?? 'Unknown error');
      break;

    case 'done':
      break;

    case 'tool_result':
      base.toolResult = raw.toolResult as AcpSessionUpdate['toolResult'];
      break;
  }

  return base;
}

/**
 * Parse a JSON-RPC notification's `params` into a typed AcpSessionUpdate.
 * Gemini CLI notification format:
 *   { sessionId: "...", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "..." } } }
 */
function parseNotificationToUpdate(
  sessionId: string,
  params: Record<string, unknown>,
): AcpSessionUpdate | null {
  const updateObj = params.update as Record<string, unknown> | undefined;
  if (!updateObj) return null;

  const updateType = (updateObj.sessionUpdate ?? updateObj.type) as AcpSessionUpdate['type'] | undefined;
  if (!updateType) return null;

  const base: AcpSessionUpdate = { sessionId, type: updateType };

  // Extract text from content block
  const content = updateObj.content as Record<string, unknown> | undefined;
  if (content) {
    if (content.type === 'text' && typeof content.text === 'string') {
      base.text = content.text;
    } else if (content.type === 'thinking' && typeof content.text === 'string') {
      base.text = content.text;
    }
  }

  // Direct text fields (some agents use flat format)
  if (!base.text) {
    if (typeof updateObj.text === 'string') base.text = updateObj.text;
    else if (typeof updateObj.content === 'string') base.text = updateObj.content;
  }

  switch (updateType) {
    case 'tool_call':
    case 'tool_call_update':
      if (updateObj.toolCall && typeof updateObj.toolCall === 'object') {
        base.toolCall = updateObj.toolCall as AcpSessionUpdate['toolCall'];
      } else {
        base.toolCall = {
          toolCallId: String(updateObj.toolCallId ?? ''),
          title: typeof updateObj.title === 'string' ? updateObj.title : undefined,
          status: (updateObj.status as 'pending' | 'in_progress' | 'completed' | 'failed') ?? 'pending',
        };
      }
      break;

    case 'plan':
      if (updateObj.plan && typeof updateObj.plan === 'object') {
        base.plan = updateObj.plan as AcpSessionUpdate['plan'];
      } else if (Array.isArray(updateObj.entries)) {
        base.plan = { entries: updateObj.entries as AcpSessionUpdate['plan'] extends { entries: infer E } ? E : never };
      }
      break;

    case 'error':
      base.error = typeof updateObj.error === 'string'
        ? updateObj.error
        : typeof updateObj.message === 'string'
          ? updateObj.message
          : 'Unknown error';
      break;

    case 'config_option_update':
      base.configOptions = parseConfigOptions(updateObj.configOptions);
      break;

    case 'current_mode_update':
      base.currentModeId = typeof updateObj.currentModeId === 'string' ? updateObj.currentModeId : undefined;
      break;

    case 'session_info_update':
      base.sessionInfo = {
        title: typeof updateObj.title === 'string' ? updateObj.title : undefined,
        updatedAt: typeof updateObj.updatedAt === 'string' ? updateObj.updatedAt : undefined,
      };
      break;
  }

  return base;
}

/* ── Internal — Session reaping ───────────────────────────────────────── */

const STALE_SESSION_MS = 30 * 60 * 1000; // 30 minutes

function reapStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    const lastActivity = new Date(session.lastActivityAt).getTime();
    if (now - lastActivity > STALE_SESSION_MS && session.state !== 'active') {
      closeSession(id).catch(() => {});
    }
  }
}
