'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Blocks,
  CalendarClock,
  FolderOpen,
  ScanSearch,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
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
    subtitle: 'Overview for projects, apps, automations, and inspectable context.',
    projectsTitle: 'Projects',
    projectsDesc: 'Keep related notes, conversations, and next steps together.',
    toolsTitle: 'Studio tools',
    appsTitle: 'Apps',
    automationTitle: 'Automation',
    contextTitle: 'Context',
    continueTitle: 'Continue',
    continueHint: 'Best next move',
    openProject: 'Open Project',
    noProject: 'No projects yet.',
    firstProject: 'Set up your first project',
    sessions: 'sessions',
    latestSession: 'Latest Session',
    untitledSession: 'Untitled Session',
  },
  zh: {
    title: '工作台',
    subtitle: '项目、应用、自动化与可检查上下文的总览。',
    projectsTitle: '项目',
    projectsDesc: '把相关笔记、对话和下一步行动放在一起。',
    toolsTitle: '工作台工具',
    appsTitle: '应用',
    automationTitle: '自动化',
    contextTitle: '上下文',
    continueTitle: '继续推进',
    continueHint: '最值得做的下一步',
    openProject: '打开项目',
    noProject: '还没有项目。',
    firstProject: '设置第一个项目',
    sessions: '对话',
    latestSession: '最近对话',
    untitledSession: '未命名对话',
  },
} as const;

type OverviewCopy = (typeof COPY)[keyof typeof COPY];

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
      <section data-studio-overview-continue className="border-b border-border/60 pb-5">
        <h2 className="text-base font-semibold text-foreground">{copy.noProject}</h2>
        <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">{copy.projectsDesc}</p>
        <Button render={<Link href="/studio/projects" />} nativeButton={false} variant="amber" size="xl" className="mt-4 min-h-11">
          {copy.firstProject}<ArrowRight size={15} aria-hidden />
        </Button>
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
  const continueSessionCount = continueProject
    ? projectSessionStats.get(continueProject.id)?.count ?? continueProject.sessions.length
    : 0;
  const toolLinks = [
    ...(projects.length > 0 ? [{ href: '/studio/projects', icon: FolderOpen, label: copy.projectsTitle }] : []),
    { href: '/studio/apps', icon: Blocks, label: copy.appsTitle },
    { href: '/studio/automation', icon: CalendarClock, label: copy.automationTitle },
    { href: '/studio/context', icon: ScanSearch, label: copy.contextTitle },
  ];

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

        <nav aria-label={copy.toolsTitle} className="flex flex-wrap gap-2">
          {toolLinks.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={buttonVariants({
                variant: 'ghost',
                size: 'lg',
                className: 'min-h-11 gap-2 text-muted-foreground',
              })}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </StudioShell>
  );
}
