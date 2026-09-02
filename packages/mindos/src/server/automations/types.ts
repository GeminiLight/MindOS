export const STUDIO_AUTOMATION_SCHEDULES = [
  'manual',
  'hourly',
  'every-2-hours',
  'every-4-hours',
  'daily-0900',
  'daily-1800',
  'twice-daily',
  'weekdays-0900',
  'weekdays-1800',
  'weekly-monday-0900',
  'weekly-friday-1730',
  'weekly-review',
  'monthly-first-0900',
  'monthly-last-1700',
] as const;

export type StudioAutomationSchedule = (typeof STUDIO_AUTOMATION_SCHEDULES)[number];
export type StudioAutomationScope = 'worktree' | 'project' | 'mind';
export type StudioAutomationModel = 'mindos-auto' | 'gpt-5.5' | 'claude-code' | 'local-agent';
export type StudioAutomationEffort = 'normal' | 'high' | 'extra-high';
export type StudioAutomationPermissionMode = 'read' | 'auto';
export type StudioAutomationStatus = 'active' | 'paused';
export type StudioAutomationRetryPolicy = 'never' | 'once';
export type StudioAutomationRunStatus = 'running' | 'success' | 'error' | 'timed_out' | 'interrupted';

export type StudioAutomationLease = {
  runId: string;
  ownerId: string;
  occurrenceAt: string;
  claimedAt: string;
  expiresAt: string;
  attempt: number;
};

export type StudioAutomationRun = {
  id: string;
  status: StudioAutomationRunStatus;
  attempt: number;
  occurrenceAt: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  artifactPath?: string;
  outputPreview?: string;
  error?: string;
};

export type StudioAutomationJob = {
  id: string;
  title: string;
  prompt: string;
  scope: StudioAutomationScope;
  projectId?: string;
  schedule: StudioAutomationSchedule;
  timezone: string;
  model: StudioAutomationModel;
  effort: StudioAutomationEffort;
  permissionMode: StudioAutomationPermissionMode;
  status: StudioAutomationStatus;
  retry: StudioAutomationRetryPolicy;
  timeoutMs: number;
  overlap: 'skip';
  runtime: 'mindos-pi';
  source: 'mindos-durable';
  controlPlaneScheduleId: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  retryAttempt?: number;
  runCount: number;
  lastRun?: string;
  lastStatus: 'pending' | StudioAutomationRunStatus;
  lastError?: string;
  lease?: StudioAutomationLease;
  history: StudioAutomationRun[];
};

export type StudioAutomationMigration = {
  completedAt?: string;
  importedCount: number;
  externalSchedulePromptJobs: number;
  legacyStorePath?: string;
  warning?: string;
  pendingLegacyJobs?: Array<{
    id: string;
    status: StudioAutomationStatus;
  }>;
};

export type StudioAutomationState = {
  schemaVersion: 1;
  updatedAt: string;
  migration: StudioAutomationMigration;
  automations: StudioAutomationJob[];
};

export type StudioAutomationDraft = {
  title: string;
  prompt: string;
  scope: StudioAutomationScope;
  projectId?: string;
  schedule: StudioAutomationSchedule;
  timezone: string;
  model: StudioAutomationModel;
  effort: StudioAutomationEffort;
  permissionMode: StudioAutomationPermissionMode;
  retry: StudioAutomationRetryPolicy;
  timeoutMs: number;
};

export type StudioAutomationPayload = {
  schemaVersion: 1;
  generatedAt: string;
  automations: Array<{
    id: string;
    title: string;
    prompt: string;
    scope: StudioAutomationScope;
    projectId?: string;
    schedule: StudioAutomationSchedule;
    timezone: string;
    model: StudioAutomationModel;
    effort: StudioAutomationEffort;
    permissionMode: StudioAutomationPermissionMode;
    status: StudioAutomationStatus;
    retry: StudioAutomationRetryPolicy;
    timeoutMs: number;
    updated: string;
    lastRun?: string;
    nextRun?: string;
    runCount: number;
    lastStatus: 'pending' | StudioAutomationRunStatus;
    lastError?: string;
    recentRuns: StudioAutomationRun[];
    runtime: 'mindos-pi';
    source: 'mindos-durable';
    controlPlaneScheduleId: string;
  }>;
  summary: {
    total: number;
    enabled: number;
    paused: number;
    running: number;
    failed: number;
    externalSchedulePromptJobs: number;
    migratedLegacyJobs: number;
    migrationWarning?: string;
    scheduleStorePath: string;
    controlPlaneScheduleCount: number;
  };
};

export type StudioAutomationExecutorResult = {
  text: string;
  thinking?: string;
  toolCalls?: Array<{ toolName: string; output: string; isError: boolean }>;
};

export type StudioAutomationExecutorContext = {
  runId: string;
  attempt: number;
  signal: AbortSignal;
};

export type StudioAutomationExecutor = (
  job: StudioAutomationJob,
  context: StudioAutomationExecutorContext,
) => Promise<StudioAutomationExecutorResult>;
