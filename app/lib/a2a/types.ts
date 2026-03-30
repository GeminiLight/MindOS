/**
 * A2A Protocol v1.0 — Core Types for MindOS Agent Card & Task handling.
 * Subset of the full spec: only what's needed for Phase 1 (Server mode).
 * Reference: https://a2a-protocol.org/latest/specification/
 */

/* ── Agent Card ────────────────────────────────────────────────────────── */

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  provider: {
    organization: string;
    url: string;
  };
  supportedInterfaces: AgentInterface[];
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  securitySchemes?: Record<string, SecurityScheme>;
  securityRequirements?: Record<string, string[]>[];
}

export interface AgentInterface {
  url: string;
  protocolBinding: 'JSONRPC' | 'GRPC' | 'HTTP_JSON';
  protocolVersion: string;
}

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface SecurityScheme {
  httpAuthSecurityScheme?: {
    scheme: string;
    bearerFormat?: string;
  };
}

/* ── JSON-RPC ──────────────────────────────────────────────────────────── */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/* ── A2A Messages & Tasks ──────────────────────────────────────────────── */

export type TaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_REJECTED';

export type MessageRole = 'ROLE_USER' | 'ROLE_AGENT';

export interface MessagePart {
  text?: string;
  data?: unknown;
  mediaType?: string;
  metadata?: Record<string, unknown>;
}

export interface A2AMessage {
  role: MessageRole;
  parts: MessagePart[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  message?: A2AMessage;
  timestamp: string;
}

export interface TaskArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: MessagePart[];
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: TaskArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

/* ── A2A Method Params ─────────────────────────────────────────────────── */

export interface SendMessageParams {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    blocking?: boolean;
    historyLength?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface GetTaskParams {
  id: string;
  historyLength?: number;
}

export interface CancelTaskParams {
  id: string;
}

/* ── Error Codes ───────────────────────────────────────────────────────── */

export const A2A_ERRORS = {
  TASK_NOT_FOUND: { code: -32001, message: 'Task not found' },
  TASK_NOT_CANCELABLE: { code: -32002, message: 'Task not cancelable' },
  UNSUPPORTED_OPERATION: { code: -32004, message: 'Unsupported operation' },
  CONTENT_TYPE_NOT_SUPPORTED: { code: -32005, message: 'Content type not supported' },
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
} as const;
