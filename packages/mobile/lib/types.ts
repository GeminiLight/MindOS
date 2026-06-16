/**
 * Shared types for MindOS mobile app.
 * Copied from packages/web/lib/types.ts + packages/web/lib/core/types.ts.
 * Keep in sync until these API types are promoted into the product package.
 */

// --- Core domain types (from packages/web/lib/core/types.ts) ---

export interface SpacePreview {
  instructionLines: string[];
  readmeLines: string[];
  isTemplate?: boolean;
  readmeIsTemplate?: boolean;
  lastCompiled?: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  extension?: string;
  mtime?: number;
  isSpace?: boolean;
  spacePreview?: SpacePreview;
}

export interface SearchResult {
  path: string;
  snippet: string;
  score: number;
  occurrences: number;
}

export interface BacklinkEntry {
  source: string;
  line: number;
  context: string;
}

// --- UI / API types (from packages/web/lib/types.ts) ---

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: string;
  state: 'pending' | 'running' | 'done' | 'error';
  runtime?: AgentRuntimeKind;
  runtimePermission?: RuntimePermissionState;
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ImagePart {
  type: 'image';
  data: string;
  mimeType: ImageMimeType;
  fileName?: string;
}

export type AgentRunNodeKind =
  | 'mindos-main'
  | 'mindos-headless'
  | 'native-runtime'
  | 'pi-subagent'
  | 'acp'
  | 'a2a';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out';

export type AgentRunPermissionMode = 'readonly' | 'organize' | 'agent';

export interface AgentRunTimelineRecord {
  id: string;
  rootRunId?: string;
  parentRunId?: string;
  chatSessionId?: string;
  agentKind: AgentRunNodeKind;
  runtimeId: string;
  displayName: string;
  status: AgentRunStatus;
  cwd?: string;
  permissionMode: AgentRunPermissionMode;
  inputSummary: string;
  outputSummary?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export type AgentRunTimelineEventCategory =
  | 'status'
  | 'text'
  | 'tool'
  | 'file'
  | 'permission'
  | 'question'
  | 'error';

export type AgentRunTimelineEventData =
  | {
      kind: 'status';
      previousStatus?: AgentRunStatus;
      nextStatus: AgentRunStatus;
      summary?: string;
    }
  | {
      kind: 'text';
      text: string;
      channel?: 'assistant' | 'reasoning' | 'stdout' | 'stderr' | 'system';
    }
  | {
      kind: 'tool';
      name: string;
      status?: 'started' | 'running' | 'completed' | 'failed' | 'canceled';
      inputSummary?: string;
      outputSummary?: string;
      error?: string;
    }
  | {
      kind: 'file';
      path: string;
      action: 'read' | 'created' | 'updated' | 'deleted' | 'renamed' | 'diff' | 'unknown';
      status?: 'started' | 'completed' | 'failed';
      summary?: string;
    }
  | {
      kind: 'permission';
      action: string;
      status: 'requested' | 'approved' | 'denied' | 'expired' | 'skipped';
      requestId?: string;
      resource?: string;
      prompt?: string;
      decision?: string;
      decisionLabel?: string;
      decisionIntent?: 'allow' | 'deny' | 'cancel';
      decisionScope?: 'once' | 'session' | 'always' | 'turn';
      options?: Array<{
        id: string;
        label: string;
        intent?: 'allow' | 'deny' | 'cancel';
        scope?: 'once' | 'session' | 'always' | 'turn';
      }>;
      risk?: {
        level: 'low' | 'medium' | 'high';
        summary: string;
        reasons?: string[];
      };
    }
  | {
      kind: 'question';
      status: 'requested' | 'answered' | 'cancelled';
      prompt?: string;
      summary?: string;
    }
  | {
      kind: 'error';
      message: string;
      code?: string;
      recoverable?: boolean;
    };

export interface AgentRunTimelineEvent {
  id: string;
  runId: string;
  type: string;
  category: AgentRunTimelineEventCategory;
  ts: number;
  status: AgentRunStatus;
  record: AgentRunTimelineRecord;
  message?: string;
  data?: AgentRunTimelineEventData;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  filePath?: string;
  runtime?: string;
  visibility?: 'timeline' | 'debug';
  metadata?: Record<string, unknown>;
}

export interface AgentRunTimelinePart {
  type: 'agent-run-timeline';
  chatSessionId: string;
  rootRunId?: string;
  startedAfter?: number;
  runs: AgentRunTimelineRecord[];
  events?: AgentRunTimelineEvent[];
  updatedAt: number;
}

export type MessagePart = TextPart | ToolCallPart | ReasoningPart | ImagePart | AgentRunTimelinePart;

export interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  parts?: MessagePart[];
  images?: ImagePart[];
  skillName?: string;
  attachedFiles?: string[];
  uploadedFileNames?: string[];
}

