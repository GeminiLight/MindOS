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
export type StudioAutomationModel = 'mindos-auto' | 'gpt-5.5' | 'claude-code' | 'local-agent';
export type StudioAutomationEffort = 'normal' | 'high' | 'extra-high';
export type StudioAutomationStatus = 'active' | 'paused';
export type StudioAutomationRunStatus = 'pending' | 'running' | 'success' | 'error';
export type StudioAutomationRuntime = 'mindos-pi';
export type StudioAutomationSource = 'schedule-prompt';

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
  status: StudioAutomationStatus;
  updated: string;
  lastRun?: string;
  nextRun?: string;
  runCount: number;
  lastStatus?: StudioAutomationRunStatus;
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
}

export interface StudioAutomationPayload {
  schemaVersion: 1;
  generatedAt: string;
  automations: StudioAutomation[];
  summary: {
    total: number;
    enabled: number;
    paused: number;
    externalSchedulePromptJobs: number;
    scheduleStorePath: string;
    controlPlaneScheduleCount: number;
  };
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
