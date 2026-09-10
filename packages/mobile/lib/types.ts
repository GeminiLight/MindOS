/**
 * Shared types for MindOS mobile app.
 *
 * Product wire types (agent runtimes, agent-run timeline) come from the
 * types-only core subpath `@geminilight/mindos/client-types`; only
 * `import type` is allowed so Metro never bundles the product package
 * (spec-client-types-and-sse-parsers, `tests/client-types-subpath-contract`).
 * Mobile-specific shapes (Message, pending actions, API responses) stay here.
 */

import type {
  AgentRuntimeAdapter,
  AgentRuntimeDescriptor as CoreAgentRuntimeDescriptor,
  AgentRuntimeKind,
  AgentRuntimeStatus,
  AgentRunTimelineEvent,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
} from '@geminilight/mindos/client-types';

export type {
  AgentRunNodeKind,
  AgentRunPermissionMode,
  AgentRunStatus,
  AgentRunTimelineEvent,
  AgentRunTimelineEventCategory,
  AgentRunTimelineEventData,
  AgentRunTimelinePart,
  AgentRunTimelineRecord,
  AgentRuntimeAdapter,
  AgentRuntimeKind,
  AgentRuntimeStatus,
  DetectedRuntimeAgent,
  MissingRuntimeAgent,
} from '@geminilight/mindos/client-types';

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

export type ComposerIntent = 'chat' | 'act';

export interface AgentRuntimeIdentity {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
}

/**
 * The subset of the core runtime descriptor that mobile renders. Derived from
 * the core type so field types cannot drift; `lib/types.test-d.ts` asserts
 * every core descriptor is assignable to this view. `adapter` stays optional
 * because the local MindOS placeholder runtime does not declare one.
 */
export type AgentRuntimeDescriptor = Pick<
  CoreAgentRuntimeDescriptor,
  'id' | 'name' | 'kind' | 'status' | 'binaryPath' | 'installCmd' | 'packageName' | 'runtimeBridge' | 'availability'
> & {
  adapter?: AgentRuntimeAdapter;
};

/** `/api/agent-runtimes` as normalized by `api-client.ts`; `installed` / `notInstalled` are the core shapes. */
export interface AgentRuntimesResponse {
  runtimes: AgentRuntimeDescriptor[];
  installed?: DetectedRuntimeAgent[];
  notInstalled?: MissingRuntimeAgent[];
}

export interface AgentRunsResponse {
  runs: AgentRunTimelineRecord[];
  events: AgentRunTimelineEvent[];
  observatory?: {
    traces: Array<{
      id: string;
      rootRunId?: string;
      capsule?: AgentRunCapsuleProjection;
    }>;
  };
}

export type AgentRunCapsuleRecoveryAction = 'retry' | 'fork' | 'resume' | 'rollback';

export interface AgentRunCapsuleRecoveryCapability {
  supported: boolean;
  mode?: 'from-start' | 'new-session';
  sessionId?: string;
  checkpointArtifactId?: string;
  reason?: string;
}

export interface AgentRunCapsuleProjection {
  id: string;
  recovery: Record<AgentRunCapsuleRecoveryAction, AgentRunCapsuleRecoveryCapability>;
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

export interface PendingRuntimePermission extends Omit<RuntimePermissionRequest, 'type'> {
  kind: 'runtime-permission';
  action: string;
  risk: {
    level: 'low' | 'medium' | 'high';
    summary: string;
    reasons?: string[];
  };
  createdAt: number;
  expiresAt: number;
}

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionQuestion {
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

export interface PendingAskUserQuestion {
  kind: 'user-question';
  runId: string;
  toolCallId: string;
  questions: AskUserQuestionQuestion[];
  createdAt: number;
  expiresAt: number;
}

export interface PendingAutomationApproval {
  kind: 'automation-approval';
  approvalId: string;
  jobId: string;
  runId?: string;
  jobTitle: string;
  runtime: 'codex' | 'claude';
  toolName: string;
  action?: string;
  resource?: string;
  inputPreview?: string;
  risk?: {
    level: 'low' | 'medium' | 'high';
    summary: string;
  };
  createdAt: number;
}

export interface PendingAgentActionsResponse {
  permissions: PendingRuntimePermission[];
  questions: PendingAskUserQuestion[];
  automationApprovals: PendingAutomationApproval[];
  pendingCount: number;
  generatedAt: number;
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
  rootId?: string;
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
