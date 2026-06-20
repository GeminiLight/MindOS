'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Blocks,
  Clock3,
  FileText,
  FolderOpen,
  MessageSquarePlus,
  Search,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  contextChipLabel,
  contextItemIcon,
  contextPathLabel,
  ContextSelectionRow,
} from '@/components/shared/ContextTokenPicker';
import { StableRowTrailingSlot } from '@/components/shared/StableRowChrome';
import { useLocale } from '@/lib/stores/locale-store';
import { refreshSessions, useActiveSessionId, useSessions } from '@/lib/ask-session-store';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { cn } from '@/lib/utils';
import {
  createStudioProject,
  findStudioProject,
  getStudioProjectHref,
  getStudioProjectAssistantRefs,
  getStudioProjectSpaceRefs,
  getStudioProjectWorkDir,
  getStudioProjectWorkDirLabel,
  localize,
  markStudioProjectOpened,
  readStudioProjects,
  sessionStatusLabel,
  STUDIO_NEW_PROJECT_REQUESTED_EVENT,
  STUDIO_PROJECTS_UPDATED_EVENT,
  updateStudioProjectDefaults,
  type StudioProject,
  type StudioSessionSummary,
  type StudioProjectDraft,
} from '@/lib/studio-projects';
import { summarizeChatSession } from './studio-session-summaries';
import { StudioShell } from './StudioShell';
import StudioNewProjectDialog from './StudioNewProjectDialog';
import {
  assistantFromCandidate,
  buildAssistantCandidates,
  buildSpaceCandidates,
  normalizeAssistants,
  normalizeSpaces,
  spaceFromCandidate,
  studioContextPickerCopy,
  type StudioContextPickerKind,
  type StudioWorkspaceSpace,
} from './studioContextOptions';

const COPY = {
  en: {
    back: 'Studio',
    missingTitle: 'Project not found',
    missingText: 'This Project may have been archived or created in another browser profile.',
    returnStudio: 'Back to Studio',
    newSession: 'New Session',
    historicalSessions: 'Session history',
    sessionsHint: 'Work, artifacts, and review trail.',
    noSessions: 'No Sessions yet.',
    noMatchingSessions: 'No Sessions match this view.',
    untitledSession: 'Untitled Session',
    space: 'Space',
    kits: 'AI Kits',
    directory: 'WorkDir',
    cadence: 'Cadence',
    nextAction: 'Next action',
    overview: 'Overview',
    overviewHint: 'Goal and context defaults for new Sessions.',
    configuration: 'Configuration',
    status: 'Status',
    goal: 'Goal',
    progress: 'Progress',
    searchSessions: 'Search Sessions',
    searchPlaceholder: 'Search title, artifact, or summary',
    filterByAgent: 'Filter by agent',
    allAgents: 'All agents',
    sessionMetric: 'Sessions',
    reviewMetric: 'Review',
    review: 'Review queue',
    growth: 'Growth',
    artifact: 'Artifact',
    updated: 'Updated',
    createTitle: 'New Project',
    createDescription: 'Set the goal, work area, memory, and AI.',
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
    required: 'Add a project name and goal.',
    setupTitle: 'Project setup',
    setupDescription: 'Pick defaults for new Sessions.',
    workAreaDescription: 'The default directory for new Sessions.',
    spaceDescription: 'Long-term context for this Project.',
    kitDescription: 'Default AI capability for new Sessions.',
    customValue: 'Custom value',
    projectDetailsTitle: 'Project details',
    projectDetailsDescription: 'Name it, then set one concrete goal.',
    selectedSummary: 'Selected setup',
    fromRecentProject: 'Recent Project',
  },
  zh: {
    back: '工作台',
    missingTitle: '找不到项目',
    missingText: '这个项目可能已归档，或是在另一个浏览器配置里创建的。',
    returnStudio: '返回工作台',
    newSession: '新建对话',
    historicalSessions: '对话历史',
    sessionsHint: '工作、产物和复盘记录。',
    noSessions: '还没有对话。',
    noMatchingSessions: '没有匹配这个视图的对话。',
    untitledSession: '未命名对话',
    space: '心智空间',
    kits: 'AI Kits',
    directory: 'WorkDir',
    cadence: '节奏',
    nextAction: '下一步',
    overview: '总览',
    overviewHint: '目标，以及新对话默认继承的上下文。',
    configuration: '配置',
    status: '状态',
    goal: '目标',
    progress: '进度',
    searchSessions: '搜索对话',
    searchPlaceholder: '搜索标题、产物或摘要',
    filterByAgent: '按 Agent 过滤',
    allAgents: '全部 Agent',
    sessionMetric: '对话',
    reviewMetric: '待复盘',
    review: 'Review queue',
    growth: '可复用经验',
    artifact: '产物',
    updated: '更新',
    createTitle: '新建项目',
    createDescription: '设定目标、工作区、记忆和 AI。',
    titleLabel: '项目名称',
    goalLabel: '目标',
    spaceLabel: '心智空间',
    kitLabel: 'AI Kit',
    workAreaLabel: 'WorkDir',
    titlePlaceholder: '发布实践',
    goalPlaceholder: '把产品证据整理成发布决策',
    spacePlaceholder: '产品策略',
    kitPlaceholder: 'Research Kit',
    workAreaPlaceholder: '心智',
    cancel: '取消',
    create: '创建项目',
    required: '需要填写项目名称和目标。',
    setupTitle: '项目设置',
    setupDescription: '为新对话选择默认设置。',
    workAreaDescription: '新对话默认使用的工作目录。',
    spaceDescription: '这个项目的长期上下文。',
    kitDescription: '新对话默认使用的 AI 能力。',
    customValue: '自定义',
    projectDetailsTitle: '项目细节',
    projectDetailsDescription: '名称要短，目标要具体。',
    selectedSummary: '已选设置',
    fromRecentProject: '来自近期项目',
  },
} as const;

