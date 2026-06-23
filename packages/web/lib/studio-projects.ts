import type {
  ContextAssistantRef,
  ContextSpaceRef,
  SessionContextSelection,
  SessionWorkDir,
} from '@/lib/types';
import {
  defaultSessionContextSelection,
  defaultSessionWorkDir,
  normalizeSessionContextSelectionForClient,
  normalizeSessionWorkDirForClient,
} from '@/lib/session-context';

export interface StudioSessionSummary {
  id: string;
  href?: string;
  agentId?: string;
  agentName?: string;
  title: string;
  titleZh?: string;
  status: 'active' | 'paused' | 'review' | 'done';
  updated: string;
  artifact: string;
  artifactZh?: string;
  summary: string;
  summaryZh?: string;
}

export interface StudioProject {
  id: string;
  title: string;
  titleZh?: string;
  goal: string;
  goalZh?: string;
  space: string;
  spaceZh?: string;
  kits: string[];
  workArea: string;
  workAreaZh?: string;
  workDir?: SessionWorkDir;
  spaces?: ContextSpaceRef[];
  assistants?: ContextAssistantRef[];
  cadence: string;
  cadenceZh?: string;
  stage: 'active' | 'draft' | 'review';
  progress: number;
  updated: string;
  nextAction: string;
  nextActionZh?: string;
  sessions: StudioSessionSummary[];
  reviewItems: string[];
  reviewItemsZh?: string[];
  lessons: string[];
  lessonsZh?: string[];
}

export interface StudioProjectDraft {
  title?: string;
  goal?: string;
  space?: string;
  kit?: string;
  workArea?: string;
  workDir?: SessionWorkDir;
  spaces?: ContextSpaceRef[];
  assistants?: ContextAssistantRef[];
}

export interface StudioProjectDefaultsUpdate {
  spaces?: ContextSpaceRef[];
  assistants?: ContextAssistantRef[];
}

const STORAGE_KEY = 'mindos:studio-projects';
const LAST_OPENED_PROJECT_KEY = 'mindos:studio-last-opened-project-id';
export const STUDIO_PROJECTS_UPDATED_EVENT = 'mindos:studio-projects-updated';
export const STUDIO_NEW_PROJECT_REQUESTED_EVENT = 'mindos:studio-new-project-requested';
let volatileCustomProjects: StudioProject[] = [];
let useVolatileProjects = false;
let volatileLastOpenedProjectId: string | null = null;

