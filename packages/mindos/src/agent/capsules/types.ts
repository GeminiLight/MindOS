export type AgentRunCapsuleStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out';

export type AgentRunCapsuleSource = 'interactive' | 'automation' | 'event' | 'recovery';

export interface AgentRunCapsuleRuntime {
  kind: 'mindos' | 'acp' | 'codex' | 'claude';
  id: string;
  name: string;
}

export interface AgentRunCapsuleRuntimeBinding {
  type: 'mindos-pi-session' | 'codex-thread' | 'claude-session' | 'acp-session';
  runtime: AgentRunCapsuleRuntime['kind'];
  runtimeId: string;
  externalSessionId?: string;
  cwd?: string;
  status?: 'active' | 'missing' | 'signed-out' | 'archived' | 'failed';
  updatedAt?: number;
}

export interface AgentRunCapsuleUploadedFile {
  name: string;
  content: string;
  mimeType?: string;
  size?: number;
  dataBase64?: string;
}

export interface AgentRunCapsuleContext {
  currentFile?: string;
  attachedFiles: string[];
  uploadedFiles: AgentRunCapsuleUploadedFile[];
  receiptIds: string[];
  assetIds: string[];
}

export interface AgentRunCapsuleRequest {
  messages: Array<Record<string, unknown>>;
  runtime: AgentRunCapsuleRuntime;
  runtimeBinding?: AgentRunCapsuleRuntimeBinding | null;
  agentMode?: string;
  permissionMode?: string;
  model?: string;
  thinkingEffort?: string;
  context: AgentRunCapsuleContext;
  options?: Record<string, unknown>;
}

export interface AgentRunCapsuleProvenance {
  cwd?: string;
  gitRevision?: string;
  checkpointArtifactId?: string;
  parentCapsuleId?: string;
  recoveryAction?: AgentRunCapsuleRecoveryAction;
}

export interface AgentRunCapsule {
  schemaVersion: 1;
  id: string;
  runId: string;
  rootRunId: string;
  chatSessionId?: string;
  source: AgentRunCapsuleSource;
  status: AgentRunCapsuleStatus;
  request: AgentRunCapsuleRequest;
  provenance: AgentRunCapsuleProvenance;
  result?: { outputText?: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRunCapsuleInput {
  id: string;
  runId: string;
  rootRunId: string;
  chatSessionId?: string;
  source: AgentRunCapsuleSource;
  status?: AgentRunCapsuleStatus;
  request: AgentRunCapsuleRequest;
  provenance?: AgentRunCapsuleProvenance;
  now?: Date;
}

export type AgentRunCapsuleRecoveryAction = 'retry' | 'fork' | 'resume' | 'rollback';

export interface AgentRunCapsuleRecoveryPlan {
  schemaVersion: 1;
  id: string;
  sourceCapsuleId: string;
  action: AgentRunCapsuleRecoveryAction;
  request: AgentRunCapsuleRequest;
  targetChatSessionId?: string;
  checkpointArtifactId?: string;
  createdAt: string;
}

export interface CreateAgentRunCapsuleRecoveryPlanInput {
  action: AgentRunCapsuleRecoveryAction;
  idempotencyKey: string;
  now?: Date;
}

export interface AgentRunCapsuleRecoveryClaim {
  schemaVersion: 1;
  planId: string;
  runId: string;
  claimedAt: string;
}

export interface AgentRunCapsuleProjection {
  schemaVersion: 1;
  id: string;
  runId: string;
  rootRunId: string;
  chatSessionId?: string;
  source: AgentRunCapsuleSource;
  status: AgentRunCapsuleStatus;
  inputSummary: string;
  runtime: AgentRunCapsuleRuntime;
  model?: string;
  thinkingEffort?: string;
  context: {
    currentFile?: string;
    attachedFileCount: number;
    uploadedFileCount: number;
    receiptIds: string[];
    assetIds: string[];
  };
  recovery: {
    retry: { supported: true; mode: 'from-start' };
    fork: { supported: true; mode: 'new-session' };
    resume: { supported: boolean; sessionId?: string; reason?: string };
    rollback: { supported: boolean; checkpointArtifactId?: string; reason?: string };
  };
  createdAt: string;
  updatedAt: string;
}
