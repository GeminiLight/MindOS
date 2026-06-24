'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  List,
  ListChecks,
  Plus,
  Search,
  Target,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { refreshSessions, useSessions } from '@/lib/agent-session-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import {
  createStudioProject,
  getLastOpenedStudioProject,
  getStudioProjectHref,
  getStudioProjectAssistantLabels,
  getStudioProjectSpaceLabels,
  getStudioProjectWorkDirLabel,
  localize,
  readLastOpenedStudioProjectId,
  readStudioProjects,
  STUDIO_NEW_PROJECT_REQUESTED_EVENT,
  STUDIO_PROJECTS_UPDATED_EVENT,
  type StudioProject,
  type StudioProjectDraft,
} from '@/lib/studio-projects';
import { getChatSessionTitle } from './studio-session-summaries';
import { StudioShell } from './StudioShell';
import StudioNewProjectDialog from './StudioNewProjectDialog';
import {
  StudioAttentionItem,
  StudioContextBraid,
  StudioProjectItem,
  StudioProjectStage,
} from './StudioProjectItem';
import type { StudioWorkspaceSpace } from './studioContextOptions';

const COPY = {
  en: {
    title: 'Studio',
    subtitle: 'Projects carry context, sessions, and review.',
    continueTitle: 'Continue',
    continueHint: 'Best next move',
    newProject: 'New Project',
    projects: 'Projects',
    sessions: 'sessions',
    searchPlaceholder: 'Search projects...',
    listView: 'List',
    groupedView: 'Grouped',
    statsView: 'Stats',
    allProjects: 'All Projects',
    allProjectsHint: 'All projects in your workspace.',
    needsAttention: 'Needs attention',
    needsAttentionHint: 'Projects with review due or waiting on you.',
    inMotion: 'In motion',
    inMotionHint: 'Active projects with ongoing work.',
    drafts: 'Drafts',
    draftsHint: 'Not started or early stage projects.',
    viewAll: 'View all',
    noMatchingProjects: 'No projects match this search.',
    projectHealth: 'Project health',
    sessionCadence: 'Session cadence',
    reviewLoad: 'Review load',
    contextCoverage: 'Context coverage',
    activityRhythm: 'Activity rhythm',
    stateDistribution: 'State distribution',
    needingAttention: 'Projects needing attention',
    activeLabel: 'Active',
    draftLabel: 'Draft',
    workDirs: 'Work dirs',
    mindSpaces: 'Mind Spaces',
    aiKits: 'AI Kits',
    dueSoon: 'due soon',
    thisWeek: 'this week',
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
    createDescription: 'Set the work area, memory, AI, and an optional goal.',
    titleLabel: 'Project name',
    goalLabel: 'Goal',
    spaceLabel: 'Mind Space',
    kitLabel: 'AI Kit',
    workAreaLabel: 'WorkDir',
    titlePlaceholder: 'Launch practice',
    goalPlaceholder: 'Turn product evidence into launch decisions',
    spacePlaceholder: 'Product Strategy',
    kitPlaceholder: 'Research Kit',
    workAreaPlaceholder: 'Mind',
    cancel: 'Cancel',
    create: 'Create Project',
    required: 'Project name falls back to the WorkDir folder.',
    empty: 'No projects yet.',
    noSessions: 'No Sessions yet.',
    setupTitle: 'Project setup',
    setupDescription: 'Pick defaults for new Sessions.',
    workAreaDescription: 'The default directory for new Sessions.',
    spaceDescription: 'Long-term context for this Project.',
    kitDescription: 'Default AI capability for new Sessions.',
    customValue: 'Custom value',
    projectDetailsTitle: 'Project details',
    projectDetailsDescription: 'Name is optional; blank uses the WorkDir folder. Goal is optional.',
    selectedSummary: 'Selected setup',
    fromRecentProject: 'Recent Project',
  },
  zh: {
    title: '工作台',
    subtitle: '项目承载上下文、对话和复盘。',
    continueTitle: '继续推进',
    continueHint: '最值得做的下一步',
    newProject: '新建项目',
    projects: '项目',
    sessions: '对话',
    searchPlaceholder: '搜索项目...',
    listView: '列表',
    groupedView: '分组',
    statsView: '统计',
    allProjects: '全部项目',
    allProjectsHint: '工作区中的全部项目。',
    needsAttention: '需要关注',
    needsAttentionHint: '等待复盘或需要你处理的项目。',
    inMotion: '推进中',
    inMotionHint: '正在发生工作的项目。',
    drafts: '草稿',
    draftsHint: '还没开始或早期阶段的项目。',
    viewAll: '查看全部',
    noMatchingProjects: '没有匹配的项目。',
    projectHealth: '项目健康度',
    sessionCadence: '对话节奏',
    reviewLoad: '复盘负载',
    contextCoverage: '上下文覆盖',
    activityRhythm: '活动节奏',
    stateDistribution: '状态分布',
    needingAttention: '需要关注的项目',
    activeLabel: '推进中',
    draftLabel: '草稿',
    workDirs: '工作目录',
    mindSpaces: '心智空间',
    aiKits: 'AI 套件',
    dueSoon: '即将到期',
    thisWeek: '本周',
    activeProjects: '推进中',
    reviewItems: '待复盘',
    recentSessions: '历史对话',
    openProject: '打开项目',
    latestSession: '最近对话',
    reusableLesson: '可复用经验',
    untitledSession: '未命名对话',
    review: '复盘',
    loopTitle: '实践循环',
    loopSteps: ['上下文', '对话', '复盘', '改进'],
    createTitle: '新建项目',
    createDescription: '设定工作目录、记忆和 AI；目标可选。',
    titleLabel: '项目名称',
    goalLabel: '目标',
    spaceLabel: '心智空间',
    kitLabel: 'AI 套件',
    workAreaLabel: '工作目录',
    titlePlaceholder: '发布实践',
    goalPlaceholder: '把产品证据整理成发布决策',
    spacePlaceholder: '产品策略',
    kitPlaceholder: '研究套件',
    workAreaPlaceholder: '心智',
    cancel: '取消',
    create: '创建项目',
    required: '项目名称为空时会使用工作目录名称。',
    empty: '还没有项目。',
    noSessions: '还没有对话。',
    setupTitle: '项目设置',
    setupDescription: '为新对话选择默认设置。',
    workAreaDescription: '新对话默认使用的工作目录。',
    spaceDescription: '这个项目的长期上下文。',
    kitDescription: '新对话默认使用的 AI 能力。',
    customValue: '自定义',
    projectDetailsTitle: '项目细节',
    projectDetailsDescription: '名称可留空，默认使用工作目录名称；目标可选。',
    selectedSummary: '已选设置',
    fromRecentProject: '来自近期项目',
  },
} as const;

