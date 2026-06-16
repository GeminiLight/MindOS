export interface StudioSessionSummary {
  id: string;
  href?: string;
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
  title: string;
  goal: string;
  space: string;
  kit: string;
  workArea: string;
}

const STORAGE_KEY = 'mindos:studio-projects';
let volatileCustomProjects: StudioProject[] = [];
let useVolatileProjects = false;

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
  const title = draft.title.trim() || 'Untitled Project';
  const goal = draft.goal.trim() || 'Define the next durable outcome.';
  const space = draft.space.trim() || 'Mind';
  const kit = draft.kit.trim();
  const workArea = draft.workArea.trim() || 'Session drafts';
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
    kits: [kit].filter(Boolean),
    workArea,
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

export function readStudioProjects(): StudioProject[] {
  const seedIds = new Set(STUDIO_PROJECTS.map((project) => project.id));
  const customProjects = readCustomProjects().filter((project) => !seedIds.has(project.id));
  return [...customProjects, ...STUDIO_PROJECTS];
}

export function createStudioProject(draft: StudioProjectDraft): StudioProject {
  const project = buildStudioProjectFromDraft(draft, readStudioProjects());
  writeCustomProjects([project, ...readCustomProjects()]);
  return project;
}
