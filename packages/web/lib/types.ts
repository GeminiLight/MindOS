// Re-export core types as single source of truth
export type { FileNode, SearchResult, BacklinkEntry } from './core/types';

/** System configuration files that should be hidden from file tree by default */
export const SYSTEM_FILES = new Set([
  'INSTRUCTION.md',
  'README.md',
  'CONFIG.json',
  'CHANGELOG.md',
]);

/** Root-level files that users can see but cannot delete */
export const UNDELETABLE_FILES = new Set([
  'TODO.md',
]);

export interface SearchMatch {
  indices: [number, number][];
  value: string;
  key: string;
}

export type SearchPrewarmCacheState = 'hit' | 'built';

export interface SearchPrewarmResponse {
  warmed: true;
  cacheState: SearchPrewarmCacheState;
  documentCount: number;
}

export type SearchWarmState = 'idle' | 'warming' | 'ready' | 'fallback';

export interface SearchWarmHintMessages {
  preparing: string;
  fallbackWarmHint: string;
}

export interface SearchPrewarmEligibility {
  active: boolean;
  hasAttemptedPrewarm: boolean;
  warmState: SearchWarmState;
}

/** Frontend-facing backlink shape returned by /api/backlinks (transformed from core BacklinkEntry) */
export interface BacklinkItem {
  filePath: string;
  snippets: string[];
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: string;
  state: 'pending' | 'running' | 'done' | 'error';
  runtime?: AgentRuntimeKind;
  userQuestion?: AskUserQuestionState;
  runtimePermission?: RuntimePermissionState;
}

export interface RuntimePermissionOption {
  id: string;
  label: string;
  description?: string;
  intent?: 'allow' | 'deny' | 'cancel';
}

