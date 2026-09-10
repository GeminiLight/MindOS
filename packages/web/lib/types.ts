// Re-export core types as single source of truth
export type { FileNode, MindSystemNodeKey, SearchResult, BacklinkEntry } from './core/types';

// Chat message model — sunk into the core package (Wave 4,
// spec-agent-core-consolidation). Edit
// packages/mindos/src/agent/stream-message-types.ts instead of redefining
// these here. Read through the types-only subpath so this module never
// carries a runtime import of the core package.
import type {
  AgentRuntimeAdapterConnectionProjection,
  AgentRuntimeKind,
  Message,
} from '@geminilight/mindos/client-types';

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
} from '@geminilight/mindos/client-types';

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
// Product wire types (agent runtimes, runtime projections, control plane,
// ACP) come from the types-only core subpath. Do not redeclare them here:
// `lib/types.test-d.ts` asserts these re-exports are the core types and
// `tests/client-types-subpath-contract.test.ts` rejects local copies
// (spec-client-types-and-sse-parsers).
export type {
  AcpAdapterConnectionType,
  AcpAdapterOutputCapabilities,
  AcpAdapterOutputKind,
  AcpAgentCapabilities,
  AcpAuthMethod,
  AcpAvailableCommand,
  AcpClientCapabilities,
  AcpConfigOption,
  AcpConfigOptionEntry,
  AcpContentBlock,
  AcpMcpCapabilities,
  AcpMode,
  AcpPermissionEvent,
  AcpPermissionEventStatus,
  AcpPermissionOption,
  AcpPermissionOutcome,
  AcpPlan,
  AcpPlanEntry,
  AcpPlanEntryPriority,
  AcpPlanEntryStatus,
  AcpPromptCapabilities,
  AcpPromptResponse,
  AcpRegistry,
  AcpRegistryEntry,
  AcpSession,
  AcpSessionCapabilities,
  AcpSessionControlSnapshot,
  AcpSessionInfo,
  AcpSessionMcpServerSummary,
  AcpSessionSnapshot,
  AcpSessionSnapshotFactSource,
  AcpSessionState,
  AcpSessionToolSummary,
  AcpSessionUpdate,
  AcpStopReason,
  AcpToolCall,
  AcpToolCallFull,
  AcpToolCallKind,
  AcpToolCallStatus,
  AcpToolResult,
  AcpTransportType,
  AcpUpdateType,
  AgentRuntimeAdapter,
  AgentRuntimeAdapterCommandDiscovery,
  AgentRuntimeAdapterCommandSource,
  AgentRuntimeAdapterCommandsProjection,
  AgentRuntimeAdapterConfigurationOwner,
  AgentRuntimeAdapterConfigurationProjection,
  AgentRuntimeAdapterConnectionKind,
  AgentRuntimeAdapterConnectionProjection,
  AgentRuntimeAdapterContract,
  AgentRuntimeAdapterDeclaredCommand,
  AgentRuntimeAdapterFacetStatus,
  AgentRuntimeAdapterHealthMode,
  AgentRuntimeAdapterHealthProjection,
  AgentRuntimeAdapterOutputDiscovery,
  AgentRuntimeAdapterOutputProjection,
  AgentRuntimeAdapterProjection,
  AgentRuntimeAdapterProjectionReason,
  AgentRuntimeAdapterProjectionStatus,
  AgentRuntimeAdapterProjectionsPayload,
  AgentRuntimeAdapterProtocolProjection,
  AgentRuntimeArtifactHandoffTarget,
  AgentRuntimeArtifactOutputKind,
  AgentRuntimeArtifactProjection,
  AgentRuntimeArtifactProjectionReason,
  AgentRuntimeArtifactProjectionStatus,
  AgentRuntimeArtifactProjectionsPayload,
  AgentRuntimeBridge,
  AgentRuntimeCapabilities,
  AgentRuntimeCatalogEntry,
  AgentRuntimeCatalogPayload,
  AgentRuntimeCatalogSummary,
  AgentRuntimeCategory,
  AgentRuntimeCompatibilityAssessment,
  AgentRuntimeCompatibilityLevel,
  AgentRuntimeCompatibilityOwner,
  AgentRuntimeCompatibilityProfile,
  AgentRuntimeCompatibilityRequirement,
  AgentRuntimeCompatibilityRequirementStatus,
  AgentRuntimeCompatibilityScenario,
  AgentRuntimeCoordinationRole,
  AgentRuntimeDescriptor,
  AgentRuntimeDiagnosticCheck,
  AgentRuntimeDiagnosticCheckStatus,
  AgentRuntimeDiagnosticSeverity,
  AgentRuntimeDiagnosticSource,
  AgentRuntimeDiagnostics,
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeLifecycle,
  AgentRuntimeLifecycleSource,
  AgentRuntimeLifecycleStage,
  AgentRuntimeLifecycleStageDescriptor,
  AgentRuntimeLifecycleSupport,
  AgentRuntimeOwner,
  AgentRuntimePayload,
  AgentRuntimeReadinessGap,
  AgentRuntimeReadinessGapCategory,
  AgentRuntimeReadinessGapSeverity,
  AgentRuntimeReadinessPayload,
  AgentRuntimeReadinessProjection,
  AgentRuntimeReadinessRecommendation,
  AgentRuntimeReadinessRequirement,
  AgentRuntimeReadinessSource,
  AgentRuntimeReadinessStatus,
  AgentRuntimeReadinessUseCase,
  AgentRuntimeReadinessUseCaseId,
  AgentRuntimeRemoteMode,
  AgentRuntimeResolvedCommandSource,
  AgentRuntimeSessionProjectionReason,
  AgentRuntimeSessionProjectionStatus,
  AgentRuntimeStatus,
  AgentRuntimeUnattendedSupport,
  AgentRuntimesPayload,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
  RuntimeControlPlaneApprovalRequest,
  RuntimeControlPlaneApprovalStatus,
  RuntimeControlPlaneFailureAudit,
  RuntimeControlPlaneMailboxMessage,
  RuntimeControlPlaneMailboxStatus,
  RuntimeControlPlaneSchedule,
  RuntimeControlPlaneScheduleStatus,
  RuntimeControlPlaneSnapshot,
  RuntimeControlPlaneTask,
  RuntimeControlPlaneTaskStatus,
  RuntimeControlPlaneTriggerType,
  RuntimeControlPlaneWakeEvent,
  RuntimeControlPlaneWakeStatus,
  RuntimeSessionProjection,
  RuntimeSessionProjectionCommands,
  RuntimeSessionProjectionControl,
  RuntimeSessionProjectionMcpServers,
  RuntimeSessionProjectionPermissionEvents,
  RuntimeSessionProjectionToolEvents,
  RuntimeSessionProjectionsPayload,
} from '@geminilight/mindos/client-types';

/** Shared facet shape of the adapter projection; derived from the core type so it cannot drift. */
export type AgentRuntimeAdapterProjectionFacetBase = Pick<
  AgentRuntimeAdapterConnectionProjection,
  'status' | 'summary' | 'reasons' | 'blockers'
>;

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
  messageCount?: number;
  turnCount?: number;
  turns?: unknown[];
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
export type NativeRuntimeEffort = string;

export interface NativeRuntimeOptions {
  modelOverride?: string;
  reasoningEffort?: NativeRuntimeEffort;
}

export interface AcpRuntimeOptions {
  modeId?: string;
  configValues?: Record<string, string>;
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
