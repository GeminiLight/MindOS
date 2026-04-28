/**
 * ACP Session Manager — High-level session lifecycle for ACP agents.
 * Uses @agentclientprotocol/sdk for all protocol handling.
 * Implements: initialize → session/new → session/prompt → session/cancel → close.
 */

import type {
  ClientSideConnection,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
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
} from './types.js';
import {
  spawnAndConnect,
  killAgent,
  type AcpConnection,
  type AcpLaunchOptions,
  type AcpProcess,
} from './subprocess.js';
import { findAcpAgent } from './registry.js';

export interface AcpSessionOptions extends AcpLaunchOptions {
  clientVersion?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* ── Error diagnosis ───────────────────────────────────────────────────── */

function diagnoseInitFailure(proc: AcpProcess, rawError: Error): string {
  const raw = rawError.message ?? '';
  const stderr = proc.spawnError ?? '';

  // ENOENT = spawn itself failed because the executable was not found
  if (raw.includes('ENOENT') || stderr.includes('ENOENT')) {
    return `Command not found: "${proc.agentId}". Verify it is installed and on your PATH, or set an absolute path in Agent settings.`;
  }

  // npx download failures (common when npm registry is unreachable, e.g. in China)
  if (stderr.includes('npm ERR!') || stderr.includes('ERR_SOCKET_TIMEOUT') || stderr.includes('ETIMEDOUT') || stderr.includes('ECONNREFUSED') || stderr.includes('Could not resolve host') || stderr.includes('FETCH_ERROR')) {
    return `Agent "${proc.agentId}" failed to download its ACP wrapper package. This usually means the npm registry is unreachable. Check your network connection and npm proxy settings. Stderr: ${stderr.slice(0, 300)}`;
  }

  // EPIPE = child process exited before we could write to stdin
  if (raw.includes('EPIPE')) {
    if (stderr) {
      return `Agent "${proc.agentId}" exited immediately: ${stderr}`;
    }
    return `Agent "${proc.agentId}" exited before initialization. Common causes: command not found in this environment (desktop apps often have a shorter PATH than your terminal), the agent does not support ACP mode, or authentication is required. Try running the agent command manually in a terminal to diagnose.`;
  }

  // Non-zero exit with stderr
  if (stderr) {
    return `Agent "${proc.agentId}" failed to start: ${stderr}`;
  }

  return `initialize failed: ${raw}`;
}


function getMindosVersion(options?: AcpSessionOptions): string {
  return options?.clientVersion ?? process.env.npm_package_version ?? '1.0.0';
}

/* ── State ─────────────────────────────────────────────────────────────── */

const sessions = new Map<string, AcpSession>();
const sessionConnections = new Map<string, AcpConnection>();

const MAX_SESSIONS_PER_AGENT = 3;
const MAX_TOTAL_SESSIONS = 10;

/* ── Public API — Session Lifecycle ───────────────────────────────────── */

/**
 * Create a new ACP session by spawning an agent process.
 */
export async function createSession(
  agentId: string,
  options?: AcpSessionOptions,
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
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  checkSessionLimits(entry.id);

  const sessionCwd = options?.cwd ?? process.cwd();
  const conn = spawnAndConnect(entry, options);

  let agentCapabilities: AcpAgentCapabilities | undefined;
  let authMethods: AcpAuthMethod[] | undefined;

  // Phase 1: Initialize
  try {
    const initResult = await conn.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'mindos', version: getMindosVersion(options) },
    });

    agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
    authMethods = parseAuthMethods(initResult.authMethods);
  } catch (err) {
    // Wait briefly for stderr/exit info before diagnosing
    await new Promise(r => setTimeout(r, 200));
    const message = diagnoseInitFailure(conn.process, err as Error);
    killAgent(conn.process);
    throw new Error(message);
  }

  // Phase 2: Authenticate (if agent declares auth methods)
  const firstAuthMethod = authMethods?.[0];
  if (firstAuthMethod) {
    try {
      await conn.connection.authenticate({ methodId: firstAuthMethod.id });
    } catch {
      // Best-effort auth
    }
  }

  // Phase 3: session/new
  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;
  let agentSessionId: string | undefined;

  try {
    const newResult = await conn.connection.newSession({
      cwd: sessionCwd,
      mcpServers: [],
    });

    if (typeof newResult.sessionId === 'string') {
      agentSessionId = newResult.sessionId;
    }
    modes = parseModes(newResult.modes);
    configOptions = parseConfigOptions(newResult.configOptions);
  } catch (sessionErr) {
    const msg = (sessionErr as Error).message ?? '';
    if (/auth/i.test(msg)) {
      killAgent(conn.process);
      throw new Error(`${entry.id}: ${msg}`);
    }
    // Non-auth errors: log and continue (session may still be usable)
    console.warn(`ACP session/new warning for ${entry.id}: ${msg}`);
  }

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
  sessionConnections.set(sessionId, conn);
  return session;
}

