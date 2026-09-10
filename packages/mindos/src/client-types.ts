/**
 * `@geminilight/mindos/client-types` — the types-only surface for client
 * shells (Web, Mobile, Desktop, browser extension).
 *
 * Every statement in this file must be `export type { … } from`. TypeScript
 * erases type-only re-exports, so `dist/client-types.js` compiles to a bare
 * `export {};` and a bundler (Metro, webpack) that resolves this subpath never
 * pulls the server/runtime modules the types are declared in. The root
 * contract test `tests/client-types-subpath-contract.test.ts` enforces this by
 * transpiling the file and asserting the output carries no imports.
 *
 * Add a type here when a client needs the wire shape of a product payload;
 * never redeclare the shape in `packages/web/lib/types.ts` or
 * `packages/mobile/lib/types.ts` (spec-client-types-and-sse-parsers).
 */

// ── Agent runtime registry / catalog ───────────────────────────────────────

export type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterCommandDiscovery,
  AgentRuntimeAdapterCommandSource,
  AgentRuntimeAdapterConfigurationOwner,
  AgentRuntimeAdapterConnectionKind,
  AgentRuntimeAdapterContract,
  AgentRuntimeAdapterDeclaredCommand,
  AgentRuntimeAdapterHealthMode,
  AgentRuntimeAdapterMetadata,
  AgentRuntimeAdapterOutputDiscovery,
  AgentRuntimeAgentModeCapabilities,
  AgentRuntimeAgentModeSupport,
  AgentRuntimeBridge,
  AgentRuntimeCapabilities,
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
  AgentRuntimeHarnessCapabilities,
  AgentRuntimeLifecycle,
  AgentRuntimeLifecycleSource,
  AgentRuntimeLifecycleStage,
  AgentRuntimeLifecycleStageDescriptor,
  AgentRuntimeLifecycleSupport,
  AgentRuntimeOwner,
  AgentRuntimePayload,
  AgentRuntimeRemoteMode,
  AgentRuntimeResolvedCommandSource,
  AgentRuntimeStatus,
  AgentRuntimeUnattendedSupport,
  AgentRuntimesPayload,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
  NativeRuntimeId,
} from './agent/runtime/registry.js';

export type {
  AgentRuntimeCatalogEntry,
  AgentRuntimeCatalogPayload,
  AgentRuntimeCatalogSummary,
  AgentRuntimeDiagnosticCheck,
  AgentRuntimeDiagnosticCheckStatus,
  AgentRuntimeDiagnosticSeverity,
  AgentRuntimeDiagnosticSource,
  AgentRuntimeDiagnostics,
} from './agent/runtime/catalog.js';

// ── Runtime projections served by /api/agent-runtimes/* ────────────────────

export type {
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
} from './server/handlers/runtime-readiness.js';

export type {
  AgentRuntimeAdapterCommandsProjection,
  AgentRuntimeAdapterConfigurationProjection,
  AgentRuntimeAdapterConnectionProjection,
  AgentRuntimeAdapterFacetStatus,
  AgentRuntimeAdapterHealthProjection,
  AgentRuntimeAdapterOutputProjection,
  AgentRuntimeAdapterProjection,
  AgentRuntimeAdapterProjectionReason,
  AgentRuntimeAdapterProjectionStatus,
  AgentRuntimeAdapterProjectionsPayload,
  AgentRuntimeAdapterProtocolProjection,
} from './server/handlers/runtime-adapter-projections.js';

export type {
  AgentRuntimeArtifactHandoffTarget,
  AgentRuntimeArtifactOutputKind,
  AgentRuntimeArtifactProjection,
  AgentRuntimeArtifactProjectionReason,
  AgentRuntimeArtifactProjectionStatus,
  AgentRuntimeArtifactProjectionsPayload,
} from './server/handlers/runtime-artifact-projections.js';

export type {
  AgentRuntimeSessionProjectionReason,
  AgentRuntimeSessionProjectionStatus,
  RuntimeSessionProjection,
  RuntimeSessionProjectionCommands,
  RuntimeSessionProjectionControl,
  RuntimeSessionProjectionMcpServers,
  RuntimeSessionProjectionPermissionEvents,
  RuntimeSessionProjectionToolEvents,
  RuntimeSessionProjectionsPayload,
} from './server/handlers/runtime-session-projections.js';

export type {
  RuntimeControlPlaneApprovalRequest,
  RuntimeControlPlaneApprovalStatus,
  RuntimeControlPlaneFailureAudit,
  RuntimeControlPlaneFailureKind,
  RuntimeControlPlaneMailboxMessage,
  RuntimeControlPlaneMailboxStatus,
  RuntimeControlPlaneOverlapPolicy,
  RuntimeControlPlanePermissionMode,
  RuntimeControlPlaneRetryPolicy,
  RuntimeControlPlaneSchedule,
  RuntimeControlPlaneScheduleStatus,
  RuntimeControlPlaneSnapshot,
  RuntimeControlPlaneTask,
  RuntimeControlPlaneTaskPriority,
  RuntimeControlPlaneTaskStatus,
  RuntimeControlPlaneTrigger,
  RuntimeControlPlaneTriggerType,
  RuntimeControlPlaneWakeEvent,
  RuntimeControlPlaneWakeStatus,
} from './server/handlers/runtime-control-plane.js';

// ── ACP wire types ─────────────────────────────────────────────────────────

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
} from './protocols/acp/types.js';

// ── Chat message model and agent-run timeline (stream consumer output) ─────

export type {
  AgentRunNodeKind,
  AgentRunStatus,
  AgentRunTimelineEvent,
  AgentRunTimelineEventCategory,
  AgentRunTimelineEventData,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  AgentRuntimeKind,
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
  RuntimePermissionRisk,
  RuntimePermissionState,
  RuntimeStatusPart,
  TextPart,
  ToolCallPart,
} from './agent/stream/stream-message-types.js';

export type { AgentRunPermissionMode } from './agent/ledger/run-ledger-types.js';

// ── Permission mode and agent-turn SSE event union ─────────────────────────

export type { MindosPermissionMode } from './agent/permission/types.js';

export type { MindOSSSEvent } from './agent/turn/index.js';
