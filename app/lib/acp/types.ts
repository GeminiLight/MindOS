/**
 * ACP (Agent Client Protocol) — Core Types for MindOS ACP integration.
 * ACP uses JSON-RPC 2.0 over stdio (subprocess model), not HTTP.
 * Sessions are stateful with prompt turns, tool calls, and streaming updates.
 * Reference: https://agentclientprotocol.com
 */

/* ── Transport ────────────────────────────────────────────────────────── */

/** How an ACP agent is spawned */
export type AcpTransportType = 'stdio' | 'npx' | 'uvx' | 'binary';

/* ── Capabilities ─────────────────────────────────────────────────────── */

/** What MindOS exposes as an ACP agent */
export interface AcpCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  multiTurn: boolean;
  cancellation: boolean;
}

/* ── Session ──────────────────────────────────────────────────────────── */

export type AcpSessionState = 'idle' | 'active' | 'error';

export interface AcpSession {
  id: string;
  agentId: string;
  state: AcpSessionState;
  createdAt: string;
  lastActivityAt: string;
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
  text: string;
  metadata?: Record<string, unknown>;
}

export interface AcpPromptResponse {
  sessionId: string;
  text: string;
  done: boolean;
  toolCalls?: AcpToolCall[];
  metadata?: Record<string, unknown>;
}

/* ── Session Updates (streaming) ──────────────────────────────────────── */

export type AcpUpdateType = 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';

export interface AcpSessionUpdate {
  sessionId: string;
  type: AcpUpdateType;
  text?: string;
  toolCall?: AcpToolCall;
  toolResult?: AcpToolResult;
  error?: string;
}

/* ── Tool Calls ───────────────────────────────────────────────────────── */

export interface AcpToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AcpToolResult {
  callId: string;
  result: string;
  isError?: boolean;
}

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
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
} as const;
