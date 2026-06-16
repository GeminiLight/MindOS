'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  ListChecks,
  MessageSquarePlus,
  Target,
  Zap,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import type { ChatSession, Message } from '@/lib/types';
import { getMessages, hasMessages } from '@/lib/ask-run-store';
import { refreshSessions, useActiveSessionId, useSessions } from '@/lib/ask-session-store';
import {
  findStudioProject,
  localize,
  localizeList,
  readStudioProjects,
  sessionStatusLabel,
  stageLabel,
  type StudioProject,
  type StudioSessionSummary,
} from '@/lib/studio-projects';

const COPY = {
  en: {
    back: 'Studio',
    missingTitle: 'Project not found',
    missingText: 'This Project may have been archived or created in another browser profile.',
    returnStudio: 'Back to Studio',
    newSession: 'New Session',
    sessions: 'Historical Sessions',
    sessionsHint: 'Each Session keeps its own messages, artifacts, runs, and review items.',
    noSessions: 'No Sessions yet.',
    context: 'Context',
    space: 'Space',
    kits: 'AI Kits',
    workArea: 'Work Area',
    cadence: 'Cadence',
    nextAction: 'Next action',
    progress: 'Progress',
    sessionMetric: 'Sessions',
    reviewMetric: 'Review',
    kitMetric: 'Kits',
    stageMetric: 'Stage',
    review: 'Review queue',
    growth: 'Growth',
    artifact: 'Artifact',
    status: 'Status',
    updated: 'Updated',
  },
  zh: {
    back: 'Studio',
    missingTitle: '找不到 Project',
    missingText: '这个 Project 可能已归档，或是在另一个浏览器配置里创建的。',
    returnStudio: '返回 Studio',
    newSession: '新建 Session',
    sessions: '历史 Sessions',
    sessionsHint: '每个 Session 独立保存 messages、artifacts、runs 和 review items。',
    noSessions: '还没有 Session。',
    context: '上下文',
    space: 'Space',
    kits: 'AI Kits',
    workArea: 'Work Area',
    cadence: '节奏',
    nextAction: '下一步',
    progress: '进度',
    sessionMetric: 'Sessions',
    reviewMetric: '待复盘',
    kitMetric: 'AI Kits',
    stageMetric: '阶段',
    review: 'Review queue',
    growth: '可复用经验',
    artifact: '产物',
    status: '状态',
    updated: '更新',
  },
} as const;

type ProjectCopy = (typeof COPY)[keyof typeof COPY];

function sessionMessages(session: ChatSession): Message[] {
  return hasMessages(session.id) ? getMessages(session.id) : session.messages;
}

function chatSessionTitle(session: ChatSession): string {
  if (session.title?.trim()) return session.title.trim();
  const firstUser = sessionMessages(session).find((message) => message.role === 'user');
  const text = firstUser?.content.replace(/\s+/g, ' ').trim();
  if (!text) return 'Untitled Session';
  return text.length > 56 ? `${text.slice(0, 56)}...` : text;
}

function chatSessionSummary(session: ChatSession): string {
  const messages = sessionMessages(session);
  const last = [...messages].reverse().find((message) => message.content.trim());
  const text = last?.content.replace(/\s+/g, ' ').trim();
  if (!text) return 'Project-scoped chat session is ready for focused work.';
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function formatSessionUpdated(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusFromChatSession(session: ChatSession, activeSessionId: string | null): StudioSessionSummary['status'] {
  if (session.id === activeSessionId) return 'active';
  if (sessionMessages(session).length === 0) return 'paused';
  return 'done';
}

function summarizeChatSession(session: ChatSession, activeSessionId: string | null): StudioSessionSummary {
  return {
    id: session.id,
    href: `/chat/${encodeURIComponent(session.id)}`,
    title: chatSessionTitle(session),
    status: statusFromChatSession(session, activeSessionId),
    updated: formatSessionUpdated(session.updatedAt),
    artifact: session.currentFile ?? 'Chat session',
    summary: chatSessionSummary(session),
  };
}

function ProgressBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(value, 100));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-[var(--amber)]" style={{ width: `${width}%` }} />
    </div>
  );
}

function ScopeRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-border/50 py-3 first:border-t-0">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-sm leading-relaxed text-foreground">{value}</div>
      </div>
    </div>
  );
}

function ProjectMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-border/55 bg-card/45 px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 text-lg font-semibold text-foreground [font-variant-numeric:tabular-nums]">{value}</div>
    </div>
  );
}