/**
 * Load/resume an existing session on an agent.
 */
export async function loadSession(
  agentId: string,
  existingSessionId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  const entry = await findAcpAgent(agentId);
  if (!entry) {
    throw new Error(`ACP agent not found in registry: ${agentId}`);
  }

  const loadCwd = options?.cwd ?? process.cwd();
  const conn = spawnAndConnect(entry, options);

  let agentCapabilities: AcpAgentCapabilities | undefined;

  try {
    const initResult = await conn.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
      clientInfo: { name: 'mindos', version: getMindosVersion(options) },
    });
    agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
  } catch (err) {
    await new Promise(r => setTimeout(r, 200));
    const message = diagnoseInitFailure(conn.process, err as Error);
    killAgent(conn.process);
    throw new Error(message);
  }

  if (!agentCapabilities?.loadSession) {
    killAgent(conn.process);
    throw new Error(`Agent ${agentId} does not support session/load`);
  }

  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;

  try {
    const loadResult = await conn.connection.loadSession({
      sessionId: existingSessionId,
      cwd: loadCwd,
      mcpServers: [],
    });
    modes = parseModes(loadResult.modes);
    configOptions = parseConfigOptions(loadResult.configOptions);
  } catch (err) {
    killAgent(conn.process);
    throw new Error(`session/load failed: ${(err as Error).message}`);
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
  sessionConnections.set(existingSessionId, conn);
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

  if (!session.agentCapabilities?.sessionCapabilities?.list) {
    throw new Error('Agent does not support session/list');
  }

  const result = await conn.connection.listSessions({
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(options?.cwd ? { cwd: options.cwd } : {}),
  });

  return {
    sessions: (result.sessions ?? []).map(s => ({
      sessionId: s.sessionId ?? '',
      title: s.title ?? undefined,
      cwd: s.cwd ?? undefined,
      updatedAt: s.updatedAt ?? undefined,
    })),
    nextCursor: result.nextCursor ?? undefined,
  };
}

/* ── Public API — Prompt ──────────────────────────────────────────────── */

const PROMPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Send a prompt and collect the full response.
 * Text arrives via session/update notifications (handled by SDK → Client.sessionUpdate).
 */
export async function prompt(
  sessionId: string,
  text: string,
): Promise<AcpPromptResponse> {
  const { session, conn } = getSessionAndConn(sessionId);

  if (session.state === 'active') {
    throw new Error(`Session ${sessionId} is busy processing another prompt`);
  }

  updateSessionState(session, 'active');
  const wireSessionId = session.agentSessionId ?? sessionId;

  let notificationText = '';
  conn.callbacks.onSessionUpdate = (params) => {
    const update = sdkNotificationToUpdate(sessionId, params);
    if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
      notificationText += update.text;
    }
  };

  try {
    const result = await withTimeout(
      conn.connection.prompt({
        sessionId: wireSessionId,
        prompt: [{ type: 'text', text }] satisfies AcpContentBlock[],
      }),
      PROMPT_TIMEOUT_MS,
      `Prompt timed out after ${PROMPT_TIMEOUT_MS / 1000}s`,
    );

    updateSessionState(session, 'idle');
    return {
      sessionId,
      text: notificationText || '',
      done: true,
      stopReason: result.stopReason as AcpStopReason,
    };
  } catch (err) {
    updateSessionState(session, 'error');
    throw err;
  } finally {
    conn.callbacks.onSessionUpdate = undefined;
  }
}

