/**
 * ACP (Agent Client Protocol) — Core Types for MindOS ACP integration.
 * ACP uses JSON-RPC 2.0 over stdio (subprocess model), not HTTP.
 * Sessions are stateful with prompt turns, tool calls, and streaming updates.
 * Reference: https://agentclientprotocol.com
 */

/* ── Transport ────────────────────────────────────────────────────────── */

/** How an ACP agent is spawned */
export type AcpTransportType = 'stdio' | 'npx' | 'uvx' | 'binary';

/* ── ContentBlock (ACP prompt format) ─────────────────────────────────── */

export type AcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string } };

/* ── StopReason ───────────────────────────────────────────────────────── */

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

/* ── Modes & Config ───────────────────────────────────────────────────── */

export interface AcpMode {
  id: string;
  name: string;
  description?: string;
}

export interface AcpConfigOptionEntry {
  id: string;
  label: string;
}

export interface AcpConfigOption {
  type: 'select';
  configId: string;
  category: 'mode' | 'model' | 'thought_level' | 'other' | string;
  label?: string;
  currentValue: string;
  options: AcpConfigOptionEntry[];
}

/* ── Auth ──────────────────────────────────────────────────────────────── */

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
}

/* ── Capabilities ─────────────────────────────────────────────────────── */

/** What the agent declares it supports (from initialize response). */
export interface AcpAgentCapabilities {
  loadSession?: boolean;
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  promptCapabilities?: { audio?: boolean; embeddedContext?: boolean; image?: boolean };
  sessionCapabilities?: { list?: boolean };
}

/** What MindOS declares as a client (sent in initialize request). */
export interface AcpClientCapabilities {
  fs?: { readTextFile?: boolean; writeTextFile?: boolean };
  terminal?: boolean;
}

/* ── Session ──────────────────────────────────────────────────────────── */

export type AcpSessionState = 'idle' | 'active' | 'error';

export interface AcpSession {
  id: string;
  agentId: string;
  state: AcpSessionState;
  cwd?: string;
  createdAt: string;
  lastActivityAt: string;
  /** Agent capabilities from initialize response */
  agentCapabilities?: AcpAgentCapabilities;
  /** Modes available from session/new or session/load response */
  modes?: AcpMode[];
  /** Config options from session/new or session/load response */
  configOptions?: AcpConfigOption[];
  /** Auth methods from initialize response */
  authMethods?: AcpAuthMethod[];
}

/** Lightweight session info returned by session/list. */
export interface AcpSessionInfo {
  sessionId: string;
  title?: string;
  cwd?: string;
  updatedAt?: string;
}

/* ── JSON-RPC (ACP uses JSON-RPC 2.0 over stdio) ─────────────────────── */

export interface AcpJsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface AcpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: AcpJsonRpcError;
}

export interface AcpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/* ── Prompt ────────────────────────────────────────────────────────────── */

export interface AcpPromptRequest {
  sessionId: string;
  prompt: AcpContentBlock[];
  context?: { cwd?: string };
  stream?: boolean;
}

export interface AcpPromptResponse {
  sessionId: string;
  text: string;
  done: boolean;
  stopReason?: AcpStopReason;
  toolCalls?: AcpToolCall[];
  metadata?: Record<string, unknown>;
}

/* ── ToolCall (full ACP model) ────────────────────────────────────────── */

export type AcpToolCallKind =
  | 'read' | 'edit' | 'delete' | 'move' | 'search'
  | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';

export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AcpToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Full tool call with status, kind, and content — used in session updates. */
export interface AcpToolCallFull {
  toolCallId: string;
  title?: string;
  kind?: AcpToolCallKind;
  status: AcpToolCallStatus;
  rawInput?: string;
  rawOutput?: string;
  content?: AcpContentBlock[];
  locations?: { path: string; line?: number }[];
}

export interface AcpToolResult {
  callId: string;
  result: string;
  isError?: boolean;
}

/* ── Plan ──────────────────────────────────────────────────────────────── */

export type AcpPlanEntryStatus = 'pending' | 'in_progress' | 'completed';
export type AcpPlanEntryPriority = 'high' | 'medium' | 'low';

export interface AcpPlanEntry {
  content: string;
  status: AcpPlanEntryStatus;
  priority: AcpPlanEntryPriority;
}

export interface AcpPlan {
  entries: AcpPlanEntry[];
}

/* ── Session Updates (streaming) — Full ACP spec ──────────────────────── */

export type AcpUpdateType =
  | 'user_message_chunk'
  | 'agent_message_chunk'
  | 'agent_thought_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'plan'
  | 'available_commands_update'
  | 'current_mode_update'
  | 'config_option_update'
  | 'session_info_update'
  // Legacy compat (mapped internally)
  | 'text'
  | 'tool_result'
  | 'done'
  | 'error';

export interface AcpSessionUpdate {
  sessionId: string;
  type: AcpUpdateType;
  /** Text content for message chunk types */
  text?: string;
  /** Structured tool call data */
  toolCall?: AcpToolCallFull;
  /** Tool result (legacy) */
  toolResult?: AcpToolResult;
  /** Plan entries */
  plan?: AcpPlan;
  /** Available commands (opaque to client) */
  availableCommands?: unknown[];
  /** Current mode ID */
  currentModeId?: string;
  /** Updated config options */
  configOptions?: AcpConfigOption[];
  /** Session info update */
  sessionInfo?: { title?: string; updatedAt?: string };
  /** Error message */
  error?: string;
}

/* ── Permission ───────────────────────────────────────────────────────── */

export type AcpPermissionOutcome = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

/* ── Registry ─────────────────────────────────────────────────────────── */

/** An entry from the ACP registry (registry.json) */
export interface AcpRegistryEntry {
  id: string;
  name: string;
  description: string;
  version?: string;
  transport: AcpTransportType;
  command: string;
  /** npm package name for npx-based agents (e.g. "@google/gemini-cli") */
  packageName?: string;
  args?: string[];
  env?: Record<string, string>;
  tags?: string[];
  homepage?: string;
}

/** Parsed registry response */
export interface AcpRegistry {
  version: string;
  agents: AcpRegistryEntry[];
  fetchedAt: string;
}

/* ── Error Codes ──────────────────────────────────────────────────────── */

export const ACP_ERRORS = {
  SESSION_NOT_FOUND: { code: -32001, message: 'Session not found' },
  SESSION_BUSY: { code: -32002, message: 'Session is busy' },
  AGENT_NOT_FOUND: { code: -32003, message: 'Agent not found in registry' },
  SPAWN_FAILED: { code: -32004, message: 'Failed to spawn agent process' },
  TRANSPORT_ERROR: { code: -32005, message: 'Transport error' },
  AUTH_REQUIRED: { code: -32000, message: 'Authentication required' },
  RESOURCE_NOT_FOUND: { code: -32002, message: 'Resource not found' },
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
} as const;
