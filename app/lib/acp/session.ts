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

  try {
    const newResponse = await sendAndWait(proc, 'session/new', {
      cwd: options?.cwd ?? process.cwd(),
      mcpServers: [],
    }, 15_000);

    if (newResponse.error) {
      // Non-fatal: some agents may not support explicit session/new
      console.warn(`ACP session/new warning for ${entry.id}: ${newResponse.error.message}`);
    } else {
      const newResult = newResponse.result as Record<string, unknown> | undefined;
      if (newResult) {
        modes = parseModes(newResult.modes);
        configOptions = parseConfigOptions(newResult.configOptions);
      }
    }
  } catch {
    // Non-fatal: agent may not support explicit session/new (backwards compat)
  }

  const sessionId = `ses-${entry.id}-${Date.now()}`;
  const session: AcpSession = {
    id: sessionId,
    agentId: entry.id,
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

  // Use the original sessionId since we're resuming
  const session: AcpSession = {
    id: existingSessionId,
    agentId: entry.id,
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
    const response = await sendAndWait(proc, 'session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }] satisfies AcpContentBlock[],
      ...(session.cwd ? { context: { cwd: session.cwd } } : {}),
    }, 60_000);

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
      stopReason: parseStopReason(result?.stopReason),
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
 * Handles all 10 ACP session/update types.
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
    let stopReason: AcpStopReason = 'end_turn';

    const unsub = onMessage(proc, (msg) => {
      if (msg.result && typeof msg.result === 'object') {
        const raw = msg.result as Record<string, unknown>;
        const update = parseSessionUpdate(sessionId, raw);

        onUpdate(update);

        // Aggregate text from message chunk types
        if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
          aggregatedText += update.text;
        }

        // Handle terminal states
        if (update.type === 'done') {
          unsub();
          if (raw.stopReason) {
            stopReason = parseStopReason(raw.stopReason);
          }
          updateSessionState(session, 'idle');
          resolve({
            sessionId,
            text: aggregatedText,
            done: true,
            stopReason,
          });
        }

        if (update.type === 'error') {
          unsub();
          updateSessionState(session, 'error');
          reject(new Error(update.error ?? 'Unknown ACP error'));
        }

        // Update session metadata from config/mode updates
        if (update.type === 'config_option_update' && update.configOptions) {
          session.configOptions = update.configOptions;
        }
        if (update.type === 'current_mode_update' && update.currentModeId) {
          // Track current mode
          session.lastActivityAt = new Date().toISOString();
        }
      }
    });

    // Guard against agent process dying unexpectedly (OOM, SIGKILL, etc.)
    // Without this, the Promise would hang forever if the process exits
    // without sending a done/error notification.
    const onExit = () => {
      unsub();
      updateSessionState(session, 'error');
      reject(new Error(`ACP agent process exited unexpectedly during prompt`));
    };
    proc.proc.once('exit', onExit);

    // Clean up exit listener when Promise resolves/rejects normally
    const cleanup = () => { proc.proc.removeListener('exit', onExit); };
    // Wrap resolve/reject to include cleanup — but we already unsub in the message handler.
    // The exit listener is a safety net; if done/error fires first, remove the exit listener.
    const origResolve = resolve;
    const origReject = reject;
    resolve = ((val: AcpPromptResponse) => { cleanup(); origResolve(val); }) as typeof resolve;
    reject = ((err: unknown) => { cleanup(); origReject(err); }) as typeof reject;

    // Send the prompt with ContentBlock format
    try {
      sendMessage(proc, 'session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }] satisfies AcpContentBlock[],
        stream: true,
        ...(session.cwd ? { context: { cwd: session.cwd } } : {}),
      });
    } catch (err) {
      unsub();
      updateSessionState(session, 'error');
      reject(err);
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

  try {
    await sendAndWait(proc, 'session/cancel', { sessionId }, 10_000);
  } catch {
    // Best-effort cancel — don't throw if the agent doesn't support it
  }

  updateSessionState(session, 'idle');
}

/**
 * Set the operating mode for a session.
 */
export async function setMode(sessionId: string, modeId: string): Promise<void> {
  const { session, proc } = getSessionAndProc(sessionId);

  const response = await sendAndWait(proc, 'session/set_mode', {
    sessionId,
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

  const response = await sendAndWait(proc, 'session/set_config_option', {
    sessionId,
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
  const proc = sessionProcesses.get(sessionId);

  if (proc?.alive) {
    try {
      await sendAndWait(proc, 'session/close', { sessionId }, 5_000);
    } catch {
      // Best-effort close
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
        // Top-level tool call fields
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
      // Terminal state — no extra fields
      break;

    case 'tool_result':
      base.toolResult = raw.toolResult as AcpSessionUpdate['toolResult'];
      break;
  }

  return base;
}
