'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight, LayoutDashboard, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import PanelHeader from './PanelHeader';
import { PanelNavRow } from './PanelNavRow';
import { STABLE_ROW_DISCLOSURE_SLOT_CLASS } from '@/components/shared/StableRowChrome';
import { refreshSessions, useActiveSessionId, useSessions } from '@/lib/ask-session-store';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import {
  getStudioProjectHref,
  localize,
  readStudioProjects,
  STUDIO_NEW_PROJECT_REQUESTED_EVENT,
  sessionStatusLabel,
  STUDIO_PROJECTS_UPDATED_EVENT,
  type StudioProject,
  type StudioSessionSummary,
} from '@/lib/studio-projects';
import { summarizeChatSession } from '@/components/studio/studio-session-summaries';

interface StudioPanelProps {
  active: boolean;
}

const COPY = {
  en: {
    title: 'Studio',
    overview: 'Overview',
    newProject: 'New Project',
    recentProjects: 'Projects',
    sessions: 'Sessions',
    noSessions: 'No Sessions',
    untitledSession: 'Untitled Session',
    showSessions: 'Show Sessions',
    hideSessions: 'Hide Sessions',
  },
  zh: {
    title: 'Studio',
    overview: 'Overview',
    newProject: '新建 Project',
    recentProjects: 'Projects',
    sessions: 'Sessions',
    noSessions: '暂无 Session',
    untitledSession: '未命名 Session',
    showSessions: '展开 Sessions',
    hideSessions: '收起 Sessions',
  },
} as const;

function getProjectIdFromPath(pathname: string): string | null {
  if (pathname === '/studio' || pathname === '/studio/') return null;
  if (!pathname.startsWith('/studio/')) return null;
  const raw = pathname.slice('/studio/'.length).split('/', 1)[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function StudioSessionRow({
  session,
  locale,
  copy,
}: {
  session: StudioSessionSummary;
  locale: string;
  copy: (typeof COPY)[keyof typeof COPY];
}) {
  const title = localize(session.title, session.titleZh, locale) || copy.untitledSession;
  const content = (
    <>
      <span className="min-w-0 truncate">{title}</span>
      <span className="shrink-0 text-2xs text-muted-foreground/65">
        {sessionStatusLabel(session.status, locale)}
      </span>
    </>
  );

  if (!session.href) {
    return (
      <div className="flex min-h-8 items-center justify-between gap-2 rounded-md px-2 text-xs text-muted-foreground">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={session.href}
      title={title}
      className="flex min-h-8 items-center justify-between gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </Link>
  );
}

function StudioProjectRow({
  project,
  locale,
  copy,
  selected,
  expanded,
  sessions,
  onToggle,
  onSelect,
}: {
  project: StudioProject;
  locale: string;
  copy: (typeof COPY)[keyof typeof COPY];
  selected: boolean;
  expanded: boolean;
  sessions: StudioSessionSummary[];
  onToggle: () => void;
  onSelect: () => void;
}) {
  const title = localize(project.title, project.titleZh, locale);
  const toggleLabel = expanded ? copy.hideSessions : copy.showSessions;

  return (
    <div>
      <div
        className={cn(
          'group relative flex min-w-0 items-center gap-2 px-3 py-1.5 transition-colors',
          selected ? 'bg-[var(--amber-subtle)] text-foreground' : 'hover:bg-muted/35',
        )}
      >
        {selected ? (
          <span className="pointer-events-none absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-[var(--amber)]" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          aria-label={`${toggleLabel}: ${title}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className={cn(
            STABLE_ROW_DISCLOSURE_SLOT_CLASS,
            'rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        </button>
        <Link
          href={getStudioProjectHref(project.id)}
          onClick={onSelect}
          className="flex min-h-8 min-w-0 flex-1 items-center rounded-md px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-current={selected ? 'page' : undefined}
        >
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        </Link>
      </div>

      {expanded ? (
        <div className="ml-10 mt-1 space-y-0.5 border-l border-border/55 pl-2" aria-label={`${title} ${copy.sessions}`}>
          {sessions.length ? (
            sessions.slice(0, 6).map((session) => (
              <StudioSessionRow key={session.id} session={session} locale={locale} copy={copy} />
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-muted-foreground/70">{copy.noSessions}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function StudioPanel({ active }: StudioPanelProps) {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const pathname = usePathname() ?? '';
  const currentProjectId = getProjectIdFromPath(pathname);
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(currentProjectId);
  const chatSessions = useSessions();
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
    if (!active) return;
    setProjects(readStudioProjects());
    void refreshSessions();
  }, [active]);

  useEffect(() => {
    if (currentProjectId) setExpandedProjectId(currentProjectId);
  }, [currentProjectId]);

  const realSessionsByProject = useMemo(() => {
    const map = new Map<string, StudioSessionSummary[]>();
    const sorted = [...chatSessions]
      .filter((session) => session.projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    for (const session of sorted) {
      if (!session.projectId) continue;
      const current = map.get(session.projectId) ?? [];
      current.push(summarizeChatSession(session, activeSessionId, copy.untitledSession));
      map.set(session.projectId, current);
    }

    return map;
  }, [activeSessionId, chatSessions, copy.untitledSession]);

  const sessionsForProject = (project: StudioProject): StudioSessionSummary[] => {
    const realSessions = realSessionsByProject.get(project.id);
    return realSessions?.length ? realSessions : project.sessions;
  };

  return (
    <div className={`flex h-full flex-col ${active ? '' : 'hidden'}`}>
      <PanelHeader title={copy.title}>
        <button
          type="button"
          title={copy.newProject}
          aria-label={copy.newProject}
          onClick={() => window.dispatchEvent(new Event(STUDIO_NEW_PROJECT_REQUESTED_EVENT))}
          className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
        >
          <Plus size={13} aria-hidden="true" />
        </button>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="py-2">
          <PanelNavRow
            href="/studio"
            icon={<LayoutDashboard size={14} aria-hidden="true" />}
            title={copy.overview}
            active={!currentProjectId}
            activeVariant="rail"
          />
        </div>

        <nav className="border-t border-border/60 px-3 py-3" aria-label={copy.recentProjects}>
          <p className="mb-1.5 px-1 text-2xs font-medium uppercase text-muted-foreground/50">
            {copy.recentProjects}
          </p>
          <div className="space-y-1">
            {projects.slice(0, 8).map((project) => {
              const selected = currentProjectId === project.id;
              const expanded = selected || expandedProjectId === project.id;
              return (
                <StudioProjectRow
                  key={project.id}
                  project={project}
                  locale={locale}
                  copy={copy}
                  selected={selected}
                  expanded={expanded}
                  sessions={sessionsForProject(project)}
                  onToggle={() => setExpandedProjectId(expanded ? null : project.id)}
                  onSelect={() => setExpandedProjectId(project.id)}
                />
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