export interface RuntimePermissionState {
  runId: string;
  requestId: string;
  runtime: Extract<AgentRuntimeKind, 'codex' | 'claude'>;
  status: 'waiting' | 'approved' | 'denied' | 'cancelled';
  options: RuntimePermissionOption[];
  decision?: string;
  reason?: string;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionAnswer {
  questionIndex: number;
  question: string;
  kind: 'option' | 'custom' | 'chat' | 'multi';
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
}

export interface AskUserQuestionState {
  runId: string;
  questions: AskUserQuestion[];
  status: 'waiting' | 'submitted' | 'cancelled';
  readOnly?: boolean;
  runtime?: AgentRuntimeKind;
  reason?: string;
  answers?: AskUserQuestionAnswer[];
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
  /** Base64-encoded image data (no data: prefix) */
  data: string;
  mimeType: ImageMimeType;
  /** Original file name, if available */
  fileName?: string;
}

export interface RuntimeStatusPart {
  type: 'runtime-status';
  message: string;
  runtime?: AgentRuntimeKind;
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
  permissionMode: 'readonly' | 'organize' | 'agent';
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
      resource?: string;
      prompt?: string;
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
  title?: string;
  message?: string;
  data?: AgentRunTimelineEventData;
  visibility?: 'timeline' | 'debug';
  toolName?: string;
  toolCallId?: string;
  filePath?: string;
  runtime?: string;
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

export type MessagePart = TextPart | ToolCallPart | ReasoningPart | ImagePart | RuntimeStatusPart | AgentRunTimelinePart;

export interface AgentIdentity {
  id: string;
  name: string;
}

export type AgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';

export interface AgentRuntimeIdentity extends AgentIdentity {
  kind: AgentRuntimeKind;
  binaryPath?: string;
}

export type AgentRuntimeStatus = 'available' | 'missing' | 'signed-out' | 'error';

export interface AgentRuntimeCapabilities {
  ownsModelSelection: boolean;
  supportsResume: boolean;
  supportsFreshSession: boolean;
  supportsListSessions: boolean;
  supportsAttachExisting: boolean;
  supportsFork: boolean;
  supportsArchive: boolean;
  supportsInterrupt: boolean;
  supportsModelList: boolean;
  supportsApprovals: boolean;
  supportsUserInput: boolean;
  supportsToolEvents: boolean;
  supportsRuntimeStatus: boolean;
  supportsDiffs: boolean;
  supportsCheckpoints: boolean;
  supportsBackgroundRuns: boolean;
  supportsMcpConfig: boolean;
}

export type AgentRuntimeAdapter =
  | 'mindos'
  | 'codex-app-server'
  | 'claude-cli'
  | 'claude-sdk'
  | 'acp';

export type AgentRuntimeOwner = 'mindos' | 'external';

export interface AgentRuntimeDescriptor extends AgentRuntimeIdentity {
  adapter: AgentRuntimeAdapter;
  modelOwner: AgentRuntimeOwner;
  authOwner: AgentRuntimeOwner;
  permissionOwner: AgentRuntimeOwner;
  sessionOwner: AgentRuntimeOwner;
  status: AgentRuntimeStatus;
  capabilities: AgentRuntimeCapabilities;
  description?: string;
  sourceAgentId?: string;
  canonicalAgentId?: string;
  mcpAgentKey?: string;
  aliases?: string[];
  binaryPath?: string;
  resolvedCommand?: {
    cmd: string;
    args: string[];
    source: 'user-override' | 'descriptor' | 'registry';
  };
  installCmd?: string;
  packageName?: string;
  availability?: {
    checkedAt: string;
    sources: Array<'acp-detect' | 'acp-registry' | 'mcp-agents' | 'native-health' | 'settings'>;
    reason?: string;
    diagnosticHints?: string[];
    stale?: boolean;
  };
}

export interface ExternalAgentBinding {
  runtime: Exclude<AgentRuntimeKind, 'mindos'>;
  externalSessionId?: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out';
  updatedAt: number;
}

export type RuntimeSessionKind = 'codex-thread' | 'claude-session' | 'acp-session';

export interface RuntimeSessionBinding {
  kind: RuntimeSessionKind;
  runtime: Exclude<AgentRuntimeKind, 'mindos'>;
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
  updatedAt: number;
}

export interface CodexThreadSummary {
  id: string;
  name?: string | null;
  preview?: string;
  cwd?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  status?: unknown;
  archived?: boolean;
}

export interface CodexThreadListResponse {
  data: CodexThreadSummary[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Unix timestamp in milliseconds when this message was created */
  timestamp?: number;
  /** Structured parts for assistant messages (tool calls + text segments) */
  parts?: MessagePart[];
  /** Images attached to this message (user messages only) */
  images?: ImagePart[];
  /** Skill name used for this user message (rendered as a capsule in the UI) */
  skillName?: string;
  /** KB file paths (@mentions) sent with this message */
  attachedFiles?: string[];
  /** Names of uploaded files (PDFs etc.) sent with this message */
  uploadedFileNames?: string[];
  /** Agent attribution for this message when routed via ACP or rendered by MindOS */
  agentId?: string;
  agentName?: string;
  agentKind?: AgentRuntimeKind;
}

export interface LocalAttachment {
  name: string;
  content: string;
  /** Extraction status for PDF uploads. Absent / undefined = legacy (treated as success). */
  status?: 'loading' | 'success' | 'error';
  /** Human-readable error message (only when status = 'error'). */
  error?: string;
  /** Present when the full text was too long and had to be truncated. */
  truncatedInfo?: {
    totalChars: number;
    includedChars: number;
    totalPages: number;
    warning?: string;
  };
}

/** User-facing Ask modes. 'organize' is internal-only (not selectable by users). */
export type AskMode = 'chat' | 'agent';

/** All Ask modes including internal ones sent to the API */
export type AskModeApi = AskMode | 'organize';

export interface ChatSession {
  id: string;
  title?: string;
  currentFile?: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  pinned?: boolean;
  /** Session-level ACP agent selection restored when the session becomes active */
  defaultAcpAgent?: AgentIdentity | null;
  /** Session-level agent runtime selection. Prefer this over defaultAcpAgent when present. */
  defaultAgentRuntime?: AgentRuntimeIdentity | null;
  /** External runtime session metadata for native runtimes such as Codex or Claude. */
  externalAgentBinding?: ExternalAgentBinding | null;
  /** Typed external runtime session metadata. Prefer this over externalAgentBinding. */
  runtimeSessionBinding?: RuntimeSessionBinding | null;
}