type ProjectCopy = (typeof COPY)[keyof typeof COPY];

function ProjectContextOverview({
  project,
  projects,
  locale,
  copy,
  goal,
  workspaceSpaces,
  onProjectsChanged,
}: {
  project: StudioProject;
  projects: StudioProject[];
  locale: string;
  copy: ProjectCopy;
  goal: string;
  workspaceSpaces: StudioWorkspaceSpace[];
  onProjectsChanged: () => void;
}) {
  const labels = useMemo(() => studioContextPickerCopy(locale), [locale]);
  const [openPicker, setOpenPicker] = useState<StudioContextPickerKind | null>(null);
  const [spaceQuery, setSpaceQuery] = useState('');
  const [assistantQuery, setAssistantQuery] = useState('');
  const workDir = getStudioProjectWorkDir(project);
  const workDirLabel = getStudioProjectWorkDirLabel(project, locale);
  const workDirTitle = workDir.path || workDir.label || workDirLabel;
  const spaces = useMemo(() => getStudioProjectSpaceRefs(project, locale), [locale, project]);
  const assistants = useMemo(() => getStudioProjectAssistantRefs(project), [project]);
  const spaceCandidates = useMemo(
    () => buildSpaceCandidates(projects, locale, copy.fromRecentProject, workspaceSpaces),
    [copy.fromRecentProject, locale, projects, workspaceSpaces],
  );
  const assistantCandidates = useMemo(
    () => buildAssistantCandidates(projects, locale, copy.fromRecentProject),
    [copy.fromRecentProject, locale, projects],
  );

  const updateSpaces = (nextSpaces: typeof spaces) => {
    updateStudioProjectDefaults(project.id, { spaces: normalizeSpaces(nextSpaces) });
    onProjectsChanged();
  };
  const updateAssistants = (nextAssistants: typeof assistants) => {
    updateStudioProjectDefaults(project.id, { assistants: normalizeAssistants(nextAssistants) });
    onProjectsChanged();
  };
  const getLatestProject = () => findStudioProject(readStudioProjects(), project.id) ?? project;
  const getLatestSpaces = () => getStudioProjectSpaceRefs(getLatestProject(), locale);
  const getLatestAssistants = () => getStudioProjectAssistantRefs(getLatestProject());
  const openCreateSpace = () => {
    setOpenPicker(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('mindos:create-space'));
    }
  };

  return (
    <section className="overflow-visible rounded-xl border border-border/60 bg-card/45" aria-label={copy.configuration}>
      <div className="border-b border-border/60 px-3.5 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Target size={13} aria-hidden="true" />
          <span>{copy.goal}</span>
        </div>
        <p className="max-w-[72ch] text-sm leading-relaxed text-foreground">{goal}</p>
      </div>

      <div data-studio-project-overview-context className="space-y-2.5 px-3.5 py-3">
        <div className="grid gap-1.5 sm:grid-cols-[76px_minmax(0,1fr)] sm:items-start">
          <div className="flex min-h-6 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <FolderOpen size={13} aria-hidden="true" />
            <span>{copy.directory}</span>
          </div>
          <div className="min-w-0">
            <span
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-muted/45 px-1.5 text-[11px] text-foreground"
              title={workDirTitle}
            >
              <FolderOpen size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{workDirLabel}</span>
            </span>
          </div>
        </div>

        <ContextSelectionRow
          kind="studio-project-spaces"
          icon={<BookOpenText size={13} aria-hidden="true" />}
          label={copy.space}
          addTitle={labels.addSpace}
          searchLabel={labels.searchSpaces}
          noMatchesLabel={labels.noMatches}
          query={spaceQuery}
          candidates={spaceCandidates}
          selectedIds={new Set(spaces.map((space) => space.path))}
          open={openPicker === 'spaces'}
          footerAction={{ label: labels.createSpace, onSelect: openCreateSpace }}
          chips={spaces.map((space) => {
            const label = contextChipLabel(space) || contextPathLabel(space.path);
            return {
              id: space.path,
              label,
              icon: space.icon || contextItemIcon(label),
              title: label,
              removeLabel: labels.remove(label),
              onRemove: () => updateSpaces(getLatestSpaces().filter((item) => item.path !== space.path)),
            };
          })}
          onQueryChange={setSpaceQuery}
          onOpenChange={(open) => setOpenPicker(open ? 'spaces' : null)}
          onSelect={(candidate) => {
            updateSpaces([...getLatestSpaces(), spaceFromCandidate(candidate)]);
            setSpaceQuery('');
            setOpenPicker(null);
          }}
        />

        <ContextSelectionRow
          kind="studio-project-assistants"
          icon={<Blocks size={13} aria-hidden="true" />}
          label={copy.kits}
          addTitle={labels.addAssistant}
          searchLabel={labels.searchAssistants}
          noMatchesLabel={labels.noMatches}
          query={assistantQuery}
          candidates={assistantCandidates}
          selectedIds={new Set(assistants.map((assistant) => assistant.id))}
          open={openPicker === 'assistants'}
          chips={assistants.map((assistant) => {
            const label = contextChipLabel(assistant) || assistant.id;
            return {
              id: assistant.id,
              label,
              icon: contextItemIcon(label),
              title: label,
              removeLabel: labels.remove(label),
              onRemove: () => updateAssistants(getLatestAssistants().filter((item) => item.id !== assistant.id)),
            };
          })}
          onQueryChange={setAssistantQuery}
          onOpenChange={(open) => setOpenPicker(open ? 'assistants' : null)}
          onSelect={(candidate) => {
            updateAssistants([...getLatestAssistants(), assistantFromCandidate(candidate)]);
            setAssistantQuery('');
            setOpenPicker(null);
          }}
        />
      </div>
    </section>
  );
}

