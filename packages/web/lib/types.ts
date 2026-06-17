// Re-export core types as single source of truth
export type { FileNode, MindSystemNodeKey, SearchResult, BacklinkEntry } from './core/types';

// Chat message model — sunk into the core package (Wave 4,
// spec-agent-core-consolidation). Edit
// packages/mindos/src/agent/stream-message-types.ts instead of redefining
// these here.
import type { AgentRuntimeKind, Message } from '@geminilight/mindos/agent/stream/stream-message-types';

export type {
  AgentRuntimeKind,
  AgentRunNodeKind,
  AgentRunStatus,
  AgentRunTimelineEvent,
  AgentRunTimelineEventCategory,
  AgentRunTimelineEventData,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  AskUserQuestion,
  AskUserQuestionAnswer,
  AskUserQuestionOption,
  AskUserQuestionState,
  ImageMimeType,
  ImagePart,
  Message,
  MessagePart,
  ReasoningPart,
  RuntimePermissionOption,
  RuntimePermissionState,
  RuntimeStatusPart,
  TextPart,
  ToolCallPart,
} from '@geminilight/mindos/agent/stream/stream-message-types';

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
  core?: {
    cacheState: string;
    fileCount: number;
  };
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

export interface AgentIdentity {
  id: string;
  name: string;
}

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
  | 'codex-sdk'
  | 'claude-cli'
  | 'claude-sdk'
  | 'acp';

export type AgentRuntimeCategory = 'mindos' | 'native' | 'acp' | 'cloud';

export interface AgentRuntimeHarnessCapabilities {
  session: 'none' | 'local-id' | 'native-thread' | 'cloud-task';
  eventStream: Array<'text' | 'tool-events' | 'thread-turn-item' | 'runtime-status' | 'permissions' | 'user-input'>;
  workspace: 'local-cwd' | 'local-worktree' | 'container' | 'cloud-vm';
  permissions: 'none' | 'mindos-only' | 'runtime-bridged';
  tools: Array<'shell' | 'file' | 'git' | 'browser' | 'mcp' | 'plugins' | 'skills'>;
  output: Array<'text' | 'diff' | 'checkpoint' | 'artifact' | 'branch' | 'pr'>;
}

export type AgentRuntimeOwner = 'mindos' | 'external';

export interface AgentRuntimeBridge {
  kind: 'codex-app-server' | 'claude-sdk' | 'claude-cli';
  label: string;
  fallback?: boolean;
  reason?: string;
}

export interface AgentRuntimeDescriptor extends AgentRuntimeIdentity {
  category?: AgentRuntimeCategory;
  runtimeId?: string;
  adapter: AgentRuntimeAdapter;
  modelOwner: AgentRuntimeOwner;
  authOwner: AgentRuntimeOwner;
  permissionOwner: AgentRuntimeOwner;
  sessionOwner: AgentRuntimeOwner;
  status: AgentRuntimeStatus;
  capabilities: AgentRuntimeCapabilities;
  harnessCapabilities?: AgentRuntimeHarnessCapabilities;
  runtimeBridge?: AgentRuntimeBridge;
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

export interface LocalAttachment {
  name: string;
  content: string;
  mimeType?: string;
  size?: number;
  /** Base64-encoded original file bytes, kept only in the active browser session. */
  dataBase64?: string;
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

/** User-facing Ask mode. Tool permissions are controlled separately. */
export type AskMode = 'agent';

/** All Ask modes including internal ones sent to the API */
export type AskModeApi = AskMode | 'organize';

/** Chat Panel permission preset shown in the composer controls. */
export type AskPermissionLevel = 'read' | 'ask' | 'auto' | 'full';

export type NativeRuntimePermissionMode = 'readonly' | 'agent';
export type NativeRuntimeEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface NativeRuntimeOptions {
  permissionMode?: NativeRuntimePermissionMode;
  modelOverride?: string;
  reasoningEffort?: NativeRuntimeEffort;
}

export interface ChatSession {
  id: string;
  title?: string;
  source?: 'quick' | 'project' | 'space' | 'file' | 'inbox' | 'external-runtime';
  projectId?: string;
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
