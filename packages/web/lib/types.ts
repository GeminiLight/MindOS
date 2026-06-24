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

export type AgentRuntimeLifecycleStage =
  | 'detect'
  | 'health'
  | 'configure'
  | 'launch'
  | 'session'
  | 'context'
  | 'execute'
  | 'interrupt'
  | 'archive'
  | 'remote'
  | 'coordinate';

export type AgentRuntimeLifecycleSupport = 'owned' | 'delegated' | 'unsupported' | 'unknown';

export type AgentRuntimeLifecycleSource =
  | 'settings'
  | 'runtime-registry'
  | 'native-health'
  | 'acp-detect'
  | 'acp-registry'
  | 'turn-runner'
  | 'runtime-bridge'
  | 'codex-app-server'
  | 'claude-bridge'
  | 'acp-session'
  | 'mindos-pi-session'
  | 'run-ledger';

export interface AgentRuntimeLifecycleStageDescriptor {
  support: AgentRuntimeLifecycleSupport;
  owner: AgentRuntimeOwner;
  summary: string;
  required?: boolean;
  sources?: AgentRuntimeLifecycleSource[];
  diagnosticHints?: string[];
}

export type AgentRuntimeRemoteMode = 'local-only' | 'server-runnable' | 'external-runtime' | 'cloud-task' | 'unknown';
export type AgentRuntimeUnattendedSupport = 'supported' | 'limited' | 'unsupported' | 'unknown';
export type AgentRuntimeCoordinationRole = 'primary' | 'external-worker' | 'subagent-capable' | 'unknown';

export interface AgentRuntimeLifecycle {
  schemaVersion: 1;
  stages: Record<AgentRuntimeLifecycleStage, AgentRuntimeLifecycleStageDescriptor>;
  remote: {
    supported: boolean;
    mode: AgentRuntimeRemoteMode;
    unattended: AgentRuntimeUnattendedSupport;
    summary: string;
  };
  coordination: {
    role: AgentRuntimeCoordinationRole;
    supportsSharedContext: boolean;
    supportsMailbox: boolean;
    supportsTaskBoard: boolean;
    summary: string;
  };
}

export type AgentRuntimeCompatibilityLevel = 'ready' | 'limited' | 'blocked' | 'unknown';
export type AgentRuntimeCompatibilityOwner = AgentRuntimeOwner | 'shared';

export type AgentRuntimeCompatibilityScenario =
  | 'interactive-turn'
  | 'coding-workflow'
  | 'session-continuity'
  | 'context-governance'
  | 'permission-governance'
  | 'mcp-tooling'
  | 'skill-execution'
  | 'artifact-governance'
  | 'remote-control'
  | 'unattended-automation'
  | 'team-coordination';

export type AgentRuntimeCompatibilityRequirementStatus =
  | 'satisfied'
  | 'external'
  | 'missing'
  | 'unknown'
  | 'not-applicable';

export interface AgentRuntimeCompatibilityRequirement {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
}

export interface AgentRuntimeCompatibilityAssessment {
  level: AgentRuntimeCompatibilityLevel;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
  requirements: AgentRuntimeCompatibilityRequirement[];
  blockers?: string[];
}

export interface AgentRuntimeCompatibilityProfile {
  schemaVersion: 1;
  scenarios: Record<AgentRuntimeCompatibilityScenario, AgentRuntimeCompatibilityAssessment>;
  summary: string;
}

export type AgentRuntimeReadinessStatus = 'ready' | 'usable' | 'limited' | 'blocked' | 'unknown';
export type AgentRuntimeReadinessSource =
  | 'compatibility-profile'
  | 'permission-projection'
  | 'mcp-projection'
  | 'artifact-projection'
  | 'automation-projection';
export type AgentRuntimeReadinessGapCategory =
  | 'mindos-product'
  | 'runtime-native'
  | 'adapter-contract'
  | 'deployment'
  | 'user-setup'
  | 'shared';
export type AgentRuntimeReadinessGapSeverity = 'info' | 'warning' | 'blocking';

export interface AgentRuntimeReadinessRequirement {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
}

export interface AgentRuntimeReadinessUseCase {
  id: AgentRuntimeCompatibilityScenario;
  label: string;
  status: AgentRuntimeReadinessStatus;
  source: AgentRuntimeReadinessSource;
  sourceStatus: string;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
  requirements: AgentRuntimeReadinessRequirement[];
  blockers?: string[];
  details?: Record<string, unknown>;
}

export interface AgentRuntimeReadinessRecommendation {
  useCase: AgentRuntimeCompatibilityScenario;
  confidence: 'strong' | 'conditional';
  summary: string;
}

export interface AgentRuntimeReadinessGap {
  id: string;
  category: AgentRuntimeReadinessGapCategory;
  severity: AgentRuntimeReadinessGapSeverity;
  summary: string;
  useCases: AgentRuntimeCompatibilityScenario[];
}

export interface AgentRuntimeReadinessProjection {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  overallStatus: AgentRuntimeReadinessStatus;
  summary: string;
  recommendations: AgentRuntimeReadinessRecommendation[];
  useCases: AgentRuntimeReadinessUseCase[];
  gaps: AgentRuntimeReadinessGap[];
  blockers?: string[];
}

export interface AgentRuntimeReadinessPayload {
  schemaVersion: 1;
  requestedPermissionMode: AgentPermissionMode;
  projections: AgentRuntimeReadinessProjection[];
}

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
  lifecycle: AgentRuntimeLifecycle;
  compatibility: AgentRuntimeCompatibilityProfile;
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

export type RuntimeSessionKind = 'mindos-pi-session' | 'codex-thread' | 'claude-session' | 'acp-session';

export interface RuntimeSessionBinding {
  kind: RuntimeSessionKind;
  runtime: AgentRuntimeKind;
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

/** Per-turn agent behavior selected by the product layer. */
export type AgentMode = 'default' | 'plan' | 'goal';

/** Per-turn permission preset shown in the composer controls. */
export type AgentPermissionMode = 'read' | 'ask' | 'auto' | 'full';
export type NativeRuntimeEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface NativeRuntimeOptions {
  modelOverride?: string;
  reasoningEffort?: NativeRuntimeEffort;
}

export type SessionWorkDirSource = 'mind-root' | 'project-default' | 'runtime-binding' | 'manual';

export interface SessionWorkDir {
  path?: string;
  label?: string;
  source: SessionWorkDirSource;
  updatedAt?: number;
}

export interface ContextSpaceRef {
  path: string;
  label?: string;
  icon?: string;
  source?: 'filesystem' | 'project-default' | 'manual';
}

export interface ContextAssistantRef {
  id: string;
  name?: string;
  kind?: 'assistant' | 'agent' | 'skill' | 'team';
  source?: 'local-assistant' | 'builtin' | 'project-default' | 'manual';
}

export interface SessionContextSelection {
  version: 1;
  spaces: ContextSpaceRef[];
  assistants: ContextAssistantRef[];
  updatedAt?: number;
}

export interface SessionModelSelection {
  version: 1;
  /** Session-level MindOS provider override. Missing means inherit the global default provider. */
  providerOverride?: string;
  /** Session-level MindOS model override. Missing means use the provider's default model. */
  modelOverride?: string;
  updatedAt?: number;
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
  /** Session-bound execution cwd. Dynamic Spaces/Assistants live in contextSelection instead. */
  workDir?: SessionWorkDir;
  /** Dynamic context hints for this chat session. */
  contextSelection?: SessionContextSelection;
  /** Session-scoped MindOS provider/model choice restored when this chat becomes active. */
  modelSelection?: SessionModelSelection;
}