function sessionAgentName(session: StudioSessionSummary): string {
  return session.agentName?.trim() || 'MindOS';
}

function sessionAgentId(session: StudioSessionSummary): string {
  return session.agentId?.trim() || sessionAgentName(session).toLowerCase().replace(/\s+/g, '-');
}

function SessionRow({
  session,
  locale,
  copy,
  active,
}: {
  session: StudioSessionSummary;
  locale: string;
  copy: ProjectCopy;
  active?: boolean;
}) {
  const title = localize(session.title, session.titleZh, locale);
  const artifact = localize(session.artifact, session.artifactZh, locale);
  const agentName = sessionAgentName(session);
  const dotClass = session.status === 'active'
    ? 'bg-success'
    : session.status === 'review'
      ? 'bg-[var(--amber)]'
      : session.status === 'paused'
        ? 'bg-muted-foreground/55'
        : 'bg-muted-foreground/35';
  const statusDot = <span className={cn('h-2 w-2 rounded-full', dotClass)} title={sessionStatusLabel(session.status, locale)} />;
  const className = cn(
    'group grid gap-3 border-t border-border/60 px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_140px_112px_2.5rem]',
    session.href ? 'transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring' : '',
    active ? 'bg-[var(--amber-subtle)]' : '',
  );
  const content = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</h3>
          <span className="inline-flex h-6 items-center rounded-md border border-border/60 bg-background/70 px-2 text-[11px] font-medium text-muted-foreground">
            {sessionStatusLabel(session.status, locale)}
          </span>
          <span className="inline-flex h-6 max-w-32 items-center rounded-md border border-border/60 bg-background/70 px-2 text-[11px] font-medium text-muted-foreground">
            <span className="truncate">{agentName}</span>
          </span>
        </div>
        <p className="mt-1 max-w-[64ch] text-xs leading-relaxed text-muted-foreground">
          {localize(session.summary, session.summaryZh, locale)}
        </p>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-muted-foreground">{copy.artifact}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-foreground">
          <FileText size={13} className="shrink-0 text-[var(--amber)]" />
          <span className="truncate">{artifact}</span>
        </div>
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted-foreground">{copy.updated}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-foreground">
          <Clock3 size={13} className="text-[var(--amber)]" />
          {session.updated}
        </div>
      </div>
      <StableRowTrailingSlot
        reserveClassName="w-10"
        status={statusDot}
        actions={session.href ? <ArrowRight size={14} className="text-[var(--amber)]" aria-hidden="true" /> : statusDot}
      />
    </>
  );

  if (session.href) {
    return (
      <Link
        href={session.href}
        className={className}
        aria-label={`${title} · ${agentName}`}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={className}>
      {content}
    </div>
  );
}