export const STUDIO_PROJECTS: StudioProject[] = [
  {
    id: 'launch-practice',
    title: 'Launch Practice',
    titleZh: '发布实践',
    goal: 'Turn scattered product evidence into launch-ready decisions.',
    goalZh: '把分散的产品证据整理成可发布决策。',
    space: 'Product Strategy',
    spaceZh: '产品策略',
    kits: ['Research Kit', 'Launch Writing Kit', 'Review Kit'],
    workArea: 'Session drafts',
    workAreaZh: 'Session 草稿',
    cadence: 'Weekly evidence pass',
    cadenceZh: '每周证据复盘',
    stage: 'active',
    progress: 68,
    updated: 'Today',
    nextAction: 'Draft launch brief from accepted evidence.',
    nextActionZh: '用已确认的证据起草发布 brief。',
    sessions: [
      {
        id: 'launch-brief-review',
        agentId: 'codex',
        agentName: 'Codex',
        title: 'Launch brief review',
        titleZh: '发布 brief 复盘',
        status: 'active',
        updated: 'Today',
        artifact: 'launch-brief.md',
        artifactZh: 'launch-brief.md',
        summary: 'Opened the working brief and marked weak evidence for review.',
        summaryZh: '打开发布 brief，并标记需要复盘的薄弱证据。',
      },
      {
        id: 'pricing-evidence-pass',
        agentId: 'mindos',
        agentName: 'MindOS',
        title: 'Pricing evidence pass',
        titleZh: '定价证据梳理',
        status: 'review',
        updated: 'Yesterday',
        artifact: 'pricing-notes.md',
        artifactZh: 'pricing-notes.md',
        summary: 'Grouped pricing claims by confidence and source freshness.',
        summaryZh: '按置信度和来源新鲜度整理定价论点。',
      },
    ],
    reviewItems: ['Evidence freshness', 'Launch risk wording', 'Decision owner'],
    reviewItemsZh: ['证据新鲜度', '发布风险表述', '决策 owner'],
    lessons: ['Draft after evidence is accepted', 'Keep source confidence visible'],
    lessonsZh: ['证据确认后再起草', '保持来源置信度可见'],
  },
  {
    id: 'research-practice',
    title: 'Research Practice',
    titleZh: '研究实践',
    goal: 'Build source-grounded synthesis and paper-grade critique habits.',
    goalZh: '训练有来源依据的综合能力和论文级评审习惯。',
    space: 'Research Memory',
    spaceZh: '研究记忆',
    kits: ['Literature Kit', 'Review Kit'],
    workArea: 'Paper drafts',
    workAreaZh: '论文草稿',
    cadence: 'Two sessions per paper cluster',
    cadenceZh: '每组论文两次 Session',
    stage: 'review',
    progress: 54,
    updated: 'Yesterday',
    nextAction: 'Promote reusable reading rubric to Space.',
    nextActionZh: '把可复用阅读 rubric 沉淀到 Space。',
    sessions: [
      {
        id: 'literature-map',
        agentId: 'claude',
        agentName: 'Claude Code',
        title: 'Literature map',
        titleZh: '文献地图',
        status: 'done',
        updated: 'Mon',
        artifact: 'evidence-map.md',
        artifactZh: 'evidence-map.md',
        summary: 'Mapped methods, datasets, and unresolved assumptions across the cluster.',
        summaryZh: '整理该组论文的方法、数据集和未解决假设。',
      },
      {
        id: 'method-risk-pass',
        agentId: 'mindos',
        agentName: 'MindOS',
        title: 'Method risk pass',
        titleZh: '方法风险复盘',
        status: 'review',
        updated: 'Tue',
        artifact: 'risk-notes.md',
        artifactZh: 'risk-notes.md',
        summary: 'Separated methodological risk from missing experiment notes.',
        summaryZh: '把方法风险和缺失实验记录拆开处理。',
      },
    ],
    reviewItems: ['Reproducibility notes', 'Counter-evidence', 'Reading rubric'],
    reviewItemsZh: ['可复现性记录', '反向证据', '阅读 rubric'],
    lessons: ['State the evidence threshold before synthesis', 'Promote reusable critique patterns'],
    lessonsZh: ['综合前先写清证据门槛', '沉淀可复用评审模式'],
  },
  {
    id: 'inbox-practice',
    title: 'Inbox Practice',
    titleZh: '收集箱实践',
    goal: 'Convert raw captures into durable knowledge and next actions.',
    goalZh: '把原始捕获变成长期知识和下一步行动。',
    space: 'Inbox + Personal Space',
    spaceZh: 'Inbox + Personal Space',
    kits: ['Capture Organize Kit'],
    workArea: 'Review queue',
    workAreaZh: 'Review queue',
    cadence: 'Daily capture cleanup',
    cadenceZh: '每日收集清理',
    stage: 'draft',
    progress: 41,
    updated: '2d ago',
    nextAction: 'Group unread links before promotion.',
    nextActionZh: '沉淀前先合并未读链接。',
    sessions: [
      {
        id: 'link-triage',
        agentId: 'mindos',
        agentName: 'MindOS',
        title: 'Link triage',
        titleZh: '链接筛选',
        status: 'paused',
        updated: '2d ago',
        artifact: 'candidate-links.md',
        artifactZh: 'candidate-links.md',
        summary: 'Sorted unread links into promote, skim, and archive lanes.',
        summaryZh: '把未读链接分成沉淀、略读和归档三类。',
      },
    ],
    reviewItems: ['Duplicate captures', 'Source logos', 'Promotion target'],
    reviewItemsZh: ['重复捕获', '来源 logo', '沉淀目标'],
    lessons: ['Group captures before writing summaries', 'Keep raw links until promotion is accepted'],
    lessonsZh: ['先归组再写摘要', '沉淀确认前保留原始链接'],
  },
];

