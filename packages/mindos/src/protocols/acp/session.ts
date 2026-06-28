/**
 * ACP Session Manager — High-level session lifecycle for ACP agents.
 * Uses @agentclientprotocol/sdk for all protocol handling.
 * Implements: initialize → session/new → session/prompt → session/cancel → close.
 */

import type {
  ClientSideConnection,
  McpServer,
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
  AcpAvailableCommand,
  AcpPermissionEvent,
  AcpSessionSnapshot,
  AcpToolCallFull,
  AcpSessionMcpServerSummary,
} from './types.js';
import { isAcpCapabilitySupported } from './types.js';
import {
  spawnAndConnect,
  killAgent,
  type AcpConnection,
  type AcpLaunchOptions,
  type AcpPermissionMode,
  type AcpProcess,
} from './subprocess.js';
import { findAcpAgent } from './registry.js';
import { resolveConfiguredAcpAgentEntry } from './agent-descriptors.js';
import {
  buildAcpSessionMcpInheritancePlan,
  type AcpSessionMcpConfigLike,
} from './mcp-session-inheritance.js';
import { rememberAcpHandshakeHealth } from './handshake-health.js';
import { recordArtifactsFromAcpToolCall } from '../../agent/ledger/artifact-ledger.js';
import { redactSensitiveText } from '../../agent/redaction.js';

export interface AcpSessionOptions extends AcpLaunchOptions {
  clientVersion?: string;
  inheritMcpServers?: boolean;
  mcpConfig?: AcpSessionMcpConfigLike | null;
  mcpServers?: McpServer[];
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

function clientCapabilitiesForPermissionMode(mode: AcpPermissionMode | undefined) {
  const readonly = mode === 'readonly';
  return {
    fs: { readTextFile: true, writeTextFile: !readonly },
    terminal: !readonly,
  };
}

function resolveSessionMcpInheritance(
  options: AcpSessionOptions | undefined,
  agentCapabilities: AcpAgentCapabilities | undefined,
): { servers: McpServer[]; summaries: AcpSessionMcpServerSummary[] } {
  if (options?.mcpServers) {
    return {
      servers: options.mcpServers,
      summaries: options.mcpServers.map((server) => ({
        name: server.name,
        type: 'type' in server && server.type === 'http'
          ? 'http'
          : 'type' in server && server.type === 'sse'
            ? 'sse'
            : 'type' in server && server.type === 'acp'
              ? 'acp'
              : 'stdio',
      })),
    };
  }
  if (options?.inheritMcpServers === false || !options?.mcpConfig) {
    return { servers: [], summaries: [] };
  }
  const plan = buildAcpSessionMcpInheritancePlan({
    config: options.mcpConfig,
    agentCapabilities,
  });
  return {
    servers: plan.servers,
    summaries: plan.summaries,
  };
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
  const entry = resolveConfiguredAcpAgentEntry(agentId, options?.overrides)
    ?? await findAcpAgent(agentId);
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

  const startedAt = Date.now();
  const sessionCwd = options?.cwd ?? process.cwd();
  const conn = spawnAndConnect(entry, options);

  let agentCapabilities: AcpAgentCapabilities | undefined;
  let authMethods: AcpAuthMethod[] | undefined;

  // Phase 1: Initialize
  try {
    const initResult = await conn.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: clientCapabilitiesForPermissionMode(options?.permissionMode),
      clientInfo: { name: 'mindos', version: getMindosVersion(options) },
    });

    agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
    authMethods = parseAuthMethods(initResult.authMethods);
  } catch (err) {
    // Wait briefly for stderr/exit info before diagnosing
    await new Promise(r => setTimeout(r, 200));
    const message = diagnoseInitFailure(conn.process, err as Error);
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'initialize',
      startedAt,
      message,
    });
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
  let currentModeId: string | undefined;
  let agentSessionId: string | undefined;
  const mcpInheritance = resolveSessionMcpInheritance(options, agentCapabilities);

  try {
    const newResult = await conn.connection.newSession({
      cwd: sessionCwd,
      mcpServers: mcpInheritance.servers,
    });

    if (typeof newResult.sessionId === 'string') {
      agentSessionId = newResult.sessionId;
    }
    modes = parseModes(newResult.modes);
    currentModeId = parseCurrentModeId(newResult.modes);
    configOptions = parseConfigOptions(newResult.configOptions);
    currentModeId ??= currentModeFromConfig(configOptions);
  } catch (sessionErr) {
    const msg = (sessionErr as Error).message ?? '';
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-new',
      startedAt,
      message: msg,
      capabilities: agentCapabilities,
    });
    killAgent(conn.process);
    throw new Error(`${entry.id}: session/new failed: ${msg}`);
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
    currentModeId,
    authMethods,
    mcpServers: mcpInheritance.summaries,
  };

  sessions.set(sessionId, session);
  sessionConnections.set(sessionId, conn);
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
 * Load/resume an existing session on an agent.
 */
