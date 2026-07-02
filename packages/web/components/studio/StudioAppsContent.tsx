'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  GraduationCap,
  MessageSquareText,
  NotebookTabs,
  Sparkles,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { StudioShell } from './StudioShell';
import { StudioOverviewLink } from './StudioOverviewLink';

type StudioAppStatus = 'ready' | 'draft';

type StudioApp = {
  id: string;
  status: StudioAppStatus;
  href: string;
  title: string;
  eyebrow: string;
  description: string;
  actions: readonly string[];
};

const COPY = {
  en: {
    title: 'Apps',
    subtitle: 'Context surfaces for real work.',
    featuredLabel: 'Focus',
    featuredTitle: 'Relationships',
    featuredBody: 'People context, recent touchpoints, commitments, and the next follow-up.',
    today: 'Today',
    todayItems: ['Log the conversation', 'Extract commitments', 'Draft the follow-up'],
    nextTime: 'Next time',
    nextTimeItems: ['Recall the person context', 'Check open promises', 'Keep one communication rule'],
    openCapture: 'Record touchpoint',
    statusReady: 'Ready',
    statusDraft: 'Draft',
    openApp: 'Open',
    apps: [
      {
        id: 'relationships',
        status: 'ready',
        href: '/capture',
        title: 'Relationship Memory',
        eyebrow: 'People',
        description: 'People, recent conversations, commitments, and follow-up drafts.',
        actions: ['Touchpoints', 'Promises', 'Before you meet'],
      },
      {
        id: 'learning',
        status: 'draft',
        href: '/echo/growth',
        title: 'Learning Practice',
        eyebrow: 'Study',
        description: 'Learning paths, concept cards, practice logs, and review rhythm.',
        actions: ['Concepts', 'Exercises', 'Review'],
      },
      {
        id: 'launch',
        status: 'draft',
        href: '/studio/projects',
        title: 'Launch Practice',
        eyebrow: 'Product',
        description: 'Launch state, evidence, risks, changelog, and copy drafts.',
        actions: ['Evidence', 'Risks', 'Release notes'],
      },
    ],
  },
  zh: {
    title: '应用',
    subtitle: '把真实工作流变成可直接进入的 context 工作面。',
    featuredLabel: '焦点',
    featuredTitle: '关系记忆',
    featuredBody: '人物语境、最近互动、承诺和下一步跟进。',
    today: '今天',
    todayItems: ['记录一次对话', '提取承诺事项', '生成跟进草稿'],
    nextTime: '下一次',
    nextTimeItems: ['回看人物语境', '检查未完成承诺', '保留一条沟通规则'],
    openCapture: '记录互动',
    statusReady: '可起步',
    statusDraft: '草稿',
    openApp: '打开',
    apps: [
      {
        id: 'relationships',
        status: 'ready',
        href: '/capture',
        title: '关系记忆',
        eyebrow: '社交',
        description: '人物、最近对话、重要承诺和跟进草稿。',
        actions: ['互动记录', '承诺跟进', '会前准备'],
      },
      {
        id: 'learning',
        status: 'draft',
        href: '/echo/growth',
        title: '学习练习',
        eyebrow: '学习',
        description: '学习路线、概念卡、练习记录和复习节奏。',
        actions: ['概念卡', '练习题', '复习'],
      },
      {
        id: 'launch',
        status: 'draft',
        href: '/studio/projects',
        title: '发布实践',
        eyebrow: '产品',
        description: '发布状态、证据、风险、changelog 和文案草稿。',
        actions: ['证据', '风险', '发布说明'],
      },
    ],
  },
} as const;

const APP_ICONS: Record<string, ReactNode> = {
  relationships: <Users size={17} aria-hidden="true" />,
  learning: <GraduationCap size={17} aria-hidden="true" />,
  launch: <Sparkles size={17} aria-hidden="true" />,
};

function StatusBadge({
  status,
  copy,
}: {
  status: StudioAppStatus;
  copy: typeof COPY.en | typeof COPY.zh;
}) {
  const label = status === 'ready' ? copy.statusReady : copy.statusDraft;
  return (
    <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function CompactActionPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted/45 px-2 py-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function AppCard({
  app,
  copy,
}: {
  app: StudioApp;
  copy: typeof COPY.en | typeof COPY.zh;
}) {
  return (
    <article className="group flex min-h-52 flex-col justify-between rounded-lg border border-border/60 bg-background/45 p-4 transition-colors duration-150 hover:border-border hover:bg-muted/20">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[var(--amber-subtle)] text-[var(--amber)]">
              {APP_ICONS[app.id]}
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-muted-foreground">{app.eyebrow}</div>
              <h2 className="mt-0.5 text-sm font-semibold text-foreground">{app.title}</h2>
            </div>
          </div>
          <StatusBadge status={app.status} copy={copy} />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{app.description}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {app.actions.map((action) => (
            <CompactActionPill key={action}>{action}</CompactActionPill>
          ))}
        </div>
      </div>
      <Link
        href={app.href}
        className="mt-5 inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copy.openApp}
        <ArrowRight size={13} aria-hidden="true" />
      </Link>
    </article>
  );
}

function TodayNextColumn({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: readonly string[];
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
          {icon}
        </span>
        {title}
      </div>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--amber)]" aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudioAppsContent() {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const apps = copy.apps as readonly StudioApp[];

  return (
    <StudioShell>
      <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
        <header className="border-b border-border/60 pb-6">
          <StudioOverviewLink locale={locale} />
          <h1 className="mt-3 text-2xl font-semibold text-foreground">{copy.title}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{copy.subtitle}</p>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-labelledby="studio-apps-featured">
          <div className="rounded-lg border border-border/60 bg-background/45 p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[var(--amber-subtle)] text-[var(--amber)]">
                <MessageSquareText size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">{copy.featuredLabel}</div>
                <h2 id="studio-apps-featured" className="mt-1 text-xl font-semibold text-foreground">{copy.featuredTitle}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.featuredBody}</p>
              </div>
            </div>
            <Button
              render={<Link href="/capture" />}
              nativeButton={false}
              variant="amber"
              size="lg"
              className="mt-5"
            >
              <NotebookTabs size={15} aria-hidden="true" />
              {copy.openCapture}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TodayNextColumn
              title={copy.today}
              icon={<MessageSquareText size={14} aria-hidden="true" />}
              items={copy.todayItems}
            />
            <TodayNextColumn
              title={copy.nextTime}
              icon={<BookOpenCheck size={14} aria-hidden="true" />}
              items={copy.nextTimeItems}
            />
          </div>
        </section>

        <section aria-label={copy.title}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} copy={copy} />
            ))}
          </div>
        </section>
      </div>
    </StudioShell>
  );
}