export function localize(primary: string, zh: string | undefined, locale: string): string {
  return locale === 'zh' && zh ? zh : primary;
}

export function stageLabel(stage: StudioProject['stage'], locale: string): string {
  if (locale === 'zh') {
    if (stage === 'active') return '推进中';
    if (stage === 'review') return '待复盘';
    return '草稿';
  }
  if (stage === 'active') return 'Active';
  if (stage === 'review') return 'Review';
  return 'Draft';
}

export function sessionStatusLabel(status: StudioSessionSummary['status'], locale: string): string {
  if (locale === 'zh') {
    if (status === 'active') return '进行中';
    if (status === 'paused') return '暂停';
    if (status === 'review') return '待复盘';
    return '完成';
  }
  if (status === 'active') return 'Active';
  if (status === 'paused') return 'Paused';
  if (status === 'review') return 'Review';
  return 'Done';
}

export function localizeList(primary: string[], zh: string[] | undefined, locale: string): string[] {
  return locale === 'zh' && zh ? zh : primary;
}

function cleanLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function pathLabel(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || path;
}

function projectTitleFromWorkDir(workDir: SessionWorkDir | undefined): string | undefined {
  const label = cleanLabel(workDir?.label);
  if (label) return label;
  const path = cleanLabel(workDir?.path);
  return path ? pathLabel(path) : undefined;
}

function assistantIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'assistant';
}

function normalizeProjectSpaces(input: unknown, updatedAt?: number): ContextSpaceRef[] {
  return normalizeSessionContextSelectionForClient({ version: 1, spaces: input, assistants: [], updatedAt }).spaces;
}

function normalizeProjectAssistants(input: unknown, updatedAt?: number): ContextAssistantRef[] {
  return normalizeSessionContextSelectionForClient({ version: 1, spaces: [], assistants: input, updatedAt }).assistants;
}

function legacySpaceToRef(project: Pick<StudioProject, 'space' | 'spaceZh'>, locale: string): ContextSpaceRef | null {
  const path = cleanLabel(project.space);
  if (!path) return null;
  return {
    path,
    label: localize(project.space, project.spaceZh, locale),
    source: 'project-default',
  };
}

function legacyKitToAssistant(name: string): ContextAssistantRef | null {
  const label = cleanLabel(name);
  if (!label) return null;
  return {
    id: assistantIdFromName(label),
    name: label,
    kind: 'team',
    source: 'project-default',
  };
}

export function getStudioProjectWorkDir(project: StudioProject, updatedAt?: number): SessionWorkDir {
  if (project.workDir) return normalizeSessionWorkDirForClient(project.workDir, updatedAt);
  return defaultSessionWorkDir(updatedAt);
}

export function getStudioProjectWorkDirLabel(project: StudioProject, locale: string): string {
  const workDir = getStudioProjectWorkDir(project);
  if (workDir.source === 'mind-root') return locale === 'zh' ? 'Mind' : 'Mind';
  return workDir.label || (workDir.path ? pathLabel(workDir.path) : localize(project.workArea, project.workAreaZh, locale));
}

export function getStudioProjectSpaceRefs(project: StudioProject, locale: string): ContextSpaceRef[] {
  if (Array.isArray(project.spaces)) return normalizeProjectSpaces(project.spaces);
  const spaces = normalizeProjectSpaces(project.spaces);
  if (spaces.length > 0) return spaces;
  const legacy = legacySpaceToRef(project, locale);
  return legacy ? [legacy] : [];
}

export function getStudioProjectSpaceLabels(project: StudioProject, locale: string): string[] {
  const spaces = getStudioProjectSpaceRefs(project, locale);
  if (spaces.length === 0) return [];
  return spaces.map((space) => space.label?.trim() || pathLabel(space.path));
}