function MissingProject({ copy }: { copy: ProjectCopy }) {
  return (
    <div className="flex min-h-[calc(100dvh-var(--app-titlebar-h)-5rem)] items-center justify-center">
      <div className="w-full max-w-3xl rounded-xl border border-border/60 bg-card/55 p-6">
        <h1 className="text-2xl font-semibold text-foreground">{copy.missingTitle}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.missingText}</p>
        <Link
          href="/studio"
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--amber)] px-3.5 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={15} />
          {copy.returnStudio}
        </Link>
      </div>
    </div>
  );
}

export default function StudioProjectContent({
  projectId,
  workspaceSpaces = [],
}: {
  projectId: string;
  workspaceSpaces?: StudioWorkspaceSpace[];
}) {
  const push = useSmoothRouterPush();
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());
  const [isCreating, setIsCreating] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();

  useEffect(() => {
    const syncProjects = () => setProjects(readStudioProjects());
    window.addEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
    window.addEventListener('storage', syncProjects);
    return () => {
      window.removeEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
      window.removeEventListener('storage', syncProjects);
    };
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, []);

  useEffect(() => {
    const openCreate = () => setIsCreating(true);
    window.addEventListener(STUDIO_NEW_PROJECT_REQUESTED_EVENT, openCreate);
    return () => window.removeEventListener(STUDIO_NEW_PROJECT_REQUESTED_EVENT, openCreate);
  }, []);

  const project = useMemo(
    () => findStudioProject(projects, projectId) ?? null,
    [projectId, projects],
  );
  const openedProjectId = project?.id;

  useEffect(() => {
    if (openedProjectId) markStudioProjectOpened(openedProjectId);
  }, [openedProjectId]);

  const localized = useMemo(() => {
    if (!project) return null;
    return {
      title: localize(project.title, project.titleZh, locale),
      goal: localize(project.goal, project.goalZh, locale),
    };
  }, [locale, project]);

  const realProjectSessions = useMemo(() => (
    sessions
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => summarizeChatSession(session, activeSessionId, copy.untitledSession))
  ), [activeSessionId, copy.untitledSession, projectId, sessions]);

  const displaySessions = useMemo(() => {
    if (realProjectSessions.length > 0) return realProjectSessions;
    if (!project) return [];
    return project.sessions.map((session) => {
      if (session.href) return session;
      const title = localize(session.title, session.titleZh, locale) || copy.untitledSession;
      const params = new URLSearchParams({
        projectId: project.id,
        title,
      });
      return {
        ...session,
        href: `/chat/new?${params.toString()}`,
      };
    });
  }, [copy.untitledSession, locale, project, realProjectSessions]);

  const agentOptions = useMemo(() => {
    const options = new Map<string, { id: string; label: string; count: number }>();
    for (const session of displaySessions) {
      const id = sessionAgentId(session);
      const existing = options.get(id);
      if (existing) {
        existing.count += 1;
      } else {
        options.set(id, { id, label: sessionAgentName(session), count: 1 });
      }
    }
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [displaySessions]);
  const effectiveAgentFilter = agentFilter === 'all' || agentOptions.some((option) => option.id === agentFilter)
    ? agentFilter
    : 'all';

  const filteredSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase();
    return displaySessions.filter((session) => {
      if (effectiveAgentFilter !== 'all' && sessionAgentId(session) !== effectiveAgentFilter) return false;
      if (!query) return true;
      const haystack = [
        localize(session.title, session.titleZh, locale),
        localize(session.summary, session.summaryZh, locale),
        localize(session.artifact, session.artifactZh, locale),
        sessionAgentName(session),
        sessionStatusLabel(session.status, locale),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [displaySessions, effectiveAgentFilter, locale, sessionSearch]);

  const handleCreate = (draft: StudioProjectDraft) => {
    const nextProject = createStudioProject(draft);
    setProjects(readStudioProjects());
    setIsCreating(false);
    push(getStudioProjectHref(nextProject.id));
  };

  if (!project || !localized) {
    return (
      <StudioShell>
        <MissingProject copy={copy} />
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

  return (
    <StudioShell>
      <div className="min-w-0 space-y-6">
        <header>
          <Link
            href="/studio"
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            {copy.returnStudio}
          </Link>
          <h1 className="min-w-0 text-2xl font-semibold text-foreground">
            {localized.title}
          </h1>
        </header>

        <ProjectContextOverview
          project={project}
          projects={projects}
          locale={locale}
          copy={copy}
          goal={localized.goal}
          workspaceSpaces={workspaceSpaces}
          onProjectsChanged={() => setProjects(readStudioProjects())}
        />

        <section className="overflow-hidden rounded-xl border border-border/60 bg-card/45" aria-labelledby="studio-project-sessions">
          <div className="border-b border-border/60 px-4 py-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="min-w-0">
                <h2 id="studio-project-sessions" className="text-sm font-semibold text-foreground">{copy.historicalSessions}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{copy.sessionsHint}</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
                <label className="relative min-w-0 flex-1 xl:w-72 xl:flex-none">
                  <span className="sr-only">{copy.searchSessions}</span>
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    value={sessionSearch}
                    onChange={(event) => setSessionSearch(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
                <label className="relative sm:w-44">
                  <span className="sr-only">{copy.filterByAgent}</span>
                  <SlidersHorizontal size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <select
                    value={effectiveAgentFilter}
                    onChange={(event) => setAgentFilter(event.target.value)}
                    className="h-9 w-full appearance-none rounded-lg border border-border bg-background pl-8 pr-8 text-sm text-foreground outline-none transition-colors focus-visible:border-[var(--amber)] focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <option value="all">{copy.allAgents}</option>
                    {agentOptions.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.label} ({agent.count})
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  render={<Link href={`/chat/new?projectId=${encodeURIComponent(project.id)}`} />}
                  nativeButton={false}
                  variant="outline"
                  size="lg"
                  className="justify-center"
                >
                  <MessageSquarePlus size={15} aria-hidden="true" />
                  {copy.newSession}
                </Button>
              </div>
            </div>
          </div>
          {filteredSessions.length ? (
            filteredSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                locale={locale}
                copy={copy}
                active={session.id === activeSessionId}
              />
            ))
          ) : (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {displaySessions.length ? copy.noMatchingSessions : copy.noSessions}
            </div>
          )}
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
