'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarClock,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LayoutGrid,
  NotebookTabs,
  Plus,
  Sparkles,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import PanelHeader from './PanelHeader';
import { PanelPrimaryNav, PanelNavRow } from './PanelNavRow';
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
    projects: 'Projects',
    apps: 'Apps',
    automation: 'Automation',
    newProject: 'New Project',
    recentProjects: 'Recent Projects',
    allAutomations: 'All automations',
    appRelationships: 'Relationship Memory',
    appLearning: 'Learning Practice',
    appLaunch: 'Launch Practice',
  },
  zh: {
    title: '工作台',
    overview: '总览',
    projects: '项目',
    apps: '应用',
    automation: '自动化',
    newProject: '新建项目',
    recentProjects: '近期项目',
    allAutomations: '全部自动化',
    appRelationships: '关系记忆',
    appLearning: '学习练习',
    appLaunch: '发布实践',
  },
} as const;

const STUDIO_PANEL_APP_ROWS = [
  {
    id: 'relationships',
    href: '/capture',
    icon: <NotebookTabs size={14} aria-hidden="true" />,
    titleKey: 'appRelationships',
  },
  {
    id: 'learning',
    href: '/echo/growth',
    icon: <GraduationCap size={14} aria-hidden="true" />,
    titleKey: 'appLearning',
  },
  {
    id: 'launch',
    href: '/studio/projects',
    icon: <Sparkles size={14} aria-hidden="true" />,
    titleKey: 'appLaunch',
  },
] as const;

function isStudioOverviewPath(pathname: string): boolean {
  return pathname === '/studio' || pathname === '/studio/';
}

function isStudioProjectsPath(pathname: string): boolean {
  return pathname === '/studio/projects' || pathname.startsWith('/studio/projects/');
}

function isStudioAutomationPath(pathname: string): boolean {
  return pathname === '/studio/automation' || pathname.startsWith('/studio/automation/');
}

function isStudioAppsPath(pathname: string): boolean {
  return pathname === '/studio/apps' || pathname.startsWith('/studio/apps/');
}

function getProjectIdFromPath(pathname: string): string | null {
  if (isStudioOverviewPath(pathname) || isStudioProjectsPath(pathname) || isStudioAutomationPath(pathname) || isStudioAppsPath(pathname)) return null;
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
    <StudioPanelObjectRow
      href={getStudioProjectHref(project.id)}
      icon={<FolderOpen size={14} aria-hidden="true" />}
      title={title}
      selected={selected}
    />
  );
}

function StudioPanelObjectRow({
  href,
  icon,
  title,
  selected = false,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  selected?: boolean;
}) {
  return (
    <Link
      href={href}
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
        {icon}
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
  const projectsActive = isStudioProjectsPath(pathname) || currentProjectId !== null;
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
      <PanelPrimaryNav aria-label={copy.title}>
        <PanelNavRow
          href="/studio"
          icon={<LayoutDashboard size={14} aria-hidden="true" />}
          title={copy.overview}
          active={overviewActive}
          activeVariant="rail"
        />
        <PanelNavRow
          href="/studio/projects"
          icon={<FolderOpen size={14} aria-hidden="true" />}
          title={copy.projects}
          active={projectsActive}
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
      </PanelPrimaryNav>

      <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto">
        {appsActive ? (
          <nav className="px-3 py-3" aria-label={copy.apps}>
            <p className="mb-1.5 px-1 text-2xs font-medium uppercase text-muted-foreground/50">
              {copy.apps}
            </p>
            <div className="space-y-1">
              {STUDIO_PANEL_APP_ROWS.map((app) => (
                <StudioPanelObjectRow
                  key={app.id}
                  href={app.href}
                  icon={app.icon}
                  title={copy[app.titleKey]}
                />
              ))}
            </div>
          </nav>
        ) : automationActive ? (
          <nav className="px-3 py-3" aria-label={copy.automation}>
            <p className="mb-1.5 px-1 text-2xs font-medium uppercase text-muted-foreground/50">
              {copy.automation}
            </p>
            <div className="space-y-1">
              <StudioPanelObjectRow
                href="/studio/automation"
                icon={<CalendarClock size={14} aria-hidden="true" />}
                title={copy.allAutomations}
                selected
              />
            </div>
          </nav>
        ) : (
          <nav className="px-3 py-3" aria-label={copy.recentProjects}>
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
        )}
      </div>
    </div>
  );
}
