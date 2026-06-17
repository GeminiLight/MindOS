/**
 * Agent run ledger contract: run records, event taxonomy, and the input
 * shapes used to start/update/complete runs. Pure types — the ledger
 * implementation itself sinks from the web package in a later wave, but the
 * contract lives here so policy/reducer modules (and external consumers)
 * never depend on the web package.
 */

export type AgentNodeKind =
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

/**
 * Pointer to the runtime's own conversation archive. Each runtime keeps its
 * own full transcript (Claude Code under ~/.claude, Codex under ~/.codex);
 * the ledger is only an index card across runtimes, so it stores a pointer
 * instead of re-saving content. Embedded pi currently runs with
 * `SessionManager.inMemory()` — no archive file, so its runs carry no ref.
 */
export interface AgentRunArchiveRef {
  /** Runtime-side session/conversation id (Claude session id, Codex thread id). */
  sessionId?: string;
  /** Path to the runtime's own transcript file, when the runtime exposes one. */
  path?: string;
}

export interface AgentRunRecord {
  id: string;
  rootRunId?: string;
  parentRunId?: string;
  chatSessionId?: string;
  agentKind: AgentNodeKind;
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
  archive?: AgentRunArchiveRef;
  metadata?: Record<string, unknown>;
}

export type AgentEventType =
  | 'run_started'
  | 'run_updated'
  | 'run_completed'
  | 'run_failed'
  | 'run_canceled'
  | 'status'
  | 'text'
  | 'tool'
  | 'tool_started'
  | 'tool_updated'
  | 'tool_completed'
  | 'file'
  | 'file_changed'
  | 'permission'
  | 'permission_requested'
  | 'permission_resolved'
  | 'user_question_started'
  | 'user_question_resolved'
  | 'runtime_status'
  | 'error';

export type AgentEventVisibility = 'timeline' | 'debug';

export type AgentEventCategory =
  | 'status'
  | 'text'
  | 'tool'
  | 'file'
  | 'permission'
  | 'question'
  | 'error';

export type AgentEventData =
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

export interface AppendAgentEventInput {
  type: AgentEventType;
  status?: AgentRunStatus;
  message?: unknown;
  category?: AgentEventCategory;
  data?: AgentEventData;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  filePath?: string;
  runtime?: string;
  visibility?: AgentEventVisibility;
  metadata?: Record<string, unknown>;
}

export interface AgentEvent {
  id: string;
  runId: string;
  type: AgentEventType;
  category: AgentEventCategory;
  ts: number;
  status: AgentRunStatus;
  record: AgentRunRecord;
  message?: string;
  data?: AgentEventData;
  title?: string;
  toolCallId?: string;
  toolName?: string;
  filePath?: string;
  runtime?: string;
  visibility?: AgentEventVisibility;
  metadata?: Record<string, unknown>;
}

export interface StartAgentRunInput {
  id?: string;
  rootRunId?: string;
  parentRunId?: string;
  chatSessionId?: string;
  agentKind: AgentNodeKind;
  runtimeId: string;
  displayName: string;
  status?: Extract<AgentRunStatus, 'queued' | 'running' | 'streaming'>;
  cwd?: string;
  permissionMode?: AgentRunPermissionMode;
  inputSummary: string;
  archive?: AgentRunArchiveRef;
  metadata?: Record<string, unknown>;
}

export interface CompleteAgentRunInput {
  outputSummary?: string;
  archive?: AgentRunArchiveRef;
  metadata?: Record<string, unknown>;
}

export interface FailAgentRunInput {
  error: unknown;
  outputSummary?: string;
  status?: Extract<AgentRunStatus, 'failed' | 'canceled' | 'timed_out'>;
  archive?: AgentRunArchiveRef;
  metadata?: Record<string, unknown>;
}

export interface CancelAgentRunInput {
  reason?: unknown;
  outputSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentRunInput {
  displayName?: string;
  runtimeId?: string;
  cwd?: string;
  permissionMode?: AgentRunPermissionMode;
  inputSummary?: string;
  outputSummary?: string;
  error?: string;
  status?: AgentRunStatus;
  archive?: AgentRunArchiveRef;
  metadata?: Record<string, unknown>;
}

export interface ListAgentRunsOptions {
  runId?: string;
  rootRunId?: string;
  kind?: AgentNodeKind;
  status?: AgentRunStatus;
  parentRunId?: string;
  chatSessionId?: string;
  startedAfter?: number;
  limit?: number;
}

export interface ListAgentEventsOptions {
  runId?: string;
  rootRunId?: string;
  chatSessionId?: string;
  type?: AgentEventType;
  category?: AgentEventCategory;
  startedAfter?: number;
  limit?: number;
}
