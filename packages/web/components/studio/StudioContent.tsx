'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpenText,
  Blocks,
  CheckCircle2,
  FolderOpen,
  ListChecks,
  Plus,
  Target,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { refreshSessions, useSessions } from '@/lib/ask-session-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import {
  createStudioProject,
  getStudioProjectHref,
  localize,
  localizeList,
  readStudioProjects,
  stageLabel,
  STUDIO_NEW_PROJECT_REQUESTED_EVENT,
  type StudioProject,
  type StudioProjectDraft,
} from '@/lib/studio-projects';
import { getChatSessionTitle } from './studio-session-summaries';
import { StudioShell } from './StudioShell';
import StudioNewProjectDialog from './StudioNewProjectDialog';

const COPY = {
  en: {
    title: 'Studio',
    subtitle: 'Projects carry context, sessions, and review.',
    continueTitle: 'Continue',
    continueHint: 'Best next move',
    newProject: 'New Project',
    projects: 'Projects',
    projectsHint: 'Long-running work with memory and review.',
    nextColumn: 'Next',
    sessions: 'sessions',
    activeProjects: 'Active',
    reviewItems: 'Review',
    recentSessions: 'Sessions',
    openProject: 'Open Project',
    latestSession: 'Latest Session',
    reusableLesson: 'Reusable lesson',
    untitledSession: 'Untitled Session',
    review: 'Review',
    loopTitle: 'Practice loop',
    loopSteps: ['Context', 'Session', 'Review', 'Improve'],
    createTitle: 'New Project',
    createDescription: 'Set the goal, work area, memory, and AI.',
    titleLabel: 'Project name',
    goalLabel: 'Goal',
    spaceLabel: 'Mind Space',
    kitLabel: 'AI Kit',
    workAreaLabel: 'Work Area',
    titlePlaceholder: 'Launch practice',
    goalPlaceholder: 'Turn product evidence into launch decisions',
    spacePlaceholder: 'Product Strategy',
    kitPlaceholder: 'Research Kit',
    workAreaPlaceholder: 'Session drafts',
    cancel: 'Cancel',
    create: 'Create Project',
    required: 'Add a project name and goal.',
    empty: 'No projects yet.',
    noSessions: 'No Sessions yet.',
    setupTitle: 'Project setup',
    setupDescription: 'Pick defaults for new Sessions.',
    workAreaDescription: 'Drafts and artifacts land here.',
    spaceDescription: 'Long-term context for this Project.',
    kitDescription: 'Default AI capability for new Sessions.',
    customValue: 'Custom value',
    projectDetailsTitle: 'Project details',
    projectDetailsDescription: 'Name it, then set one concrete goal.',
    selectedSummary: 'Selected setup',
    fromRecentProject: 'Recent Project',
  },
  zh: {
    title: 'Studio',
    subtitle: 'Project 承载上下文、Session 和复盘。',
    continueTitle: '继续推进',
    continueHint: '最值得做的下一步',
    newProject: '新建 Project',
    projects: 'Projects',
    projectsHint: '带记忆和复盘的长期工作。',
    nextColumn: '下一步',
    sessions: 'Sessions',
    activeProjects: '推进中',
    reviewItems: '待复盘',
    recentSessions: '历史 Session',
    openProject: '打开 Project',
    latestSession: '最近 Session',
    reusableLesson: '可复用经验',
    untitledSession: '未命名 Session',
    review: 'Review',
    loopTitle: '实践循环',
    loopSteps: ['上下文', 'Session', '复盘', '改进'],
    createTitle: '新建 Project',
    createDescription: '设定目标、工作区、记忆和 AI。',
    titleLabel: 'Project 名称',
    goalLabel: '目标',
    spaceLabel: 'Mind Space',
    kitLabel: 'AI Kit',
    workAreaLabel: 'Work Area',
    titlePlaceholder: '发布实践',
    goalPlaceholder: '把产品证据整理成发布决策',
    spacePlaceholder: '产品策略',
    kitPlaceholder: 'Research Kit',
    workAreaPlaceholder: 'Session 草稿',
    cancel: '取消',
    create: '创建 Project',
    required: '需要填写 Project 名称和目标。',
    empty: '还没有 Project。',
    noSessions: '还没有 Session。',
    setupTitle: 'Project 设置',
    setupDescription: '为新 Session 选择默认设置。',
    workAreaDescription: '草稿和产物放这里。',
    spaceDescription: '这个 Project 的长期上下文。',
    kitDescription: '新 Session 默认使用的 AI 能力。',
    customValue: '自定义',
    projectDetailsTitle: 'Project 细节',
    projectDetailsDescription: '名称要短，目标要具体。',
    selectedSummary: '已选设置',
    fromRecentProject: '来自近期 Project',
  },
} as const;

type StudioCopy = (typeof COPY)[keyof typeof COPY];

function countReviewItems(projects: StudioProject[]): number {
  return projects.reduce((total, project) => total + project.reviewItems.length, 0);
}

function firstKit(project: StudioProject): string {
  return project.kits[0] ?? 'Basic assistant';
}