export function getStudioProjectAssistantRefs(project: StudioProject): ContextAssistantRef[] {
  if (Array.isArray(project.assistants)) return normalizeProjectAssistants(project.assistants);
  const assistants = normalizeProjectAssistants(project.assistants);
  if (assistants.length > 0) return assistants;
  return project.kits.map(legacyKitToAssistant).filter((assistant): assistant is ContextAssistantRef => Boolean(assistant));
}

export function getStudioProjectAssistantLabels(project: StudioProject): string[] {
  const assistants = getStudioProjectAssistantRefs(project);
  if (assistants.length === 0) return [];
  return assistants.map((assistant) => assistant.name?.trim() || assistant.id);
}

export function getStudioProjectSessionDefaults(project: StudioProject, updatedAt?: number): {
  workDir: SessionWorkDir;
  contextSelection: SessionContextSelection;
} {
  const spaces = getStudioProjectSpaceRefs(project, 'en').map((space) => ({
    ...space,
    source: 'project-default' as const,
  }));
  const assistants = getStudioProjectAssistantRefs(project).map((assistant) => ({
    ...assistant,
    source: 'project-default' as const,
  }));
  return {
    workDir: getStudioProjectWorkDir(project, updatedAt),
    contextSelection: spaces.length || assistants.length
      ? normalizeSessionContextSelectionForClient({ version: 1, spaces, assistants, updatedAt })
      : defaultSessionContextSelection(updatedAt),
  };
}

export function slugifyProjectTitle(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

export function findStudioProject(projects: StudioProject[], projectId: string): StudioProject | undefined {
  return projects.find((project) => project.id === projectId);
}

export function getStudioProjectHref(projectId: string): string {
  return `/studio/${encodeURIComponent(projectId)}`;
}

export function buildStudioProjectFromDraft(
  draft: StudioProjectDraft,
  existingProjects: StudioProject[],
): StudioProject {
  const existingIds = new Set(existingProjects.map((project) => project.id));
  const normalizedWorkDir = draft.workDir ? normalizeSessionWorkDirForClient(draft.workDir) : undefined;
  const title = cleanLabel(draft.title)
    || projectTitleFromWorkDir(normalizedWorkDir)
    || 'Untitled Project';
  const goal = cleanLabel(draft.goal) || '';
  const draftSpaces = normalizeProjectSpaces(draft.spaces);
  const draftAssistants = normalizeProjectAssistants(draft.assistants);
  const legacySpace = cleanLabel(draft.space);
  const legacyKit = cleanLabel(draft.kit);
  const space = draftSpaces[0]?.label?.trim()
    || draftSpaces[0]?.path
    || legacySpace
    || 'Mind';
  const kits = draftAssistants.length
    ? draftAssistants.map((assistant) => assistant.name?.trim() || assistant.id)
    : [legacyKit].filter((value): value is string => Boolean(value));
  const workArea = cleanLabel(draft.workArea)
    || (normalizedWorkDir
      ? normalizedWorkDir.source === 'mind-root'
        ? 'Mind'
        : normalizedWorkDir.label || (normalizedWorkDir.path ? pathLabel(normalizedWorkDir.path) : 'Mind')
      : 'Session drafts');
  const baseId = slugifyProjectTitle(title);
  let id = baseId;
  let suffix = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    title,
    goal,
    space,
    kits,
    workArea,
    ...(normalizedWorkDir ? { workDir: normalizedWorkDir } : {}),
    ...(draftSpaces.length ? { spaces: draftSpaces } : {}),
    ...(draftAssistants.length ? { assistants: draftAssistants } : {}),
    cadence: 'Project rhythm not set',
    cadenceZh: '尚未设置项目节奏',
    stage: 'draft',
    progress: 12,
    updated: 'Just now',
    nextAction: 'Start the first focused Session.',
    nextActionZh: '开始第一个聚焦 Session。',
    sessions: [],
    reviewItems: ['Define promotion target'],
    reviewItemsZh: ['确定沉淀目标'],
    lessons: ['No reusable lesson yet'],
    lessonsZh: ['暂无可复用经验'],
  };
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readCustomProjects(): StudioProject[] {
  if (!canUseStorage()) return volatileCustomProjects;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return useVolatileProjects ? volatileCustomProjects : [];
    const parsed = JSON.parse(raw) as StudioProject[];
    const projects = Array.isArray(parsed)
      ? parsed.filter((project) => project && typeof project.id === 'string')
      : [];
    volatileCustomProjects = projects;
    useVolatileProjects = false;
    return projects;
  } catch {
    if (useVolatileProjects) return volatileCustomProjects;
    volatileCustomProjects = [];
    return [];
  }
}