function SessionRow({
  session,
  locale,
  copy,
}: {
  session: StudioSessionSummary;
  locale: string;
  copy: ProjectCopy;
}) {
  const className = 'grid gap-3 border-t border-border/60 px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_150px_120px]';
  const content = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{localize(session.title, session.titleZh, locale)}</h3>
          <span className="inline-flex h-6 items-center rounded-md border border-border/60 bg-background/70 px-2 text-[11px] font-medium text-muted-foreground">
            {sessionStatusLabel(session.status, locale)}
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
          <span className="truncate">{localize(session.artifact, session.artifactZh, locale)}</span>
        </div>
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted-foreground">{copy.updated}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-foreground">
          <Clock3 size={13} className="text-[var(--amber)]" />
          {session.updated}
        </div>
      </div>
    </>
  );

  if (session.href) {
    return (
      <Link
        href={session.href}
        className={`${className} group transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
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
    <main className="min-h-[calc(100dvh-var(--app-titlebar-h))] overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-[calc(100dvh-var(--app-titlebar-h))] w-full max-w-3xl flex-col justify-center px-5 py-10 md:px-8">
        <div className="rounded-xl border border-border/60 bg-card/55 p-6">
          <h1 className="font-display text-2xl font-semibold text-foreground">{copy.missingTitle}</h1>
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
    </main>
  );
}

export default function StudioProjectContent({ projectId }: { projectId: string }) {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [project, setProject] = useState<StudioProject | null>(() => findStudioProject(readStudioProjects(), projectId) ?? null);
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();

  useEffect(() => {
    setProject(findStudioProject(readStudioProjects(), projectId) ?? null);
  }, [projectId]);

  useEffect(() => {
    void refreshSessions();
  }, []);

  const localized = useMemo(() => {
    if (!project) return null;
    return {
      title: localize(project.title, project.titleZh, locale),
      goal: localize(project.goal, project.goalZh, locale),
      space: localize(project.space, project.spaceZh, locale),
      workArea: localize(project.workArea, project.workAreaZh, locale),
      cadence: localize(project.cadence, project.cadenceZh, locale),
      nextAction: localize(project.nextAction, project.nextActionZh, locale),
      kits: localizeList(project.kits, undefined, locale),
      reviewItems: localizeList(project.reviewItems, project.reviewItemsZh, locale),
      lessons: localizeList(project.lessons, project.lessonsZh, locale),
    };
  }, [locale, project]);

  const realProjectSessions = useMemo(() => (
    sessions
      .filter((session) => session.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((session) => summarizeChatSession(session, activeSessionId))
  ), [activeSessionId, projectId, sessions]);

  if (!project || !localized) {
    return <MissingProject copy={copy} />;
  }

  const displaySessions = realProjectSessions.length > 0 ? realProjectSessions : project.sessions;

  return (
    <main className="min-h-[calc(100dvh-var(--app-titlebar-h))] overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-6 px-5 py-6 md:px-8 lg:px-10">
        <header className="border-b border-border/60 pb-6">
          <Link
            href="/studio"
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={15} />
            {copy.back}
          </Link>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 items-center rounded-md border border-border/60 bg-card/70 px-2 text-[11px] font-medium text-muted-foreground">
                  {stageLabel(project.stage, locale)}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">{project.updated}</span>
              </div>
              <h1 className="font-display text-3xl font-semibold tracking-normal text-foreground md:text-4xl">
                {localized.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{localized.goal}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href={`/chat/new?projectId=${encodeURIComponent(project.id)}`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--amber)] px-3.5 text-sm font-medium text-[var(--amber-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MessageSquarePlus size={15} />
                {copy.newSession}
              </Link>
              <div className="rounded-lg border border-border/60 bg-card/55 px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{copy.progress}</span>
                  <span className="font-medium text-foreground [font-variant-numeric:tabular-nums]">{project.progress}%</span>
                </div>
                <div className="mt-2">
                  <ProgressBar value={project.progress} />
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ProjectMetric icon={<MessageSquarePlus size={13} />} label={copy.sessionMetric} value={displaySessions.length} />
          <ProjectMetric icon={<ListChecks size={13} />} label={copy.reviewMetric} value={project.reviewItems.length} />
          <ProjectMetric icon={<Zap size={13} />} label={copy.kitMetric} value={localized.kits.length || 1} />
          <ProjectMetric icon={<Target size={13} />} label={copy.stageMetric} value={stageLabel(project.stage, locale)} />
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <section className="overflow-hidden rounded-xl border border-border/60 bg-card/45">
              <div className="border-b border-border/60 px-4 py-4">
                <h2 className="text-sm font-semibold text-foreground">{copy.sessions}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{copy.sessionsHint}</p>
              </div>
              {displaySessions.length ? (
                displaySessions.map((session) => (
                  <SessionRow key={session.id} session={session} locale={locale} copy={copy} />
                ))
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">{copy.noSessions}</div>
              )}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-card/45 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ListChecks size={15} className="text-[var(--amber)]" />
                  <h2 className="text-sm font-semibold text-foreground">{copy.review}</h2>
                </div>
                <div className="space-y-2">
                  {localized.reviewItems.map((item) => (
                    <div key={item} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[var(--amber)]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-card/45 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Target size={15} className="text-[var(--amber)]" />
                  <h2 className="text-sm font-semibold text-foreground">{copy.growth}</h2>
                </div>
                <div className="space-y-2">
                  {localized.lessons.map((item) => (
                    <div key={item} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <ArrowRight size={13} className="mt-0.5 shrink-0 text-[var(--amber)]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <section className="rounded-xl border border-border/60 bg-card/45 p-4">
              <h2 className="text-sm font-semibold text-foreground">{copy.context}</h2>
              <div className="mt-3">
                <ScopeRow icon={<BookOpenText size={14} />} label={copy.space} value={localized.space} />
                <ScopeRow icon={<Zap size={14} />} label={copy.kits} value={localized.kits.join(' / ') || 'Basic assistant'} />
                <ScopeRow icon={<FolderOpen size={14} />} label={copy.workArea} value={localized.workArea} />
                <ScopeRow icon={<Clock3 size={14} />} label={copy.cadence} value={localized.cadence} />
              </div>
            </section>
            <section className="rounded-xl border border-border/60 bg-card/45 p-4">
              <h2 className="text-sm font-semibold text-foreground">{copy.nextAction}</h2>
              <p className="mt-2 text-sm leading-relaxed text-foreground">{localized.nextAction}</p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