type StudioCopy = (typeof COPY)[keyof typeof COPY];
type StudioOverviewView = 'list' | 'grouped' | 'stats';

function countReviewItems(projects: StudioProject[]): number {
  return projects.reduce((total, project) => total + project.reviewItems.length, 0);
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

function ViewSwitch({
  value,
  onChange,
  copy,
}: {
  value: StudioOverviewView;
  onChange: (view: StudioOverviewView) => void;
  copy: StudioCopy;
}) {
  const views: Array<{ id: StudioOverviewView; label: string; icon: ReactNode }> = [
    { id: 'list', label: copy.listView, icon: <List size={14} aria-hidden="true" /> },
    { id: 'grouped', label: copy.groupedView, icon: <ListChecks size={14} aria-hidden="true" /> },
    { id: 'stats', label: copy.statsView, icon: <BarChart3 size={14} aria-hidden="true" /> },
  ];

  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-background/55 p-1" role="tablist" aria-label="Studio view">
      {views.map((view) => (
        <button
          key={view.id}
          type="button"
          role="tab"
          aria-selected={value === view.id}
          onClick={() => onChange(view.id)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === view.id
              ? 'bg-[var(--amber-subtle)] text-[var(--amber)] shadow-sm'
              : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'
          }`}
        >
          {view.icon}
          {view.label}
        </button>
      ))}
    </div>
  );
}

function projectMatches(project: StudioProject, query: string, locale: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const fields = [
    localize(project.title, project.titleZh, locale),
    localize(project.goal, project.goalZh, locale),
    ...getStudioProjectSpaceLabels(project, locale),
    getStudioProjectWorkDirLabel(project, locale),
    localize(project.nextAction, project.nextActionZh, locale),
    ...getStudioProjectAssistantLabels(project),
  ];
  return fields.some((field) => field.toLowerCase().includes(normalized));
}

function ContinueNextPanel({
  project,
  locale,
  copy,
  latestSessionTitle,
  sessionCount,
}: {
  project: StudioProject | undefined;
  locale: string;
  copy: StudioCopy;
  latestSessionTitle?: string;
  sessionCount: number;
}) {
  if (!project) {
    return (
    <section data-studio-continue-panel className="rounded-xl border border-border/60 bg-card/45 p-5">
        <div className="text-sm font-semibold text-foreground">{copy.projects}</div>
        <p className="mt-1 text-sm text-muted-foreground">{copy.empty}</p>
      </section>
    );
  }

  const title = localize(project.title, project.titleZh, locale);
  const goal = localize(project.goal, project.goalZh, locale);
  const nextAction = localize(project.nextAction, project.nextActionZh, locale);
  const latestSession = latestSessionTitle
    ?? (project.sessions[0] ? localize(project.sessions[0].title, project.sessions[0].titleZh, locale) : copy.noSessions);

  return (
    <section data-studio-continue-panel className="overflow-hidden rounded-xl border border-border/60 bg-card/45">
      <div className="border-b border-border/55 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
            <ArrowRight size={14} aria-hidden="true" />
          </span>
          {copy.continueTitle}
        </div>
      </div>

      <div className="grid gap-5 px-4 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">{title}</h2>
            <StudioProjectStage project={project} locale={locale} />
            <span className="text-[11px] font-medium text-muted-foreground">{project.updated}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{goal}</p>
          <div className="mt-4">
            <StudioContextBraid project={project} locale={locale} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>{sessionCount} {copy.sessions}</span>
            <span aria-hidden="true">/</span>
            <span>{copy.latestSession}: {latestSession}</span>
          </div>
        </div>

        <div className="min-w-0 border-border/55 xl:border-l xl:pl-5">
          <div className="text-[11px] font-medium text-muted-foreground">{copy.continueHint}</div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{nextAction}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <ProgressBar value={project.progress} />
            </div>
            <span className="text-[11px] font-medium text-muted-foreground [font-variant-numeric:tabular-nums]">
              {project.progress}%
            </span>
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
        </div>
      </div>
    </section>
  );
}

function StudioListView({
  projects,
  locale,
  copy,
  getProjectSessionCount,
  selectedProjectId,
}: {
  projects: StudioProject[];
  locale: string;
  copy: StudioCopy;
  getProjectSessionCount: (project: StudioProject) => number;
  selectedProjectId?: string;
}) {
  return (
    <>
      {projects.length ? (
        <div>
          {projects.map((project) => (
            <StudioProjectItem
              key={project.id}
              project={project}
              locale={locale}
              sessionCount={getProjectSessionCount(project)}
              selected={project.id === selectedProjectId}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">{copy.noMatchingProjects}</div>
      )}
    </>
  );
}

function StudioGroupedView({
  projects,
  locale,
  copy,
  getProjectSessionCount,
  selectedProjectId,
}: {
  projects: StudioProject[];
  locale: string;
  copy: StudioCopy;
  getProjectSessionCount: (project: StudioProject) => number;
  selectedProjectId?: string;
}) {
  const groups = [
    {
      key: 'needs-attention',
      title: copy.needsAttention,
      hint: copy.needsAttentionHint,
      tone: 'bg-[var(--amber)]',
      projects: projects.filter((project) => project.stage === 'review'),
    },
    {
      key: 'in-motion',
      title: copy.inMotion,
      hint: copy.inMotionHint,
      tone: 'bg-success',
      projects: projects.filter((project) => project.stage === 'active'),
    },
    {
      key: 'drafts',
      title: copy.drafts,
      hint: copy.draftsHint,
      tone: 'bg-muted-foreground/50',
      projects: projects.filter((project) => project.stage === 'draft'),
    },
  ];

  return (
    <div>
      {groups.map((group) => (
        <section key={group.key} className="border-t border-border/60 first:border-t-0" aria-labelledby={`studio-group-${group.key}`}>
          <div className="flex items-center justify-between gap-4 border-b border-border/50 bg-background/25 px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className={`h-2 w-2 rounded-full ${group.tone}`} aria-hidden="true" />
              <h2 id={`studio-group-${group.key}`} className="text-sm font-semibold text-foreground">{group.title}</h2>
              <span className="rounded-md bg-muted/55 px-2 py-0.5 text-[11px] font-medium text-muted-foreground [font-variant-numeric:tabular-nums]">
                {group.projects.length}
              </span>
              <p className="text-xs text-muted-foreground">{group.hint}</p>
            </div>
            <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground md:inline-flex">
              {copy.viewAll}
              <ArrowRight size={13} aria-hidden="true" />
            </span>
          </div>
          {group.projects.length ? (
            <div>
              {group.projects.map((project) => (
                <StudioProjectItem
                  key={project.id}
                  project={project}
                  locale={locale}
                  sessionCount={getProjectSessionCount(project)}
                  selected={project.id === selectedProjectId}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground">{copy.noMatchingProjects}</div>
          )}
        </section>
      ))}
    </div>
  );
}

function StudioProjectsSurface({
  projects,
  locale,
  copy,
  getProjectSessionCount,
  selectedProjectId,
  view,
  onViewChange,
}: {
  projects: StudioProject[];
  locale: string;
  copy: StudioCopy;
  getProjectSessionCount: (project: StudioProject) => number;
  selectedProjectId?: string;
  view: StudioOverviewView;
  onViewChange: (view: StudioOverviewView) => void;
}) {
  return (
    <section
      data-studio-projects-surface
      className="overflow-hidden rounded-xl border border-border/60 bg-card/45"
      aria-labelledby="studio-projects-list"
    >
      <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 id="studio-projects-list" className="text-sm font-semibold text-foreground">{copy.allProjects}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{copy.allProjectsHint}</p>
        </div>
        <ViewSwitch value={view} onChange={onViewChange} copy={copy} />
      </div>

      {view === 'list' ? (
        <StudioListView
          projects={projects}
          locale={locale}
          copy={copy}
          getProjectSessionCount={getProjectSessionCount}
          selectedProjectId={selectedProjectId}
        />
      ) : null}

      {view === 'grouped' ? (
        <StudioGroupedView
          projects={projects}
          locale={locale}
          copy={copy}
          getProjectSessionCount={getProjectSessionCount}
          selectedProjectId={selectedProjectId}
        />
      ) : null}

      {view === 'stats' ? (
        <div className="p-4">
          <StudioStatsView
            projects={projects}
            locale={locale}
            copy={copy}
            getProjectSessionCount={getProjectSessionCount}
          />
        </div>
      ) : null}
    </section>
  );
}

function countValues(values: string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function StudioStatsView({
  projects,
  locale,
  copy,
  getProjectSessionCount,
}: {
  projects: StudioProject[];
  locale: string;
  copy: StudioCopy;
  getProjectSessionCount: (project: StudioProject) => number;
}) {
  const activeCount = projects.filter((project) => project.stage === 'active').length;
  const draftCount = projects.filter((project) => project.stage === 'draft').length;
  const reviewItemCount = countReviewItems(projects);
  const reviewProjects = projects.filter((project) => project.stage === 'review');
  const sessionTotal = projects.reduce((total, project) => total + getProjectSessionCount(project), 0);
  const maxSessions = Math.max(1, ...projects.map((project) => getProjectSessionCount(project)));
  const workAreas = countValues(projects.map((project) => getStudioProjectWorkDirLabel(project, locale)));
  const spaces = countValues(projects.flatMap((project) => getStudioProjectSpaceLabels(project, locale)));
  const kits = countValues(projects.flatMap((project) => getStudioProjectAssistantLabels(project)));
  const attentionProjects = reviewProjects.length ? reviewProjects : projects.filter((project) => project.reviewItems.length > 0).slice(0, 2);

  return (
    <section className="space-y-5" aria-label={copy.statsView}>
      <div className="grid gap-3 md:grid-cols-3">
        <StudioMetric icon={<Target size={13} aria-hidden="true" />} label={copy.projectHealth} value={`${projects.length} / ${reviewItemCount} ${copy.dueSoon}`} />
        <StudioMetric icon={<CheckCircle2 size={13} aria-hidden="true" />} label={copy.sessionCadence} value={`${sessionTotal} / ${copy.thisWeek}`} />
        <StudioMetric icon={<ListChecks size={13} aria-hidden="true" />} label={copy.reviewLoad} value={reviewItemCount} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="rounded-xl border border-border/60 bg-card/45 p-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-foreground">{copy.activityRhythm}</h2>
            <span className="text-[11px] text-muted-foreground">14d</span>
          </div>
          <div className="mt-5 flex h-36 items-end gap-2 border-b border-border/50 pb-3">
            {projects.concat(projects).slice(0, 8).map((project, index) => {
              const count = getProjectSessionCount(project);
              const height = 18 + (count / maxSessions) * 92;
              return (
                <div key={`${project.id}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md bg-[var(--amber)]/75"
                    style={{ height: `${height}px` }}
                    title={`${localize(project.title, project.titleZh, locale)}: ${count} ${copy.sessions}`}
                  />
                  <span className="text-[10px] text-muted-foreground [font-variant-numeric:tabular-nums]">{index + 1}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/45 p-4">
          <h2 className="text-sm font-semibold text-foreground">{copy.stateDistribution}</h2>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="flex h-full">
              <span className="bg-success" style={{ width: `${(activeCount / Math.max(projects.length, 1)) * 100}%` }} />
              <span className="bg-[var(--amber)]" style={{ width: `${(reviewProjects.length / Math.max(projects.length, 1)) * 100}%` }} />
              <span className="bg-muted-foreground/35" style={{ width: `${(draftCount / Math.max(projects.length, 1)) * 100}%` }} />
            </div>
          </div>
          <div className="mt-4 space-y-2 text-xs text-muted-foreground">
            <div className="flex justify-between"><span>{copy.activeLabel}</span><span>{activeCount}</span></div>
            <div className="flex justify-between"><span>{copy.review}</span><span>{reviewProjects.length}</span></div>
            <div className="flex justify-between"><span>{copy.draftLabel}</span><span>{draftCount}</span></div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl border border-border/60 bg-card/45 p-4">
          <h2 className="text-sm font-semibold text-foreground">{copy.contextCoverage}</h2>
          <div className="mt-4 grid gap-3">
            {[
              [copy.workDirs, workAreas],
              [copy.mindSpaces, spaces],
              [copy.aiKits, kits],
            ].map(([label, values]) => (
              <div key={label as string} className="rounded-lg border border-border/50 bg-background/40 p-3">
                <div className="mb-2 text-[11px] font-medium text-muted-foreground">{label as string}</div>
                <div className="flex flex-wrap gap-1.5">
                  {(values as Array<{ value: string; count: number }>).slice(0, 4).map((item) => (
                    <span key={item.value} className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                      {item.value}
                      <span className="text-[10px] [font-variant-numeric:tabular-nums]">{item.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/45">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">{copy.needingAttention}</h2>
          </div>
          {attentionProjects.length ? (
            attentionProjects.map((project) => (
              <StudioAttentionItem
                key={project.id}
                project={project}
                locale={locale}
                sessionCount={getProjectSessionCount(project)}
              />
            ))
          ) : (
            <div className="px-4 py-8 text-sm text-muted-foreground">{copy.empty}</div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function StudioContent({
  workspaceSpaces = [],
}: {
  workspaceSpaces?: StudioWorkspaceSpace[];
} = {}) {
  const push = useSmoothRouterPush();
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());
  const [isCreating, setIsCreating] = useState(false);
  const [view, setView] = useState<StudioOverviewView>('list');
  const [query, setQuery] = useState('');
  const [lastOpenedProjectId, setLastOpenedProjectId] = useState<string | null>(null);
  const chatSessions = useSessions();

  useEffect(() => {
    const syncProjects = () => {
      setProjects(readStudioProjects());
      setLastOpenedProjectId(readLastOpenedStudioProjectId());
    };
    syncProjects();
    void refreshSessions();
    window.addEventListener(STUDIO_NEW_PROJECT_REQUESTED_EVENT, syncProjects);
    window.addEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
    window.addEventListener('storage', syncProjects);
    return () => {
      window.removeEventListener(STUDIO_NEW_PROJECT_REQUESTED_EVENT, syncProjects);
      window.removeEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
      window.removeEventListener('storage', syncProjects);
    };
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

  const filteredProjects = useMemo(
    () => projects.filter((project) => projectMatches(project, query, locale)),
    [locale, projects, query],
  );
  const continueProject = useMemo(
    () => getLastOpenedStudioProject(projects, lastOpenedProjectId),
    [lastOpenedProjectId, projects],
  );
  const continueProjectId = continueProject?.id;

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
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-foreground">
                {copy.title}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
            </div>

            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
              <label className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
                <span className="sr-only">{copy.searchPlaceholder}</span>
                <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="h-10 w-full rounded-lg border border-border/60 bg-background/55 pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                />
              </label>
              <Button
                type="button"
                onClick={() => setIsCreating(true)}
                variant="amber"
                size="lg"
                className="shrink-0"
              >
                <Plus size={15} aria-hidden="true" />
                {copy.newProject}
              </Button>
            </div>
          </div>
        </header>

        <section className="space-y-5">
          <ContinueNextPanel
            project={continueProject}
            locale={locale}
            copy={copy}
            latestSessionTitle={continueProject ? projectSessionStats.get(continueProject.id)?.latestTitle : undefined}
            sessionCount={continueProject ? getProjectSessionCount(continueProject) : 0}
          />

          <StudioProjectsSurface
            projects={filteredProjects}
            locale={locale}
            copy={copy}
            getProjectSessionCount={getProjectSessionCount}
            selectedProjectId={continueProjectId}
            view={view}
            onViewChange={setView}
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
        workspaceSpaces={workspaceSpaces}
      />
    </StudioShell>
  );
}