export async function loadSession(
  agentId: string,
  existingSessionId: string,
  options?: AcpSessionOptions,
): Promise<AcpSession> {
  const startedAt = Date.now();
  const entry = resolveConfiguredAcpAgentEntry(agentId, options?.overrides)
    ?? await findAcpAgent(agentId);
  if (!entry) {
    throw new Error(`ACP agent not found in registry: ${agentId}`);
  }

  const loadCwd = options?.cwd ?? process.cwd();
  const conn = spawnAndConnect(entry, options);

  let agentCapabilities: AcpAgentCapabilities | undefined;

  try {
    const initResult = await conn.connection.initialize({
      protocolVersion: 1,
      clientCapabilities: clientCapabilitiesForPermissionMode(options?.permissionMode),
      clientInfo: { name: 'mindos', version: getMindosVersion(options) },
    });
    agentCapabilities = parseAgentCapabilities(initResult.agentCapabilities);
  } catch (err) {
    await new Promise(r => setTimeout(r, 200));
    const message = diagnoseInitFailure(conn.process, err as Error);
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'initialize',
      startedAt,
      message,
    });
    killAgent(conn.process);
    throw new Error(message);
  }

  if (!agentCapabilities?.loadSession) {
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-load',
      startedAt,
      message: `Agent ${agentId} does not support session/load`,
      capabilities: agentCapabilities,
    });
    killAgent(conn.process);
    throw new Error(`Agent ${agentId} does not support session/load`);
  }

  let modes: AcpMode[] | undefined;
  let configOptions: AcpConfigOption[] | undefined;
  let currentModeId: string | undefined;
  const mcpInheritance = resolveSessionMcpInheritance(options, agentCapabilities);

  try {
    const loadResult = await conn.connection.loadSession({
      sessionId: existingSessionId,
      cwd: loadCwd,
      mcpServers: mcpInheritance.servers,
    });
    modes = parseModes(loadResult.modes);
    currentModeId = parseCurrentModeId(loadResult.modes);
    configOptions = parseConfigOptions(loadResult.configOptions);
    currentModeId ??= currentModeFromConfig(configOptions);
  } catch (err) {
    rememberAcpHandshakeHealth({
      agentId: entry.id,
      status: 'failed',
      stage: 'session-load',
      startedAt,
      message: (err as Error).message,
      capabilities: agentCapabilities,
    });
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
    currentModeId,
    mcpServers: mcpInheritance.summaries,
  };

  sessions.set(existingSessionId, session);
  sessionConnections.set(existingSessionId, conn);
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
const TOOL_RAW_TEXT_LIMIT = 4000;
const INLINE_IMAGE_RESULT_LIMIT = 64 * 1024;
const INLINE_IMAGE_PREFIX_RE = /^(?:data:image\/|iVBORw0KGgo|\/9j\/|UklGR)/;

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
    applySessionUpdate(session, update);
    if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
      notificationText += update.text;
    }
  };
  conn.callbacks.onPermissionRequest = (event) => {
    applySessionUpdate(session, { sessionId, type: 'permission_request', permission: event });
  };
  conn.callbacks.onPermissionResolved = (event) => {
    applySessionUpdate(session, { sessionId, type: 'permission_resolved', permission: event });
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
    conn.callbacks.onPermissionRequest = undefined;
    conn.callbacks.onPermissionResolved = undefined;
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
    applySessionUpdate(session, update);
    onUpdate(update);

    if ((update.type === 'agent_message_chunk' || update.type === 'text') && update.text) {
      aggregatedText += update.text;
    }
  };
  conn.callbacks.onPermissionRequest = (event) => {
    const update: AcpSessionUpdate = { sessionId, type: 'permission_request', permission: event };
    applySessionUpdate(session, update);
    onUpdate(update);
  };
  conn.callbacks.onPermissionResolved = (event) => {
    const update: AcpSessionUpdate = { sessionId, type: 'permission_resolved', permission: event };
    applySessionUpdate(session, update);
    onUpdate(update);
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
    conn.callbacks.onPermissionRequest = undefined;
    conn.callbacks.onPermissionResolved = undefined;
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
  session.currentModeId = modeId;
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
  if (configOptions) {
    session.configOptions = configOptions;
    session.currentModeId = currentModeFromConfig(configOptions) ?? session.currentModeId;
  }
  session.lastActivityAt = new Date().toISOString();
  return session.configOptions ?? [];
}