function writeCustomProjects(projects: StudioProject[]): void {
  volatileCustomProjects = projects;
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    useVolatileProjects = false;
  } catch {
    useVolatileProjects = true;
    // Keep the in-memory copy so the current client flow can still continue.
  }
}

export function readLastOpenedStudioProjectId(): string | null {
  if (!canUseStorage()) return volatileLastOpenedProjectId;
  try {
    return window.localStorage.getItem(LAST_OPENED_PROJECT_KEY) || volatileLastOpenedProjectId;
  } catch {
    return volatileLastOpenedProjectId;
  }
}

export function markStudioProjectOpened(projectId: string): void {
  const trimmed = projectId.trim();
  if (!trimmed) return;
  volatileLastOpenedProjectId = trimmed;
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(LAST_OPENED_PROJECT_KEY, trimmed);
    } catch {
      // The volatile copy keeps the current tab coherent if storage is blocked.
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STUDIO_PROJECTS_UPDATED_EVENT, { detail: { lastOpenedProjectId: trimmed } }));
  }
}

export function readStudioProjects(): StudioProject[] {
  const seedIds = new Set(STUDIO_PROJECTS.map((project) => project.id));
  const customProjects = readCustomProjects();
  const customById = new Map(customProjects.map((project) => [project.id, project]));
  const customOnlyProjects = customProjects.filter((project) => !seedIds.has(project.id));
  const seedProjects = STUDIO_PROJECTS.map((project) => {
    const override = customById.get(project.id);
    return override ? { ...project, ...override } : project;
  });
  return [...customOnlyProjects, ...seedProjects];
}

function applyProjectDefaultsUpdate(project: StudioProject, updates: StudioProjectDefaultsUpdate): StudioProject {
  const next: StudioProject = { ...project };
  if ('spaces' in updates) {
    const spaces = normalizeProjectSpaces(updates.spaces);
    next.spaces = spaces;
    next.space = spaces.map((space) => space.label?.trim() || pathLabel(space.path)).join(' / ');
    delete next.spaceZh;
  }
  if ('assistants' in updates) {
    const assistants = normalizeProjectAssistants(updates.assistants);
    next.assistants = assistants;
    next.kits = assistants.map((assistant) => assistant.name?.trim() || assistant.id);
  }
  return next;
}

export function updateStudioProjectDefaults(
  projectId: string,
  updates: StudioProjectDefaultsUpdate,
): StudioProject | undefined {
  const currentProject = findStudioProject(readStudioProjects(), projectId);
  if (!currentProject) return undefined;

  const updatedProject = applyProjectDefaultsUpdate(currentProject, updates);
  writeCustomProjects([
    updatedProject,
    ...readCustomProjects().filter((project) => project.id !== projectId),
  ]);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STUDIO_PROJECTS_UPDATED_EVENT, { detail: updatedProject }));
  }
  return updatedProject;
}

export function getLastOpenedStudioProject(
  projects: StudioProject[],
  lastOpenedId = readLastOpenedStudioProjectId(),
): StudioProject | undefined {
  return (lastOpenedId ? findStudioProject(projects, lastOpenedId) : undefined) ?? projects[0];
}

export function createStudioProject(draft: StudioProjectDraft): StudioProject {
  const project = buildStudioProjectFromDraft(draft, readStudioProjects());
  writeCustomProjects([project, ...readCustomProjects()]);
  markStudioProjectOpened(project.id);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STUDIO_PROJECTS_UPDATED_EVENT, { detail: project }));
  }
  return project;
}
