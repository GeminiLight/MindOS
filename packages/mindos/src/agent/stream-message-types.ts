// Sunk from packages/web/lib/types.ts (Wave 4, spec-agent-core-consolidation).
//
// The UI-facing chat message model produced by consuming runtime streams
// (stream-consumer.ts): structured assistant message parts (text, reasoning,
// tool calls, runtime status, agent-run timeline) plus the interactive
// states carried on tool calls (AskUserQuestion, runtime permission
// requests). This is the output contract of the stream consumer and the
// foundation for the AgentRuntimeAdapter unification — hosts (web, future
// CLI ask --local) render these parts; they do not redefine them.
//
// Pure types, browser-safe. Timeline shapes reuse the run-ledger contract
// (run-ledger-types.ts) instead of duplicating it.

import type {
  AgentEvent,
  AgentEventCategory,
  AgentEventData,
  AgentNodeKind,
  AgentRunRecord,
  AgentRunStatus,
} from './run-ledger-types.js';

export type { AgentRunStatus } from './run-ledger-types.js';

/** Runtimes a message part can be attributed to. */
export type AgentRuntimeKind = 'mindos' | 'acp' | 'codex' | 'claude';

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

// ─── Agent-run timeline (frontend wire mirror of the run ledger) ────────────

export type AgentRunNodeKind = AgentNodeKind;

/** Wire shape of a ledger run record as rendered in the chat timeline. */
export type AgentRunTimelineRecord = Omit<AgentRunRecord, 'archive'>;

export type AgentRunTimelineEventCategory = AgentEventCategory;

export type AgentRunTimelineEventData = AgentEventData;

/**
 * Wire shape of a ledger event in the chat timeline. `type` is loose on
 * purpose — the frontend renders by `category`/`data.kind` and must not
 * break when the ledger taxonomy grows.
 */
export interface AgentRunTimelineEvent extends Omit<AgentEvent, 'type' | 'record'> {
  type: string;
  record: AgentRunTimelineRecord;
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
