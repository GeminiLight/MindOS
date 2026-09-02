export type StudioAutomationScope = 'worktree' | 'project' | 'mind';
export type StudioAutomationSchedule =
  | 'manual'
  | 'hourly'
  | 'every-2-hours'
  | 'every-4-hours'
  | 'daily-0900'
  | 'daily-1800'
  | 'twice-daily'
  | 'weekdays-0900'
  | 'weekdays-1800'
  | 'weekly-monday-0900'
  | 'weekly-friday-1730'
  | 'weekly-review'
  | 'monthly-first-0900'
  | 'monthly-last-1700';
export type StudioAutomationModel = 'mindos-auto' | 'gpt-5.5' | 'codex' | 'claude-code';
export type StudioAutomationEffort = 'normal' | 'high' | 'extra-high';
export type StudioAutomationPermissionMode = 'read' | 'ask' | 'auto';
export type StudioAutomationStatus = 'active' | 'paused';
export type StudioAutomationRunStatus = 'pending' | 'running' | 'waiting_approval' | 'success' | 'error' | 'timed_out' | 'interrupted';
export type StudioAutomationRuntime = 'mindos-pi' | 'codex' | 'claude';
export type StudioAutomationSource = 'mindos-durable';

export interface StudioAutomation {
  id: string;
  title: string;
  titleZh?: string;
  prompt: string;
  promptZh?: string;
  scope: StudioAutomationScope;
  projectId?: string;
  schedule: StudioAutomationSchedule;
  model: StudioAutomationModel;
  effort: StudioAutomationEffort;
  timezone: string;
  permissionMode: StudioAutomationPermissionMode;
  retry: 'never' | 'once';
  timeoutMs: number;
  status: StudioAutomationStatus;
  updated: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  lastStatus?: StudioAutomationRunStatus;
  lastError?: string;
  recentRuns?: Array<{
    id: string;
    status: Exclude<StudioAutomationRunStatus, 'pending'>;
    startedAt: string;
    finishedAt?: string;
    artifactPath?: string;
    outputPreview?: string;
    error?: string;
  }>;
  runtime: StudioAutomationRuntime;
  source: StudioAutomationSource;
  controlPlaneScheduleId: string;
}

export interface StudioAutomationDraft {
  title: string;
  prompt: string;
  scope: StudioAutomationScope;
  projectId?: string;
  schedule: StudioAutomationSchedule;
  model: StudioAutomationModel;
  effort: StudioAutomationEffort;
  timezone: string;
  permissionMode: StudioAutomationPermissionMode;
  retry: 'never' | 'once';
  timeoutMs: number;
}

export interface StudioAutomationPayload {
  schemaVersion: 1;
  generatedAt: string;
  automations: StudioAutomation[];
  approvals: StudioAutomationApproval[];
  notifications: StudioAutomationNotification[];
  worker: StudioAutomationWorkerHeartbeat | null;
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
    pendingApprovals: number;
    unreadNotifications: number;
  };
}

export interface StudioAutomationApproval {
  id: string;
  jobId: string;
  fingerprint: string;
  runtime: 'codex' | 'claude';
  status: 'pending' | 'approved' | 'denied' | 'consumed';
  toolName: string;
  action?: string;
  resource?: string;
  inputPreview?: string;
  risk?: { level: 'low' | 'medium' | 'high'; summary: string };
  allowDecision: string;
  denyDecision: string;
  createdAt: string;
  resolvedAt?: string;
  consumedAt?: string;
}

export interface StudioAutomationNotification {
  id: string;
  jobId: string;
  runId?: string;
  kind: 'failure' | 'timeout' | 'interrupted' | 'approval_required';
  title: string;
  body: string;
  createdAt: string;
  readAt?: string;
}

export interface StudioAutomationWorkerHeartbeat {
  schemaVersion: 1;
  ownerId: string;
  pid: number;
  status: 'running' | 'idle' | 'error' | 'stopped';
  updatedAt: string;
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastError?: string;
}

const API_PATH = '/api/studio/automations';

export const STUDIO_AUTOMATIONS_UPDATED_EVENT = 'mindos:studio-automations-updated';

export async function fetchStudioAutomations(): Promise<StudioAutomationPayload> {
  const response = await fetch(API_PATH, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return readPayloadResponse(response);
}

export async function createStudioAutomation(draft: StudioAutomationDraft): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'create', draft });
}

export async function updateStudioAutomation(id: string, draft: StudioAutomationDraft): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'update', id, draft });
}

export async function setStudioAutomationStatus(
  id: string,
  status: StudioAutomationStatus,
): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'set-status', id, status });
}

export async function deleteStudioAutomation(id: string): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'delete', id });
}

export async function runStudioAutomationNow(id: string): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'run-now', id });
}

export async function resolveStudioAutomationApproval(
  approvalId: string,
  decision: 'allow' | 'deny',
): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'resolve-approval', approvalId, decision });
}

export async function acknowledgeStudioAutomationNotification(notificationId: string): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'acknowledge-notification', notificationId });
}

export async function acknowledgeAllStudioAutomationNotifications(): Promise<StudioAutomationPayload> {
  return mutateStudioAutomation({ action: 'acknowledge-all-notifications' });
}

async function mutateStudioAutomation(body: unknown): Promise<StudioAutomationPayload> {
  const response = await fetch(API_PATH, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await readPayloadResponse(response);
  emitAutomationsUpdated(payload);
  return payload;
}

async function readPayloadResponse(response: Response): Promise<StudioAutomationPayload> {
  const body = await response.json().catch(() => null) as Partial<StudioAutomationPayload> & { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error || `Automation request failed (${response.status})`);
  }
  if (!body || body.schemaVersion !== 1 || !Array.isArray(body.automations)) {
    throw new Error('Automation response was malformed.');
  }
  return body as StudioAutomationPayload;
}

function emitAutomationsUpdated(detail?: StudioAutomationPayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STUDIO_AUTOMATIONS_UPDATED_EVENT, { detail }));
}