/**
 * Send a prompt and receive streaming updates via callback.
 */
export async function promptStream(
  sessionId: string,
  text: string,
  onUpdate: (update: AcpSessionUpdate) => void,
): Promise<AcpPromptResponse> {
  const { session, conn } = getSessionAndConn(sessionId);

  if (session.state === 'active') {
    throw new Error(`Session ${sessionId} is busy processing another prompt`);
  }

  updateSessionState(session, 'active');
  const wireSessionId = session.agentSessionId ?? sessionId;

  let aggregatedText = '';
  conn.callbacks.onSessionUpdate = (params) => {
    const update = sdkNotificationToUpdate(sessionId, params);
    onUpdate(update);

    if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
      aggregatedText += update.text;
    }
    if (update.type === 'config_option_update' && update.configOptions) {
      session.configOptions = update.configOptions;
    }
  };

  try {
    const result = await withTimeout(
      conn.connection.prompt({
        sessionId: wireSessionId,
        prompt: [{ type: 'text', text }] satisfies AcpContentBlock[],
      }),
      PROMPT_TIMEOUT_MS,
      `Prompt timed out after ${PROMPT_TIMEOUT_MS / 1000}s`,
    );

    onUpdate({ sessionId, type: 'done' });
    updateSessionState(session, 'idle');
    return {
      sessionId,
      text: aggregatedText,
      done: true,
      stopReason: result.stopReason as AcpStopReason,
    };
  } catch (err) {
    updateSessionState(session, 'error');
    throw err;
  } finally {
    conn.callbacks.onSessionUpdate = undefined;
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
  updateSessionState(session, 'idle');
}

export async function setMode(sessionId: string, modeId: string): Promise<void> {
  const { session, conn } = getSessionAndConn(sessionId);
  const wireSessionId = session.agentSessionId ?? sessionId;
  await conn.connection.setSessionMode({ sessionId: wireSessionId, modeId });
  session.lastActivityAt = new Date().toISOString();
}

export async function setConfigOption(
  sessionId: string,
  configId: string,
  value: string,
): Promise<AcpConfigOption[]> {
  const { session, conn } = getSessionAndConn(sessionId);
  const wireSessionId = session.agentSessionId ?? sessionId;

  const result = await conn.connection.setSessionConfigOption({
    sessionId: wireSessionId,
    configId,
    value,
  });

  const configOptions = parseConfigOptions(result.configOptions);
  if (configOptions) session.configOptions = configOptions;
  session.lastActivityAt = new Date().toISOString();
  return session.configOptions ?? [];
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  const conn = sessionConnections.get(sessionId);

  if (conn?.process.alive) {
    const wireSessionId = session?.agentSessionId ?? sessionId;
    try {
      await conn.connection.unstable_closeSession({ sessionId: wireSessionId });
    } catch {
      // Best-effort — many agents don't support session/close
    }
    killAgent(conn.process);
  }

  sessions.delete(sessionId);
  sessionConnections.delete(sessionId);
}

/* ── Public API — Queries ─────────────────────────────────────────────── */

export function getSession(sessionId: string): AcpSession | undefined {
  return sessions.get(sessionId);
}

export function getActiveSessions(): AcpSession[] {
  reapStaleSessions();
  return [...sessions.values()];
}

export async function closeAllSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.allSettled(ids.map(id => closeSession(id)));
}

/* ── Internal — Session helpers ───────────────────────────────────────── */

function getSessionAndConn(sessionId: string): { session: AcpSession; conn: AcpConnection } {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const conn = sessionConnections.get(sessionId);
  if (!conn?.process.alive) {
    updateSessionState(session, 'error');
    throw new Error(`Session process is dead: ${sessionId}`);
  }

  return { session, conn };
}

function updateSessionState(session: AcpSession, state: AcpSessionState): void {
  session.state = state;
  session.lastActivityAt = new Date().toISOString();
}

