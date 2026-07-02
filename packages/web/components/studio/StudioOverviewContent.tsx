'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Blocks,
  CalendarClock,
  FolderOpen,
  Sparkles,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { refreshSessions, useSessions } from '@/lib/agent-session-store';
import { useLocale } from '@/lib/stores/locale-store';
import {
  getLastOpenedStudioProject,
  getStudioProjectHref,
  localize,
  readLastOpenedStudioProjectId,
  readStudioProjects,
  STUDIO_PROJECTS_UPDATED_EVENT,
  type StudioProject,
} from '@/lib/studio-projects';
import { getChatSessionTitle } from './studio-session-summaries';
import { StudioShell } from './StudioShell';
import { StudioContextBraid, StudioProjectStage } from './StudioProjectItem';

const COPY = {
  en: {
    title: 'Studio',
    subtitle: 'Overview for projects, apps, and automations.',
    projectsTitle: 'Projects',
    projectsDesc: 'Context, Sessions, and review in one durable project lane.',
    appsTitle: 'Apps',
    appsDesc: 'Focused work surfaces for recurring personal workflows.',
    automationTitle: 'Automation',
    automationDesc: 'Scheduled plans and repeatable agent work.',
    continueTitle: 'Continue',
    continueHint: 'Best next move',
    openProject: 'Open Project',
    viewProjects: 'View Projects',
    openApps: 'Open Apps',
    openAutomation: 'Open Automation',
    noProject: 'No projects yet.',
    sessions: 'sessions',
    reviewItems: 'review',
    latestSession: 'Latest Session',
    untitledSession: 'Untitled Session',
    activeProjects: 'active',
    appCount: '2 apps',
    automationHint: 'plans',
  },
  zh: {
    title: '工作台',
    subtitle: '项目、应用和自动化的总览。',
    projectsTitle: '项目',
    projectsDesc: '把上下文、对话和复盘放进稳定的项目工作流。',
    appsTitle: '应用',
    appsDesc: '面向高频个人工作流的专用工作面。',
    automationTitle: '自动化',
    automationDesc: '定时计划和可重复的 Agent 工作。',
    continueTitle: '继续推进',
    continueHint: '最值得做的下一步',
    openProject: '打开项目',
    viewProjects: '查看项目',
    openApps: '打开应用',
    openAutomation: '打开自动化',
    noProject: '还没有项目。',
    sessions: '对话',
    reviewItems: '待复盘',
    latestSession: '最近对话',
    untitledSession: '未命名对话',
    activeProjects: '推进中',
    appCount: '2 个应用',
    automationHint: '计划',
  },
} as const;

type OverviewCopy = (typeof COPY)[keyof typeof COPY];

function OverviewCard({
  href,
  icon,
  title,
  description,
  meta,
  action,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  meta: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-border/60 bg-background/35 p-4 transition-colors hover:border-border hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          {icon}
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {action}
          <ArrowRight size={13} aria-hidden="true" />
        </span>
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 min-h-[2.5rem] text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-4 border-t border-border/55 pt-3 text-xs font-medium text-muted-foreground">
        {meta}
      </div>
    </Link>
  );
}

function StudioContinueOverview({
  project,
  copy,
  locale,
  latestSessionTitle,
  sessionCount,
}: {
  project: StudioProject | undefined;
  copy: OverviewCopy;
  locale: string;
  latestSessionTitle?: string;
  sessionCount: number;
}) {
  if (!project) {
    return (
      <section data-studio-overview-continue className="border-y border-border/60 py-5">
        <div className="text-sm font-semibold text-foreground">{copy.continueTitle}</div>
        <p className="mt-1 text-sm text-muted-foreground">{copy.noProject}</p>
      </section>
    );
  }

  const title = localize(project.title, project.titleZh, locale);
  const goal = localize(project.goal, project.goalZh, locale);
  const nextAction = localize(project.nextAction, project.nextActionZh, locale);
  const latestSession = latestSessionTitle
    ?? (project.sessions[0] ? localize(project.sessions[0].title, project.sessions[0].titleZh, locale) : copy.untitledSession);

  return (
    <section data-studio-overview-continue className="border-y border-border/60 py-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.46fr)] xl:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
              <Sparkles size={13} aria-hidden="true" />
            </span>
            {copy.continueTitle}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
            <span aria-hidden="true">·</span>
            <span>{copy.latestSession}: {latestSession}</span>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-border/60 bg-background/35 p-4">
          <div className="text-[11px] font-medium text-muted-foreground">{copy.continueHint}</div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{nextAction}</p>
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

export default function StudioOverviewContent() {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());
  const [lastOpenedProjectId, setLastOpenedProjectId] = useState<string | null>(null);
  const chatSessions = useSessions();

  useEffect(() => {
    const syncProjects = () => {
      setProjects(readStudioProjects());
      setLastOpenedProjectId(readLastOpenedStudioProjectId());
    };
    syncProjects();
    void refreshSessions();
    window.addEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
    window.addEventListener('storage', syncProjects);
    return () => {
      window.removeEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
      window.removeEventListener('storage', syncProjects);
    };
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

  const continueProject = useMemo(
    () => getLastOpenedStudioProject(projects, lastOpenedProjectId),
    [lastOpenedProjectId, projects],
  );
  const activeProjects = projects.filter((project) => project.stage === 'active').length;
  const reviewItems = projects.reduce((total, project) => total + project.reviewItems.length, 0);
  const sessionTotal = projects.reduce(
    (total, project) => total + (projectSessionStats.get(project.id)?.count ?? project.sessions.length),
    0,
  );
  const continueSessionCount = continueProject
    ? projectSessionStats.get(continueProject.id)?.count ?? continueProject.sessions.length
    : 0;

  return (
    <StudioShell>
      <div data-studio-overview className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
        <header className="border-b border-border/60 pb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          </div>
        </header>

        <StudioContinueOverview
          project={continueProject}
          copy={copy}
          locale={locale}
          latestSessionTitle={continueProject ? projectSessionStats.get(continueProject.id)?.latestTitle : undefined}
          sessionCount={continueSessionCount}
        />

        <section className="grid gap-4 lg:grid-cols-3" aria-label={copy.title}>
          <OverviewCard
            href="/studio/projects"
            icon={<FolderOpen size={17} aria-hidden="true" />}
            title={copy.projectsTitle}
            description={copy.projectsDesc}
            meta={`${projects.length} ${copy.projectsTitle} · ${activeProjects} ${copy.activeProjects} · ${sessionTotal} ${copy.sessions} · ${reviewItems} ${copy.reviewItems}`}
            action={copy.viewProjects}
          />
          <OverviewCard
            href="/studio/apps"
            icon={<Blocks size={17} aria-hidden="true" />}
            title={copy.appsTitle}
            description={copy.appsDesc}
            meta={copy.appCount}
            action={copy.openApps}
          />
          <OverviewCard
            href="/studio/automation"
            icon={<CalendarClock size={17} aria-hidden="true" />}
            title={copy.automationTitle}
            description={copy.automationDesc}
            meta={copy.automationHint}
            action={copy.openAutomation}
          />
        </section>
      </div>
    </StudioShell>
  );
}
