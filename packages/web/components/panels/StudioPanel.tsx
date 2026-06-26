'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarClock, FolderOpen, LayoutDashboard, LayoutGrid, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import PanelHeader from './PanelHeader';
import { PANEL_NAV_STACK_CLASS, PanelNavRow } from './PanelNavRow';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import {
  getStudioProjectHref,
  localize,
  readStudioProjects,
  STUDIO_NEW_PROJECT_REQUESTED_EVENT,
  STUDIO_PROJECTS_UPDATED_EVENT,
  type StudioProject,
} from '@/lib/studio-projects';

interface StudioPanelProps {
  active: boolean;
}

const COPY = {
  en: {
    title: 'Studio',
    overview: 'Overview',
    apps: 'Apps',
    automation: 'Automation',
    newProject: 'New Project',
    recentProjects: 'Projects',
  },
  zh: {
    title: '工作台',
    overview: '总览',
    apps: '应用',
    automation: '自动化',
    newProject: '新建项目',
    recentProjects: '项目',
  },
} as const;

function isStudioOverviewPath(pathname: string): boolean {
  return pathname === '/studio' || pathname === '/studio/';
}

function isStudioAutomationPath(pathname: string): boolean {
  return pathname === '/studio/automation' || pathname.startsWith('/studio/automation/');
}

function isStudioAppsPath(pathname: string): boolean {
  return pathname === '/studio/apps' || pathname.startsWith('/studio/apps/');
}

function getProjectIdFromPath(pathname: string): string | null {
  if (isStudioOverviewPath(pathname) || isStudioAutomationPath(pathname) || isStudioAppsPath(pathname)) return null;
  if (!pathname.startsWith('/studio/')) return null;
  const raw = pathname.slice('/studio/'.length).split('/', 1)[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function StudioProjectRow({
  project,
  locale,
  selected,
}: {
  project: StudioProject;
  locale: string;
  selected: boolean;
}) {
  const title = localize(project.title, project.titleZh, locale);

  return (
    <Link
      href={getStudioProjectHref(project.id)}
      className={cn(
        'group relative flex min-w-0 items-center gap-3 px-4 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'bg-[var(--amber-subtle)] text-foreground' : 'text-muted-foreground hover:bg-muted/35 hover:text-foreground',
      )}
      aria-current={selected ? 'page' : undefined}
    >
      {selected ? (
        <span className="pointer-events-none absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-[var(--amber)]" aria-hidden="true" />
      ) : null}
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors',
          selected ? 'text-[var(--amber)]' : 'text-muted-foreground group-hover:text-foreground',
        )}
      >
        <FolderOpen size={14} aria-hidden="true" />
      </span>
      <span className="block min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground" title={title}>
        {title}
      </span>
    </Link>
  );
}

export default function StudioPanel({ active }: StudioPanelProps) {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const pathname = usePathname() ?? '';
  const overviewActive = isStudioOverviewPath(pathname);
  const appsActive = isStudioAppsPath(pathname);
  const automationActive = isStudioAutomationPath(pathname);
  const currentProjectId = getProjectIdFromPath(pathname);
  const [projects, setProjects] = useState<StudioProject[]>(() => readStudioProjects());

  useEffect(() => {
    const syncProjects = () => setProjects(readStudioProjects());
    window.addEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
    window.addEventListener('storage', syncProjects);
    return () => {
      window.removeEventListener(STUDIO_PROJECTS_UPDATED_EVENT, syncProjects);
      window.removeEventListener('storage', syncProjects);
    };
  }, []);

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
      <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto">
        <div className={PANEL_NAV_STACK_CLASS}>
          <PanelNavRow
            href="/studio"
            icon={<LayoutDashboard size={14} aria-hidden="true" />}
            title={copy.overview}
            active={overviewActive}
            activeVariant="rail"
          />
          <PanelNavRow
            href="/studio/apps"
            icon={<LayoutGrid size={14} aria-hidden="true" />}
            title={copy.apps}
            active={appsActive}
            activeVariant="rail"
          />
          <PanelNavRow
            href="/studio/automation"
            icon={<CalendarClock size={14} aria-hidden="true" />}
            title={copy.automation}
            active={automationActive}
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
              return (
                <StudioProjectRow
                  key={project.id}
                  project={project}
                  locale={locale}
                  selected={selected}
                />
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