/* ── Internal — SDK notification → MindOS update ──────────────────────── */

/**
 * Convert SDK SessionNotification to MindOS AcpSessionUpdate.
 * The SDK validates and parses the JSON-RPC notification;
 * we just reshape the typed data for our UI layer.
 */
function sdkNotificationToUpdate(
  sessionId: string,
  params: SessionNotification,
): AcpSessionUpdate {
  const update = params.update as SessionUpdate & Record<string, unknown>;
  const type = update.sessionUpdate as AcpSessionUpdate['type'];
  const base: AcpSessionUpdate = { sessionId, type };

  switch (type) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk': {
      const content = (update as Record<string, unknown>).content as Record<string, unknown> | undefined;
      if (content?.type === 'text' && typeof content.text === 'string') {
        base.text = content.text;
      } else if (content?.type === 'thinking' && typeof content.text === 'string') {
        base.text = content.text;
      }
      break;
    }

    case 'tool_call':
    case 'tool_call_update': {
      const tc = update as Record<string, unknown>;
      base.toolCall = {
        toolCallId: String(tc.toolCallId ?? ''),
        title: typeof tc.title === 'string' ? tc.title : undefined,
        status: (tc.status as 'pending' | 'in_progress' | 'completed' | 'failed') ?? 'pending',
        kind: tc.kind as AcpSessionUpdate['toolCall'] extends { kind: infer K } ? K : undefined,
        rawInput: typeof tc.rawInput === 'string' ? tc.rawInput : undefined,
        rawOutput: typeof tc.rawOutput === 'string' ? tc.rawOutput : undefined,
      };
      break;
    }

    case 'plan': {
      const planData = update as Record<string, unknown>;
      if (Array.isArray(planData.entries)) {
        base.plan = { entries: planData.entries as AcpSessionUpdate['plan'] extends { entries: infer E } ? E : never };
      }
      break;
    }

    case 'available_commands_update':
      base.availableCommands = Array.isArray((update as Record<string, unknown>).availableCommands)
        ? (update as Record<string, unknown>).availableCommands as unknown[]
        : undefined;
      break;

    case 'current_mode_update':
      base.currentModeId = typeof (update as Record<string, unknown>).currentModeId === 'string'
        ? (update as Record<string, unknown>).currentModeId as string
        : undefined;
      break;

    case 'config_option_update':
      base.configOptions = parseConfigOptions((update as Record<string, unknown>).configOptions);
      break;

    case 'session_info_update': {
      const info = update as Record<string, unknown>;
      base.sessionInfo = {
        title: typeof info.title === 'string' ? info.title : undefined,
        updatedAt: typeof info.updatedAt === 'string' ? info.updatedAt : undefined,
      };
      break;
    }
  }

  return base;
}

/* ── Internal — Parsers ───────────────────────────────────────────────── */

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

/* ── Internal — Session limits ─────────────────────────────────────────── */

function checkSessionLimits(agentId: string): void {
  if (sessions.size >= MAX_TOTAL_SESSIONS) {
    throw new Error(`Maximum concurrent sessions (${MAX_TOTAL_SESSIONS}) reached. Close existing sessions first.`);
  }
  const agentCount = [...sessions.values()].filter(s => s.agentId === agentId).length;
  if (agentCount >= MAX_SESSIONS_PER_AGENT) {
    throw new Error(`Maximum concurrent sessions for agent "${agentId}" (${MAX_SESSIONS_PER_AGENT}) reached.`);
  }
}

/* ── Internal — Session reaping ───────────────────────────────────────── */

const STALE_SESSION_MS = 30 * 60 * 1000; // 30 minutes

function reapStaleSessions(): void {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of sessions) {
    const lastActivity = new Date(session.lastActivityAt).getTime();
    if (now - lastActivity > STALE_SESSION_MS && session.state !== 'active') {
      staleIds.push(id);
    }
  }
  // Close stale sessions outside the iteration to avoid mutating the Map mid-loop.
  for (const id of staleIds) {
    closeSession(id).catch(() => {});
  }
}