export type AskMode = 'chat' | 'agent';

export type AgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';
export type AgentRuntimeStatus = 'available' | 'missing' | 'signed-out' | 'error';
export type AgentRuntimeAdapter =
  | 'mindos'
  | 'codex-app-server'
  | 'codex-sdk'
  | 'claude-cli'
  | 'claude-sdk'
  | 'acp';

export interface AgentRuntimeIdentity {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
}

export interface AgentRuntimeDescriptor extends AgentRuntimeIdentity {
  adapter?: AgentRuntimeAdapter;
  status: AgentRuntimeStatus;
  binaryPath?: string;
  installCmd?: string;
  packageName?: string;
  runtimeBridge?: {
    kind: 'codex-app-server' | 'claude-sdk' | 'claude-cli';
    label: string;
    fallback?: boolean;
    reason?: string;
  };
  availability?: {
    checkedAt: string;
    sources: Array<'acp-detect' | 'acp-registry' | 'mcp-agents' | 'native-health' | 'settings'>;
    reason?: string;
    diagnosticHints?: string[];
    stale?: boolean;
  };
}

export interface AgentRuntimesResponse {
  runtimes: AgentRuntimeDescriptor[];
  installed?: Array<{
    id: string;
    name: string;
    binaryPath?: string;
    status?: Exclude<AgentRuntimeStatus, 'missing'>;
    reason?: string;
  }>;
  notInstalled?: Array<{
    id: string;
    name: string;
    installCmd?: string;
    packageName?: string;
    status?: Extract<AgentRuntimeStatus, 'missing' | 'error'>;
    reason?: string;
  }>;
}

export interface AgentRunsResponse {
  runs: AgentRunTimelineRecord[];
  events: AgentRunTimelineEvent[];
}

export interface RuntimePermissionOption {
  id: string;
  label: string;
  description?: string;
  intent?: 'allow' | 'deny' | 'cancel';
  scope?: 'once' | 'session' | 'always' | 'turn';
}

export interface RuntimePermissionRequest {
  type: 'runtime_permission_request';
  runId: string;
  requestId: string;
  runtime: 'codex' | 'claude';
  toolCallId: string;
  toolName: string;
  input?: unknown;
  options: RuntimePermissionOption[];
  reason?: string;
  action?: string;
  resource?: string;
  risk?: {
    level: 'low' | 'medium' | 'high';
    summary: string;
    reasons?: string[];
  };
}

export interface RuntimePermissionState extends RuntimePermissionRequest {
  status: 'waiting' | 'approved' | 'denied' | 'cancelled';
  decision?: string;
  decisionLabel?: string;
  decisionIntent?: 'allow' | 'deny' | 'cancel';
  decisionScope?: 'once' | 'session' | 'always' | 'turn';
}

export interface ChatSession {
  id: string;
  title?: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  pinned?: boolean;
}

// --- API response types ---

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  authRequired: boolean;
}

export interface ConnectResponse {
  url: string;
  ip: string;
  port: number;
  hostname: string;
}

export interface FileSaveResponse {
  ok: boolean;
  mtime?: number;
  error?: string;
  serverMtime?: number;
}

export interface FileDeleteResponse {
  ok: boolean;
  trashId?: string;
}

export interface FileRenameResponse {
  ok: boolean;
  newPath?: string;
}