export async function closeSession(
  sessionId: string,
  options: { closeAgentSession?: boolean } = {},
): Promise<void> {
  const session = sessions.get(sessionId);
  const conn = sessionConnections.get(sessionId);

  if (conn?.process.alive) {
    const wireSessionId = session?.agentSessionId ?? sessionId;
    if (options.closeAgentSession !== false) {
      try {
        await closeAgentSession(conn.connection, wireSessionId);
      } catch {
        // Best-effort — many agents don't support session/close
      }
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

export function getSessionSnapshot(sessionId: string): AcpSessionSnapshot | undefined {
  const session = sessions.get(sessionId);
  return session ? buildAcpSessionSnapshot(session) : undefined;
}

export function getActiveSessionSnapshots(): AcpSessionSnapshot[] {
  reapStaleSessions();
  return [...sessions.values()].map(buildAcpSessionSnapshot);
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

export function buildAcpSessionSnapshot(session: AcpSession): AcpSessionSnapshot {
  const modes = session.modes ?? [];
  const configOptions = session.configOptions ?? [];
  const toolCalls = session.toolCalls ?? [];
  const permissionEvents = session.permissionEvents ?? [];
  return {
    schemaVersion: 1,
    sessionId: session.id,
    agentId: session.agentId,
    ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
    state: session.state,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
    ...(session.agentCapabilities ? { agentCapabilities: session.agentCapabilities } : {}),
    authMethods: session.authMethods ?? [],
    modes,
    ...(session.currentModeId ? { currentModeId: session.currentModeId } : {}),
    configOptions,
    controls: {
      model: buildControlSnapshot(configOptions, 'model'),
      mode: buildModeControlSnapshot(configOptions, modes, session.currentModeId),
      thoughtLevel: buildControlSnapshot(configOptions, 'thought_level'),
    },
    availableCommands: session.availableCommands ?? [],
    toolCalls,
    toolSummary: summarizeToolCalls(toolCalls),
    permissionEvents,
    pendingPermissions: permissionEvents.filter((event) => event.status === 'pending'),
    ...(session.sessionInfo ? { sessionInfo: session.sessionInfo } : {}),
    mcpServers: session.mcpServers ?? [],
  };
}

function applySessionUpdate(session: AcpSession, update: AcpSessionUpdate): void {
  session.lastActivityAt = new Date().toISOString();
  if (update.type === 'available_commands_update') {
    session.availableCommands = parseAvailableCommands(update.availableCommands);
    return;
  }
  if (update.type === 'current_mode_update' && update.currentModeId) {
    session.currentModeId = update.currentModeId;
    return;
  }
  if (update.type === 'config_option_update' && update.configOptions) {
    session.configOptions = update.configOptions;
    session.currentModeId = currentModeFromConfig(update.configOptions) ?? session.currentModeId;
    return;
  }
  if ((update.type === 'tool_call' || update.type === 'tool_call_update') && update.toolCall) {
    session.toolCalls = upsertToolCall(session.toolCalls, update.toolCall);
    recordArtifactsFromAcpToolCall({
      runtimeId: session.agentId,
      sessionId: session.id,
      ...(session.agentSessionId ? { externalSessionId: session.agentSessionId } : {}),
      ...(session.cwd ? { cwd: session.cwd } : {}),
      toolCall: update.toolCall,
    });
    return;
  }
  if (update.type === 'session_info_update' && update.sessionInfo) {
    session.sessionInfo = {
      ...session.sessionInfo,
      ...update.sessionInfo,
    };
    return;
  }
  if ((update.type === 'permission_request' || update.type === 'permission_resolved') && update.permission) {
    session.permissionEvents = upsertPermissionEvent(session.permissionEvents, update.permission);
  }
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
      const rawOutputPointers = extractRawOutputPointers(tc.rawOutput ?? tc.raw_output);
      const locations = [
        ...parseToolCallLocations(tc.locations),
        ...rawOutputPointers.locations,
      ];
      base.toolCall = {
        toolCallId: String(tc.toolCallId ?? ''),
        title: typeof tc.title === 'string' ? tc.title : undefined,
        status: (tc.status as 'pending' | 'in_progress' | 'completed' | 'failed') ?? 'pending',
        kind: tc.kind as AcpSessionUpdate['toolCall'] extends { kind: infer K } ? K : undefined,
        rawInput: safeToolRawText(tc.rawInput),
        rawOutput: safeToolRawText(tc.rawOutput ?? tc.raw_output),
        content: parseToolCallContent(tc.content),
        ...(locations.length > 0 ? { locations } : {}),
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

function safeToolRawText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length > INLINE_IMAGE_RESULT_LIMIT
    && INLINE_IMAGE_PREFIX_RE.test(trimmed)
  ) {
    return undefined;
  }
  const redacted = redactSensitiveText(trimmed);
  return redacted.length > TOOL_RAW_TEXT_LIMIT
    ? `${redacted.slice(0, TOOL_RAW_TEXT_LIMIT)}...`
    : redacted;
}

function parseToolCallLocations(value: unknown): NonNullable<AcpToolCallFull['locations']> {
  if (!Array.isArray(value)) return [];
  const locations: NonNullable<AcpToolCallFull['locations']> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const rawPath = typeof record.path === 'string'
      ? record.path
      : typeof record.uri === 'string' && record.uri.startsWith('file://')
        ? record.uri.slice('file://'.length)
        : '';
    const path = rawPath.trim();
    if (!path) continue;
    const line = typeof record.line === 'number' && Number.isFinite(record.line)
      ? Math.max(1, Math.floor(record.line))
      : undefined;
    const key = `${path}:${line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ path, ...(line ? { line } : {}) });
    if (locations.length >= 50) break;
  }
  return locations;
}

function parseToolCallContent(value: unknown): AcpContentBlock[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks: AcpContentBlock[] = [];
  for (const item of value) {
    const block = parseToolCallContentBlock(item);
    if (block) blocks.push(block);
    if (blocks.length >= 50) break;
  }
  return blocks.length > 0 ? blocks : undefined;
}

function parseToolCallContentBlock(value: unknown): AcpContentBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type === 'resource_link' && typeof record.uri === 'string') {
    return {
      type: 'resource_link',
      uri: record.uri,
      name: typeof record.name === 'string' && record.name.trim() ? record.name : 'resource',
    };
  }
  if (record.type === 'resource') {
    const resource = record.resource;
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return null;
    const resourceRecord = resource as Record<string, unknown>;
    if (typeof resourceRecord.uri !== 'string') return null;
    return {
      type: 'resource',
      resource: {
        uri: resourceRecord.uri,
        ...(typeof resourceRecord.text === 'string' ? { text: safeToolRawText(resourceRecord.text) ?? '' } : {}),
      },
    };
  }
  return null;
}

function extractRawOutputPointers(value: unknown): {
  locations: NonNullable<AcpToolCallFull['locations']>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { locations: [] };
  const record = value as Record<string, unknown>;
  const candidates = [
    record.saved_path,
    record.savedPath,
    readNestedString(record.image, 'path'),
    readNestedString(record.artifact, 'path'),
  ];
  const locations = candidates
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => ({ path: candidate.trim() }));
  return { locations };
}

function readNestedString(value: unknown, key: string): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === 'string'
    ? (value as Record<string, string>)[key]
    : undefined;
}

/* ── Internal — Parsers ───────────────────────────────────────────────── */

function parseAgentCapabilities(raw: unknown): AcpAgentCapabilities | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    loadSession: obj.loadSession === true,
    mcpCapabilities: parseMcpCapabilities(obj.mcpCapabilities),
    promptCapabilities: typeof obj.promptCapabilities === 'object' ? obj.promptCapabilities as AcpAgentCapabilities['promptCapabilities'] : undefined,
    sessionCapabilities: parseSessionCapabilities(obj.sessionCapabilities),
  };
}

type SessionCloseConnection = ClientSideConnection & {
  closeSession?: (params: { sessionId: string }) => Promise<unknown>;
  unstable_closeSession?: (params: { sessionId: string }) => Promise<unknown>;
};

function closeAgentSession(connection: ClientSideConnection, sessionId: string): Promise<unknown> {
  const closable = connection as SessionCloseConnection;
  const close = typeof closable.closeSession === 'function'
    ? closable.closeSession
    : closable.unstable_closeSession;
  return close ? close.call(closable, { sessionId }) : Promise.resolve();
}

function parseMcpCapabilities(raw: unknown): AcpAgentCapabilities['mcpCapabilities'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return compactBooleans({
    stdio: capabilityFlag(obj.stdio),
    http: capabilityFlag(obj.http),
    sse: capabilityFlag(obj.sse),
    acp: capabilityFlag(obj.acp),
  });
}

function parseSessionCapabilities(raw: unknown): AcpAgentCapabilities['sessionCapabilities'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return compactBooleans({
    list: capabilityFlag(obj.list),
    delete: capabilityFlag(obj.delete),
    resume: capabilityFlag(obj.resume),
    fork: capabilityFlag(obj.fork),
    close: capabilityFlag(obj.close),
  });
}

function capabilityFlag(value: unknown): boolean | undefined {
  if (value === true || isAcpCapabilitySupported(value)) return true;
  if (value === false) return false;
  return undefined;
}

function compactBooleans<T extends Record<string, boolean | undefined>>(value: T): { [K in keyof T]?: boolean } | undefined {
  const entries = Object.entries(value).filter((entry): entry is [keyof T & string, boolean] => typeof entry[1] === 'boolean');
  return entries.length > 0 ? Object.fromEntries(entries) as { [K in keyof T]?: boolean } : undefined;
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

function parseCurrentModeId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.currentModeId === 'string' && obj.currentModeId.trim()) return obj.currentModeId.trim();
  const currentMode = obj.currentMode;
  if (currentMode && typeof currentMode === 'object' && !Array.isArray(currentMode)) {
    const id = (currentMode as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return undefined;
}

function parseConfigOptions(raw: unknown): AcpConfigOption[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map(o => ({
      type: 'select' as const,
      configId: String(o.configId ?? o.id ?? ''),
      category: String(o.category ?? 'other'),
      label: typeof o.label === 'string' ? o.label : typeof o.name === 'string' ? o.name : undefined,
      currentValue: String(o.currentValue ?? ''),
      options: parseConfigOptionEntries(o.options),
    }))
    .filter(o => o.configId);
}

function parseConfigOptionEntries(raw: unknown): AcpConfigOption['options'] {
  if (!Array.isArray(raw)) return [];
  const entries: AcpConfigOption['options'] = [];
  const pushEntry = (option: unknown) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return;
    const record = option as Record<string, unknown>;
    const id = String(record.id ?? record.value ?? '').trim();
    const label = String(record.label ?? record.name ?? id).trim();
    if (id) entries.push({ id, label: label || id });
  };
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item) && Array.isArray((item as Record<string, unknown>).options)) {
      for (const nested of (item as Record<string, unknown>).options as unknown[]) {
        pushEntry(nested);
      }
      continue;
    }
    pushEntry(item);
  }
  return entries;
}

function parseAvailableCommands(raw: unknown): AcpAvailableCommand[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const commands: AcpAvailableCommand[] = [];
  for (const entry of raw) {
    const command = normalizeAvailableCommand(entry);
    if (!command || seen.has(command.id)) continue;
    seen.add(command.id);
    commands.push(command);
    if (commands.length >= 100) break;
  }
  return commands;
}

function normalizeAvailableCommand(entry: unknown): AcpAvailableCommand | null {
  if (typeof entry === 'string') {
    const name = entry.trim().replace(/^\//, '');
    return name ? { id: name, name } : null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const rawName = record.name ?? record.id ?? record.command ?? record.title;
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim().replace(/^\//, '');
  if (!name) return null;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim().replace(/^\//, '')
    : name;
  const description = typeof record.description === 'string' && record.description.trim()
    ? record.description.trim().slice(0, 300)
    : undefined;
  return {
    id,
    name,
    ...(description ? { description } : {}),
  };
}

function currentModeFromConfig(configOptions: AcpConfigOption[] | undefined): string | undefined {
  const option = findConfigOption(configOptions ?? [], 'mode');
  return option?.currentValue?.trim() || undefined;
}

function buildControlSnapshot(configOptions: AcpConfigOption[], category: string): AcpSessionSnapshot['controls']['model'] {
  const option = findConfigOption(configOptions, category);
  if (!option) {
    return {
      status: 'unavailable',
      source: 'unavailable',
      options: [],
    };
  }
  return {
    status: 'available',
    source: 'observed',
    configId: option.configId,
    currentValue: option.currentValue,
    options: option.options,
  };
}

function buildModeControlSnapshot(
  configOptions: AcpConfigOption[],
  modes: AcpMode[],
  currentModeId: string | undefined,
): AcpSessionSnapshot['controls']['mode'] {
  const option = findConfigOption(configOptions, 'mode');
  if (option) {
    return {
      status: 'available',
      source: 'observed',
      configId: option.configId,
      ...(currentModeId ?? option.currentValue ? { currentValue: currentModeId ?? option.currentValue } : {}),
      options: option.options,
    };
  }
  if (modes.length === 0) {
    return {
      status: 'unavailable',
      source: 'unavailable',
      options: [],
    };
  }
  return {
    status: 'available',
    source: currentModeId ? 'observed' : 'declared',
    ...(currentModeId ? { currentValue: currentModeId } : {}),
    options: modes.map((mode) => ({ id: mode.id, label: mode.name })),
  };
}

function findConfigOption(configOptions: AcpConfigOption[], category: string): AcpConfigOption | undefined {
  return configOptions.find((option) => {
    const optionCategory = option.category.toLowerCase();
    const configId = option.configId.toLowerCase();
    if (category === 'thought_level') {
      return optionCategory === 'thought_level'
        || optionCategory === 'reasoning'
        || configId === 'thought_level'
        || configId === 'thinking'
        || configId === 'reasoning_effort';
    }
    return optionCategory === category || configId === category;
  });
}

function upsertToolCall(
  existing: AcpToolCallFull[] | undefined,
  update: AcpToolCallFull,
): AcpToolCallFull[] {
  if (!update.toolCallId) return existing ?? [];
  const next = [...(existing ?? [])];
  const index = next.findIndex((toolCall) => toolCall.toolCallId === update.toolCallId);
  if (index === -1) return [...next, update].slice(-100);
  next[index] = {
    ...next[index],
    ...update,
    status: update.status ?? next[index]!.status,
  };
  return next;
}

function summarizeToolCalls(toolCalls: AcpToolCallFull[]): AcpSessionSnapshot['toolSummary'] {
  return {
    total: toolCalls.length,
    pending: toolCalls.filter((toolCall) => toolCall.status === 'pending').length,
    inProgress: toolCalls.filter((toolCall) => toolCall.status === 'in_progress').length,
    completed: toolCalls.filter((toolCall) => toolCall.status === 'completed').length,
    failed: toolCalls.filter((toolCall) => toolCall.status === 'failed').length,
  };
}

function upsertPermissionEvent(
  existing: AcpPermissionEvent[] | undefined,
  update: AcpPermissionEvent,
): AcpPermissionEvent[] {
  const next = [...(existing ?? [])];
  const index = next.findIndex((event) => event.requestId === update.requestId);
  if (index === -1) return [...next, update].slice(-100);
  next[index] = {
    ...next[index],
    ...update,
    options: update.options.length > 0 ? update.options : next[index]!.options,
    requestedAt: next[index]!.requestedAt || update.requestedAt,
  };
  return next;
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
