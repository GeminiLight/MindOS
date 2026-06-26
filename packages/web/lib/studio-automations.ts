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

const STORAGE_KEY = 'mindos:studio-automations';
export const STUDIO_AUTOMATIONS_UPDATED_EVENT = 'mindos:studio-automations-updated';

let volatileCustomAutomations: StudioAutomation[] = [];
let useVolatileAutomations = false;

export const STUDIO_AUTOMATIONS: StudioAutomation[] = [
  {
    id: 'daily-research-radar',
    title: 'Daily research radar',
    titleZh: '每日研究雷达',
    prompt: 'Scan tracked research directions, select the strongest papers, and write the daily Chinese radar reports.',
    promptZh: '扫描已跟踪的研究方向，筛选最强论文，并写出每日中文雷达报告。',
    scope: 'mind',
    schedule: 'daily-0900',
    model: 'mindos-auto',
    effort: 'high',
    status: 'active',
    updated: 'Today',
    lastRun: 'Today 09:04',
    nextRun: 'Tomorrow 09:00',
    runCount: 18,
  },
  {
    id: 'inbox-cleanup-review',
    title: 'Inbox cleanup review',
    titleZh: '收集箱清理复盘',
    prompt: 'Group new captures, flag duplicates, and propose the safest promotion target before writing anything.',
    promptZh: '归组新捕获内容，标记重复项，并在写入前建议最稳妥的沉淀位置。',
    scope: 'project',
    projectId: 'inbox-practice',
    schedule: 'weekdays-0900',
    model: 'mindos-auto',
    effort: 'normal',
    status: 'paused',
    updated: 'Yesterday',
    lastRun: 'Mon 09:12',
    nextRun: 'Paused',
    runCount: 7,
  },
  {
    id: 'release-note-sweep',
    title: 'Release note sweep',
    titleZh: '发布记录巡检',
    prompt: 'Check completed work, collect user-facing changes, and draft a compact release note.',
    promptZh: '检查已完成工作，收集面向用户的变化，并起草简洁发布记录。',
    scope: 'worktree',
    schedule: 'weekly-review',
    model: 'claude-code',
    effort: 'high',
    status: 'active',
    updated: '2d ago',
    lastRun: 'Fri 17:30',
    nextRun: 'Friday 17:30',
    runCount: 4,
  },
];

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function cleanText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function slugifyAutomationTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'automation';
}

function readCustomAutomations(): StudioAutomation[] {
  if (!canUseStorage()) return volatileCustomAutomations;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return useVolatileAutomations ? volatileCustomAutomations : [];
    const parsed = JSON.parse(raw) as StudioAutomation[];
    const automations = Array.isArray(parsed)
      ? parsed.filter((automation) => automation && typeof automation.id === 'string')
      : [];
    volatileCustomAutomations = automations;
    useVolatileAutomations = false;
    return automations;
  } catch {
    if (useVolatileAutomations) return volatileCustomAutomations;
    volatileCustomAutomations = [];
    return [];
  }
}

function writeCustomAutomations(automations: StudioAutomation[]): void {
  volatileCustomAutomations = automations;
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(automations));
    useVolatileAutomations = false;
  } catch {
    useVolatileAutomations = true;
  }
}

function emitAutomationsUpdated(detail?: StudioAutomation): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STUDIO_AUTOMATIONS_UPDATED_EVENT, { detail }));
}

function normalizeDraft(draft: StudioAutomationDraft): StudioAutomationDraft {
  return {
    title: cleanText(draft.title),
    prompt: cleanText(draft.prompt),
    scope: draft.scope,
    projectId: cleanText(draft.projectId) || undefined,
    schedule: draft.schedule,
    model: draft.model,
    effort: draft.effort,
  };
}

export function readStudioAutomations(): StudioAutomation[] {
  const seedIds = new Set(STUDIO_AUTOMATIONS.map((automation) => automation.id));
  const customAutomations = readCustomAutomations();
  const customById = new Map(customAutomations.map((automation) => [automation.id, automation]));
  const customOnlyAutomations = customAutomations.filter((automation) => !seedIds.has(automation.id));
  const seedAutomations = STUDIO_AUTOMATIONS.map((automation) => {
    const override = customById.get(automation.id);
    return override ? { ...automation, ...override } : automation;
  });
  return [...customOnlyAutomations, ...seedAutomations];
}

export function buildStudioAutomationFromDraft(
  draft: StudioAutomationDraft,
  existingAutomations: StudioAutomation[],
): StudioAutomation {
  const normalized = normalizeDraft(draft);
  const existingIds = new Set(existingAutomations.map((automation) => automation.id));
  const title = normalized.title || 'Untitled automation';
  const baseId = slugifyAutomationTitle(title);
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    title,
    prompt: normalized.prompt,
    scope: normalized.scope,
    ...(normalized.projectId ? { projectId: normalized.projectId } : {}),
    schedule: normalized.schedule,
    model: normalized.model,
    effort: normalized.effort,
    status: 'active',
    updated: 'Just now',
    nextRun: normalized.schedule === 'manual' ? 'Manual' : 'Queued',
    runCount: 0,
  };
}

export function createStudioAutomation(draft: StudioAutomationDraft): StudioAutomation {
  const existing = readStudioAutomations();
  const automation = buildStudioAutomationFromDraft(draft, existing);
  writeCustomAutomations([automation, ...readCustomAutomations()]);
  emitAutomationsUpdated(automation);
  return automation;
}

export function updateStudioAutomation(id: string, draft: StudioAutomationDraft): StudioAutomation | null {
  const existing = readStudioAutomations();
  const current = existing.find((automation) => automation.id === id);
  if (!current) return null;
  const normalized = normalizeDraft(draft);
  const updated: StudioAutomation = {
    ...current,
    ...normalized,
    title: normalized.title || current.title,
    prompt: normalized.prompt,
    updated: 'Just now',
  };
  const custom = readCustomAutomations();
  const nextCustom = custom.some((automation) => automation.id === id)
    ? custom.map((automation) => (automation.id === id ? updated : automation))
    : [updated, ...custom];
  writeCustomAutomations(nextCustom);
  emitAutomationsUpdated(updated);
  return updated;
}

export function toggleStudioAutomationStatus(id: string): StudioAutomation | null {
  const current = readStudioAutomations().find((automation) => automation.id === id);
  if (!current) return null;
  const nextStatus: StudioAutomationStatus = current.status === 'active' ? 'paused' : 'active';
  const updated: StudioAutomation = {
    ...current,
    status: nextStatus,
    updated: 'Just now',
    nextRun: nextStatus === 'paused'
      ? 'Paused'
      : current.schedule === 'manual'
        ? 'Manual'
        : current.nextRun === 'Paused'
          ? 'Queued'
          : current.nextRun,
  };
  const custom = readCustomAutomations();
  const nextCustom = custom.some((automation) => automation.id === id)
    ? custom.map((automation) => (automation.id === id ? updated : automation))
    : [updated, ...custom];
  writeCustomAutomations(nextCustom);
  emitAutomationsUpdated(updated);
  return updated;
}