function ProjectStage({ project, locale }: { project: StudioProject; locale: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-border/60 bg-background/70 px-2 text-[11px] font-medium text-muted-foreground">
      {stageLabel(project.stage, locale)}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(value, 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-[var(--amber)]" style={{ width: `${width}%` }} />
    </div>
  );
}

function StudioMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background/45 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold text-foreground [font-variant-numeric:tabular-nums]">{value}</div>
      </div>
    </div>
  );
}

function MetaChip({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border/55 bg-background/45 px-2 py-1 text-xs text-muted-foreground">
      <span className="shrink-0 text-[var(--amber)]">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

function ProjectRow({
  project,
  locale,
  copy,
  sessionCount,
  onPreview,
  selected,
}: {
  project: StudioProject;
  locale: string;
  copy: StudioCopy;
  sessionCount: number;
  onPreview: (projectId: string) => void;
  selected: boolean;
}) {
  const title = localize(project.title, project.titleZh, locale);
  const goal = localize(project.goal, project.goalZh, locale);
  const space = localize(project.space, project.spaceZh, locale);
  const workArea = localize(project.workArea, project.workAreaZh, locale);
  const nextAction = localize(project.nextAction, project.nextActionZh, locale);
  const kits = localizeList(project.kits, undefined, locale);

  return (
    <Link
      href={getStudioProjectHref(project.id)}
      onFocus={() => onPreview(project.id)}
      onPointerEnter={() => onPreview(project.id)}
      className={`group relative grid gap-3 border-t border-border/60 px-4 py-3.5 transition-colors first:border-t-0 hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:grid-cols-[minmax(0,1fr)_minmax(190px,0.5fr)_86px] ${
        selected ? 'bg-card/60' : ''
      }`}
    >
      <span className={`pointer-events-none absolute bottom-3 left-0 top-3 w-px rounded-r-full transition-colors group-hover:bg-[var(--amber)] ${
        selected ? 'bg-[var(--amber)]' : 'bg-transparent'
      }`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 text-sm font-semibold text-foreground">{title}</h3>
          <ProjectStage project={project} locale={locale} />
        </div>
        <p className="mt-1 max-w-[58ch] text-xs leading-relaxed text-muted-foreground">{goal}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MetaChip icon={<BookOpenText size={12} aria-hidden="true" />}>{space}</MetaChip>
          <MetaChip icon={<Blocks size={12} aria-hidden="true" />}>{kits.length ? kits.join(' / ') : firstKit(project)}</MetaChip>
          <MetaChip icon={<FolderOpen size={12} aria-hidden="true" />}>{workArea}</MetaChip>
        </div>
      </div>

      <div className="min-w-0 lg:border-l lg:border-border/50 lg:pl-4">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">{copy.nextColumn}</div>
        <p className="text-xs leading-relaxed text-foreground">{nextAction}</p>
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          {sessionCount} {copy.sessions} · {project.updated}
        </p>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 lg:flex-col lg:items-stretch lg:justify-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:block">
          <ProgressBar value={project.progress} />
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground [font-variant-numeric:tabular-nums] lg:mt-2 lg:block lg:text-right">
            {project.progress}%
          </span>
        </div>
        <ArrowRight size={16} className="shrink-0 text-muted-foreground/45 transition-colors group-hover:text-[var(--amber)]" />
      </div>
    </Link>
  );
}

function ProjectOverviewPanel({
  project,
  locale,
  copy,
  latestSessionTitle,
  sessionCount,
  stats,
}: {
  project: StudioProject | undefined;
  locale: string;
  copy: StudioCopy;
  latestSessionTitle?: string;
  sessionCount: number;
  stats: { active: number; review: number; sessions: number };
}) {
  if (!project) {
    return (
      <aside className="rounded-xl border border-border/60 bg-card/45 p-5">
        <div className="text-sm font-semibold text-foreground">{copy.projects}</div>
        <p className="mt-1 text-sm text-muted-foreground">{copy.empty}</p>
      </aside>
    );
  }

  const title = localize(project.title, project.titleZh, locale);
  const goal = localize(project.goal, project.goalZh, locale);
  const space = localize(project.space, project.spaceZh, locale);
  const workArea = localize(project.workArea, project.workAreaZh, locale);
  const nextAction = localize(project.nextAction, project.nextActionZh, locale);
  const kits = localizeList(project.kits, undefined, locale);
  const latestSession = latestSessionTitle
    ?? (project.sessions[0] ? localize(project.sessions[0].title, project.sessions[0].titleZh, locale) : copy.noSessions);

  return (
    <aside className="rounded-xl border border-border/60 bg-card/45 p-4 lg:sticky lg:top-6 lg:self-start">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{copy.continueTitle}</span>
        <ProjectStage project={project} locale={locale} />
        <span className="text-[11px] font-medium text-muted-foreground">{project.updated}</span>
      </div>

      <div className="mt-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{goal}</p>
      </div>

      <div className="mt-4 rounded-lg border border-border/55 bg-background/45 p-3">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-muted-foreground">{copy.continueHint}</span>
          <span className="font-medium text-foreground [font-variant-numeric:tabular-nums]">{project.progress}%</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{nextAction}</p>
        <div className="mt-3">
          <ProgressBar value={project.progress} />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <StudioMetric icon={<Target size={13} aria-hidden="true" />} label={copy.activeProjects} value={stats.active} />
        <StudioMetric icon={<ListChecks size={13} aria-hidden="true" />} label={copy.reviewItems} value={stats.review} />
        <StudioMetric icon={<CheckCircle2 size={13} aria-hidden="true" />} label={copy.recentSessions} value={stats.sessions} />
      </div>

      <div className="mt-4 space-y-1.5">
        <MetaChip icon={<BookOpenText size={12} aria-hidden="true" />}>{space}</MetaChip>
        <MetaChip icon={<Blocks size={12} aria-hidden="true" />}>{kits.length ? kits.join(' / ') : firstKit(project)}</MetaChip>
        <MetaChip icon={<FolderOpen size={12} aria-hidden="true" />}>{workArea}</MetaChip>
      </div>

      <div className="mt-4 border-t border-border/50 pt-3">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">{copy.latestSession}</div>
        <div className="text-sm leading-relaxed text-foreground">{latestSession}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {sessionCount} {copy.sessions}
        </div>
      </div>

      <Button
        render={<Link href={getStudioProjectHref(project.id)} />}
        nativeButton={false}
        variant="outline"
        size="lg"
        className="mt-4 w-full"
      >
        {copy.openProject}
        <ArrowRight size={15} />
      </Button>
    </aside>
  );
}

export default function StudioContent() {
  const push = useSmoothRouterPush();
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());
  const [isCreating, setIsCreating] = useState(false);
  const [previewProjectId, setPreviewProjectId] = useState<string | null>(null);
  const chatSessions = useSessions();

  useEffect(() => {
    setProjects(readStudioProjects());
    void refreshSessions();
  }, []);

  useEffect(() => {
    const openCreate = () => setIsCreating(true);
    window.addEventListener(STUDIO_NEW_PROJECT_REQUESTED_EVENT, openCreate);
    return () => window.removeEventListener(STUDIO_NEW_PROJECT_REQUESTED_EVENT, openCreate);
  }, []);

  const projectSessionStats = useMemo(() => {
    const stats = new Map<string, { count: number; latestTitle?: string }>();
    const sortedSessions = [...chatSessions]
      .filter((session) => session.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const session of sortedSessions) {
      const projectId = session.projectId;
      if (!projectId) continue;
      const previous = stats.get(projectId);
      stats.set(projectId, {
        count: (previous?.count ?? 0) + 1,
        latestTitle: previous?.latestTitle ?? getChatSessionTitle(session, copy.untitledSession),
      });
    }

    return stats;
  }, [chatSessions, copy.untitledSession]);

  const getProjectSessionCount = (project: StudioProject): number => (
    projectSessionStats.get(project.id)?.count ?? project.sessions.length
  );

  const stats = useMemo(
    () => ({
      active: projects.filter((project) => project.stage === 'active').length,
      review: countReviewItems(projects),
      sessions: projects.reduce((total, project) => total + getProjectSessionCount(project), 0),
    }),
    [projectSessionStats, projects],
  );
  const previewProject = useMemo(
    () => projects.find((project) => project.id === previewProjectId) ?? projects[0],
    [previewProjectId, projects],
  );
  const previewProjectIdResolved = previewProject?.id;

  const handleCreate = (draft: StudioProjectDraft) => {
    const project = createStudioProject(draft);
    setProjects(readStudioProjects());
    setIsCreating(false);
    push(getStudioProjectHref(project.id));
  };

  return (
    <StudioShell>
      <div className="min-w-0">
        <header className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-foreground">
                {copy.title}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
            </div>

            <Button
              type="button"
              onClick={() => setIsCreating(true)}
              variant="amber"
              size="xl"
              className="w-fit"
            >
              <Plus size={15} aria-hidden="true" />
              {copy.newProject}
            </Button>
          </div>
        </header>

        <section className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,32rem),1fr))] lg:items-start">
          <div className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/45">
            <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{copy.projects}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{copy.projectsHint}</p>
              </div>
            </div>
            {projects.length ? (
              <div className="max-h-[min(680px,calc(100dvh-14rem))] overflow-y-auto">
                {projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    locale={locale}
                    copy={copy}
                    sessionCount={getProjectSessionCount(project)}
                    onPreview={setPreviewProjectId}
                    selected={project.id === previewProjectIdResolved}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">{copy.empty}</div>
            )}
          </div>
          <ProjectOverviewPanel
            project={previewProject}
            locale={locale}
            copy={copy}
            latestSessionTitle={previewProject ? projectSessionStats.get(previewProject.id)?.latestTitle : undefined}
            sessionCount={previewProject ? getProjectSessionCount(previewProject) : 0}
            stats={stats}
          />
        </section>
      </div>

      <StudioNewProjectDialog
        open={isCreating}
        onClose={() => setIsCreating(false)}
        onCreate={handleCreate}
        copy={copy}
        locale={locale}
        projects={projects}
      />
    </StudioShell>
  );
}
