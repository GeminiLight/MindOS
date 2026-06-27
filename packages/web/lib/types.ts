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
  | 'adapter-projection'
  | 'session-projection'
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

export type AgentRuntimeReadinessUseCaseId =
  | AgentRuntimeCompatibilityScenario
  | 'adapter-contract'
  | 'session-controls';

export interface AgentRuntimeReadinessUseCase {
  id: AgentRuntimeReadinessUseCaseId;
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
  useCases: AgentRuntimeReadinessUseCaseId[];
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

export type AgentRuntimeAdapterConnectionKind =
  | 'internal'
  | 'stdio'
  | 'app-server'
  | 'sdk'
  | 'cli'
  | 'unknown';

export type AgentRuntimeAdapterConfigurationOwner =
  | 'mindos-session'
  | 'mindos-settings'
  | 'runtime-native'
  | 'adapter-declared'
  | 'unsupported'
  | 'unknown';

export type AgentRuntimeAdapterHealthMode =
  | 'mindos-native'
  | 'runtime-native'
  | 'adapter-declared'
  | 'unsupported'
  | 'unknown';

export type AgentRuntimeAdapterCommandDiscovery =
  | 'mindos-skills'
  | 'runtime-event'
  | 'adapter-declared'
  | 'unsupported'
  | 'unknown';

export type AgentRuntimeAdapterOutputDiscovery =
  | 'mindos-default'
  | 'runtime-native'
  | 'adapter-declared'
  | 'unknown';

export type AgentRuntimeAdapterCommandSource =
  | 'mindos'
  | 'runtime-native'
  | 'adapter-declared';

export type AgentRuntimeResolvedCommandSource = 'user-override' | 'descriptor' | 'registry';
export type AgentRuntimeDiagnosticSource =
  | 'settings'
  | 'runtime-registry'
  | 'runtime-catalog'
  | 'native-health'
  | 'acp-detect'
  | 'acp-registry'
  | 'mcp-agents'
  | 'env-path'
  | 'user-override'
  | 'extension-manifest'
  | 'turn-runner'
  | 'runtime-bridge'
  | 'codex-app-server'
  | 'claude-bridge'
  | 'acp-session'
  | 'mindos-pi-session'
  | 'run-ledger';
export type AgentRuntimeDiagnosticSeverity = 'info' | 'warning' | 'error';
export type AgentRuntimeDiagnosticCheckStatus = 'passed' | 'warning' | 'failed' | 'skipped' | 'unknown';
export type AcpAdapterConnectionType = 'stdio' | 'cli' | 'http' | 'sse';

export interface AcpPromptCapabilities {
  audio?: boolean;
  embeddedContext?: boolean;
  image?: boolean;
}

export interface AcpMcpCapabilities {
  stdio?: boolean;
  http?: boolean;
  sse?: boolean;
}

export interface AcpSessionCapabilities {
  list?: boolean;
  resume?: boolean;
  fork?: boolean;
  close?: boolean;
}

export interface AcpAgentCapabilities {
  loadSession?: boolean;
  mcpCapabilities?: AcpMcpCapabilities;
  promptCapabilities?: AcpPromptCapabilities;
  sessionCapabilities?: AcpSessionCapabilities;
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

export interface AcpAvailableCommand {
  id: string;
  name: string;
  description?: string;
}

export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AcpToolCallFull {
  toolCallId: string;
  title?: string;
  kind?: string;
  status: AcpToolCallStatus;
  rawInput?: string;
  rawOutput?: string;
  content?: unknown[];
  locations?: { path: string; line?: number }[];
}

export type AcpPermissionEventStatus = 'pending' | 'resolved';
export type AcpPermissionOutcome = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface AcpPermissionOption {
  id: string;
  label: string;
  kind: AcpPermissionOutcome;
}

export interface AcpPermissionEvent {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  status: AcpPermissionEventStatus;
  options: AcpPermissionOption[];
  selectedOptionId?: string;
  outcome?: AcpPermissionOutcome | 'cancelled';
  requestedAt: string;
  resolvedAt?: string;
}

export interface AcpSessionMcpServerSummary {
  name: string;
  type: 'stdio' | 'http' | 'sse';
}

export interface AcpSessionControlSnapshot {
  status: 'available' | 'unavailable';
  source: 'declared' | 'observed' | 'inferred' | 'unavailable';
  configId?: string;
  currentValue?: string;
  options: AcpConfigOptionEntry[];
}

export interface AcpSessionSnapshot {
  schemaVersion: 1;
  sessionId: string;
  agentId: string;
  agentSessionId?: string;
  state: 'idle' | 'active' | 'error';
  cwd?: string;
  createdAt: string;
  lastActivityAt: string;
  agentCapabilities?: AcpAgentCapabilities;
  authMethods: Array<{ id: string; name: string; description?: string }>;
  modes: Array<{ id: string; name: string; description?: string }>;
  currentModeId?: string;
  configOptions: AcpConfigOption[];
  controls: {
    model: AcpSessionControlSnapshot;
    mode: AcpSessionControlSnapshot;
    thoughtLevel: AcpSessionControlSnapshot;
  };
  availableCommands: AcpAvailableCommand[];
  toolCalls: AcpToolCallFull[];
  toolSummary: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
  permissionEvents: AcpPermissionEvent[];
  pendingPermissions: AcpPermissionEvent[];
  sessionInfo?: { title?: string; updatedAt?: string };
  mcpServers: AcpSessionMcpServerSummary[];
}

export interface AgentRuntimeAdapterDeclaredCommand {
  name: string;
  description?: string;
  source: AgentRuntimeAdapterCommandSource;
}

export interface AgentRuntimeAdapterContract {
  schemaVersion: 1;
  connection: {
    kind: AgentRuntimeAdapterConnectionKind;
    owner: AgentRuntimeOwner;
    summary: string;
    command?: string;
    commandSource?: AgentRuntimeResolvedCommandSource;
  };
  configuration: {
    modelSelection: AgentRuntimeAdapterConfigurationOwner;
    credentials: AgentRuntimeAdapterConfigurationOwner;
    settings: AgentRuntimeAdapterConfigurationOwner;
    summary: string;
  };
  health: {
    mode: AgentRuntimeAdapterHealthMode;
    owner: AgentRuntimeOwner;
    summary: string;
    command?: string;
    timeoutMs?: number;
  };
  commands: {
    discovery: AgentRuntimeAdapterCommandDiscovery;
    commands: AgentRuntimeAdapterDeclaredCommand[];
    summary: string;
  };
  output: {
    discovery: AgentRuntimeAdapterOutputDiscovery;
    outputKinds: AgentRuntimeHarnessCapabilities['output'];
    reviewableOutputKinds: AgentRuntimeHarnessCapabilities['output'];
    supportsFileChanges: boolean;
    supportsArtifacts: boolean;
    supportsCheckpoints: boolean;
    supportsBranches: boolean;
    supportsPullRequests: boolean;
    summary: string;
  };
  protocol: {
    declaredConnectionType?: AcpAdapterConnectionType;
    supportsStreaming: boolean | null;
    authRequired: boolean | null;
    modelCount: number;
    models: Array<{
      id: string;
      label?: string;
      description?: string;
    }>;
    promptCapabilities?: AcpPromptCapabilities;
    mcpCapabilities?: AcpMcpCapabilities;
    sessionCapabilities?: AcpSessionCapabilities & {
      loadSession?: boolean;
    };
    summary: string;
  };
}

export type AgentRuntimeAdapterProjectionStatus = 'ready' | 'limited' | 'blocked' | 'unknown';
export type AgentRuntimeAdapterFacetStatus = 'ready' | 'limited' | 'blocked' | 'unknown';

export interface AgentRuntimeAdapterProjectionReason {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
}

export interface AgentRuntimeAdapterProjectionFacetBase {
  status: AgentRuntimeAdapterFacetStatus;
  summary: string;
  reasons: AgentRuntimeAdapterProjectionReason[];
  blockers?: string[];
}

export interface AgentRuntimeAdapterConnectionProjection extends AgentRuntimeAdapterProjectionFacetBase {
  kind: AgentRuntimeAdapterConnectionKind;
  owner: AgentRuntimeOwner;
  hasCommand: boolean;
  commandSource?: AgentRuntimeResolvedCommandSource;
}

export interface AgentRuntimeAdapterConfigurationProjection extends AgentRuntimeAdapterProjectionFacetBase {
  modelSelection: AgentRuntimeAdapterConfigurationOwner;
  credentials: AgentRuntimeAdapterConfigurationOwner;
  settings: AgentRuntimeAdapterConfigurationOwner;
}

export interface AgentRuntimeAdapterHealthProjection extends AgentRuntimeAdapterProjectionFacetBase {
  mode: AgentRuntimeAdapterHealthMode;
  owner: AgentRuntimeOwner;
  hasCommand: boolean;
  timeoutMs?: number;
}

export interface AgentRuntimeAdapterCommandsProjection extends AgentRuntimeAdapterProjectionFacetBase {
  discovery: AgentRuntimeAdapterCommandDiscovery;
  commandCount: number;
  commandNames: string[];
  commands: AgentRuntimeAdapterDeclaredCommand[];
}

export interface AgentRuntimeAdapterOutputProjection extends AgentRuntimeAdapterProjectionFacetBase {
  discovery: AgentRuntimeAdapterOutputDiscovery;
  outputKinds: AgentRuntimeHarnessCapabilities['output'];
  reviewableOutputKinds: AgentRuntimeHarnessCapabilities['output'];
  supportsFileChanges: boolean;
  supportsArtifacts: boolean;
  supportsCheckpoints: boolean;
  supportsBranches: boolean;
  supportsPullRequests: boolean;
}

export interface AgentRuntimeAdapterProtocolProjection extends AgentRuntimeAdapterProjectionFacetBase {
  declaredConnectionType?: AcpAdapterConnectionType;
  supportsStreaming: boolean | null;
  authRequired: boolean | null;
  modelCount: number;
  models: Array<{
    id: string;
    label?: string;
    description?: string;
  }>;
  promptCapabilities?: AcpPromptCapabilities;
  mcpCapabilities?: AcpMcpCapabilities;
  sessionCapabilities?: AcpSessionCapabilities & {
    loadSession?: boolean;
  };
}

export interface AgentRuntimeAdapterProjection {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  status: AgentRuntimeAdapterProjectionStatus;
  connection: AgentRuntimeAdapterConnectionProjection;
  configuration: AgentRuntimeAdapterConfigurationProjection;
  health: AgentRuntimeAdapterHealthProjection;
  commands: AgentRuntimeAdapterCommandsProjection;
  output: AgentRuntimeAdapterOutputProjection;
  protocol: AgentRuntimeAdapterProtocolProjection;
  reasons: AgentRuntimeAdapterProjectionReason[];
  blockers?: string[];
}

export interface AgentRuntimeDiagnosticCheck {
  id: string;
  label: string;
  status: AgentRuntimeDiagnosticCheckStatus;
  severity: AgentRuntimeDiagnosticSeverity;
  source: AgentRuntimeDiagnosticSource;
  summary: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

export interface AgentRuntimeDiagnostics {
  schemaVersion: 1;
  checkedAt: string;
  status: AgentRuntimeStatus;
  sources: AgentRuntimeDiagnosticSource[];
  summary: string;
  reason?: string;
  hints: string[];
  selectedCommand?: {
    cmd: string;
    args: string[];
    source: AgentRuntimeResolvedCommandSource;
  };
  binaryPath?: string;
  checks: AgentRuntimeDiagnosticCheck[];
  stale?: boolean;
}

export interface AgentRuntimeCatalogEntry {
  schemaVersion: 1;
  id: string;
  runtimeId: string;
  name: string;
  kind: AgentRuntimeKind;
  category: AgentRuntimeCategory;
  status: AgentRuntimeStatus;
  adapter: AgentRuntimeAdapter;
  sourceAgentId?: string;
  canonicalAgentId?: string;
  aliases: string[];
  owners: {
    model: AgentRuntimeOwner;
    auth: AgentRuntimeOwner;
    permission: AgentRuntimeOwner;
    session: AgentRuntimeOwner;
  };
  capabilitySummary: {
    session: AgentRuntimeHarnessCapabilities['session'] | 'unknown';
    commandDiscovery: AgentRuntimeAdapterCommandDiscovery;
    modelSelection: AgentRuntimeAdapterConfigurationOwner;
    mcpConfig: {
      supportsDescriptorConfig: boolean;
      declaredCapabilities?: AcpMcpCapabilities;
    };
    output: AgentRuntimeHarnessCapabilities['output'];
    eventStream: AgentRuntimeHarnessCapabilities['eventStream'];
    remoteMode: AgentRuntimeRemoteMode;
    unattended: AgentRuntimeUnattendedSupport;
    coordinationRole: AgentRuntimeCoordinationRole;
  };
  install?: {
    command: string;
    packageName?: string;
  };
  mcpAgentKey?: string;
  binaryPath?: string;
  resolvedCommand?: AgentRuntimeDescriptor['resolvedCommand'];
  diagnostics: AgentRuntimeDiagnostics;
}

export interface AgentRuntimeCatalogSummary {
  total: number;
  available: number;
  missing: number;
  signedOut: number;
  error: number;
  categories: Record<AgentRuntimeCategory, number>;
}

export interface AgentRuntimeCatalogPayload {
  schemaVersion: 1;
  generatedAt: string;
  summary: AgentRuntimeCatalogSummary;
  entries: AgentRuntimeCatalogEntry[];
}

export interface AgentRuntimeAdapterProjectionsPayload {
  schemaVersion: 1;
  projections: AgentRuntimeAdapterProjection[];
}

export type RuntimeControlPlaneTriggerType = 'manual' | 'cron' | 'interval' | 'event';
export type RuntimeControlPlaneScheduleStatus = 'disabled' | 'enabled' | 'paused' | 'archived';
export type RuntimeControlPlaneApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type RuntimeControlPlaneWakeStatus = 'pending' | 'claimed' | 'completed' | 'missed';
export type RuntimeControlPlaneMailboxStatus = 'queued' | 'delivered' | 'archived';
export type RuntimeControlPlaneTaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled';

export interface RuntimeControlPlaneSchedule {
  id: string;
  title: string;
  runtimeId: string;
  status: RuntimeControlPlaneScheduleStatus;
  trigger: {
    type: RuntimeControlPlaneTriggerType;
    cron?: string;
    intervalMs?: number;
    event?: string;
    timezone?: string;
  };
  target: {
    assistantId?: string;
    command?: string;
    skillId?: string;
    cwdHint?: string;
  };
  policy: {
    permissionMode: 'read' | 'ask' | 'auto';
    overlap: 'skip' | 'enqueue' | 'cancel-previous';
    retry: 'never' | 'once';
    timeoutMs: number;
  };
  inputSummary?: string;
  nextRunAt?: string;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeControlPlaneApprovalRequest {
  id: string;
  runtimeId: string;
  runId?: string;
  scheduleId?: string;
  status: RuntimeControlPlaneApprovalStatus;
  scope: 'read' | 'write' | 'shell' | 'network' | 'mcp' | 'schedule' | 'user-extension' | 'unknown';
  summary: string;
  requestedAt: string;
  resolvedAt?: string;
  decision?: 'approve' | 'reject' | 'cancel';
}

export interface RuntimeControlPlaneWakeEvent {
  id: string;
  runtimeId?: string;
  scheduleId?: string;
  runId?: string;
  status: RuntimeControlPlaneWakeStatus;
  triggerAt: string;
  claimedAt?: string;
  completedAt?: string;
  summary?: string;
}

export interface RuntimeControlPlaneFailureAudit {
  id: string;
  runtimeId?: string;
  scheduleId?: string;
  runId?: string;
  kind: 'runtime' | 'permission' | 'tool' | 'timeout' | 'conflict' | 'unknown';
  summary: string;
  recoverable: boolean;
  createdAt: string;
}

export interface RuntimeControlPlaneMailboxMessage {
  id: string;
  fromRuntimeId?: string;
  toRuntimeId?: string;
  threadId?: string;
  status: RuntimeControlPlaneMailboxStatus;
  subject: string;
  summary: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface RuntimeControlPlaneTask {
  id: string;
  title: string;
  status: RuntimeControlPlaneTaskStatus;
  priority: 'low' | 'normal' | 'high';
  assigneeRuntimeId?: string;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeControlPlaneSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  schedules: RuntimeControlPlaneSchedule[];
  approvalQueue: RuntimeControlPlaneApprovalRequest[];
  wakeEvents: RuntimeControlPlaneWakeEvent[];
  failureAudits: RuntimeControlPlaneFailureAudit[];
  mailbox: RuntimeControlPlaneMailboxMessage[];
  tasks: RuntimeControlPlaneTask[];
  summary: {
    scheduleCount: number;
    enabledScheduleCount: number;
    pendingApprovalCount: number;
    pendingWakeCount: number;
    openTaskCount: number;
    queuedMessageCount: number;
  };
}

export type AgentRuntimeArtifactProjectionStatus = 'ready' | 'limited' | 'blocked' | 'unknown';
export type AgentRuntimeArtifactOutputKind = AgentRuntimeHarnessCapabilities['output'][number];
export type AgentRuntimeArtifactHandoffTarget =
  | 'message'
  | 'diff'
  | 'checkpoint'
  | 'artifact'
  | 'branch'
  | 'pull-request';

export interface AgentRuntimeArtifactProjectionReason {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
}

export interface AgentRuntimeArtifactProjection {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  status: AgentRuntimeArtifactProjectionStatus;
  outputKinds: AgentRuntimeArtifactOutputKind[];
  reviewableOutputKinds: AgentRuntimeArtifactOutputKind[];
  nativeHandoffTargets: AgentRuntimeArtifactHandoffTarget[];
  nativeReview: {
    supported: boolean;
    summary: string;
  };
  artifactIndex: {
    supported: boolean;
    status: 'ready' | 'missing' | 'unknown';
    owner: 'mindos';
    summary: string;
    recordCount: number;
    recentArtifacts: Array<{
      id: string;
      kind: 'file' | 'image' | 'diff' | 'patch' | 'checkpoint' | 'branch' | 'pr' | 'uri' | 'unknown';
      source: 'acp-tool-call' | 'runtime-output' | 'manual';
      status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'unknown';
      runId?: string;
      toolCallId?: string;
      toolName?: string;
      path?: string;
      line?: number;
      uri?: string;
      title?: string;
      summary?: string;
      mimeType?: string;
      size?: number;
      updatedAt: number;
    }>;
  };
  rollback: {
    supported: boolean;
    source: 'runtime-checkpoint' | 'none' | 'unknown';
    summary: string;
  };
  branchPr: {
    supported: boolean;
    summary: string;
  };
  reasons: AgentRuntimeArtifactProjectionReason[];
  blockers?: string[];
}

export interface AgentRuntimeArtifactProjectionsPayload {
  schemaVersion: 1;
  projections: AgentRuntimeArtifactProjection[];
}

export type AgentRuntimeSessionProjectionStatus = 'ready' | 'active' | 'idle' | 'limited' | 'blocked' | 'unknown';

export interface AgentRuntimeSessionProjectionReason {
  id: string;
  status: AgentRuntimeCompatibilityRequirementStatus;
  owner: AgentRuntimeCompatibilityOwner;
  summary: string;
}

export interface RuntimeSessionProjectionControl {
  status: 'available' | 'unavailable';
  owner: AgentRuntimeOwner;
  source: 'session-observed' | 'adapter-declared' | 'runtime-native' | 'mindos-session' | 'unavailable';
  configId?: string;
  currentValue?: string;
  options: AcpConfigOptionEntry[];
  summary: string;
}

export interface RuntimeSessionProjectionCommands {
  status: 'available' | 'unavailable';
  source: 'session-observed' | 'adapter-declared' | 'runtime-native' | 'mindos-skills' | 'unavailable';
  commands: AcpAvailableCommand[];
  summary: string;
}

export interface RuntimeSessionProjectionToolEvents {
  status: 'available' | 'unavailable';
  calls: AcpToolCallFull[];
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
}

export interface RuntimeSessionProjectionPermissionEvents {
  status: 'available' | 'unavailable';
  events: AcpPermissionEvent[];
  pending: AcpPermissionEvent[];
  summary: string;
}

export interface RuntimeSessionProjectionMcpServers {
  status: 'available' | 'unavailable';
  servers: AcpSessionMcpServerSummary[];
  summary: string;
}

export interface RuntimeSessionProjection {
  schemaVersion: 1;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeStatus: AgentRuntimeStatus;
  sessionOwner: AgentRuntimeOwner;
  permissionOwner: AgentRuntimeOwner;
  status: AgentRuntimeSessionProjectionStatus;
  source: 'acp-session-snapshot' | 'runtime-descriptor' | 'none';
  session?: {
    kind: 'acp-session' | 'native-runtime-session' | 'mindos-pi-session';
    sessionId?: string;
    externalSessionId?: string;
    state?: string;
    cwd?: string;
    updatedAt?: string;
  };
  controls: {
    model: RuntimeSessionProjectionControl;
    mode: RuntimeSessionProjectionControl;
    thoughtLevel: RuntimeSessionProjectionControl;
  };
  slashCommands: RuntimeSessionProjectionCommands;
  toolEvents: RuntimeSessionProjectionToolEvents;
  permissionEvents: RuntimeSessionProjectionPermissionEvents;
  mcpServers: RuntimeSessionProjectionMcpServers;
  reasons: AgentRuntimeSessionProjectionReason[];
  blockers?: string[];
}

export interface RuntimeSessionProjectionsPayload {
  schemaVersion: 1;
  projections: RuntimeSessionProjection[];
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
  adapterContract: AgentRuntimeAdapterContract;
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
    source: AgentRuntimeResolvedCommandSource;
  };
  installCmd?: string;
  packageName?: string;
  availability?: {
    checkedAt: string;
    sources: AgentRuntimeDiagnosticSource[];
    reason?: string;
    diagnosticHints?: string[];
    stale?: boolean;
  };
  diagnostics?: AgentRuntimeDiagnostics;
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
