'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  GraduationCap,
  LayoutGrid,
  Megaphone,
  PenLine,
  Users,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { LoadingPageShell, WorkbenchPageShell } from '@/components/shared/ContentPageShell';
import { useRailPreferences } from '@/lib/rail-preferences';
import { useLocale } from '@/lib/stores/locale-store';

const COPY = {
  en: {
    title: 'Apps',
    subtitle: 'Scenario workspaces shaped by your context.',
    badge: 'Experiment',
    opening: 'Opening experiments...',
    settings: 'Experiments',
    statusNext: 'Next',
    statusDraft: 'Draft',
    statusLater: 'Later',
    openSettings: 'Open experiments',
    items: [
      {
        id: 'research-radar',
        name: 'Research Radar',
        description: 'Daily papers, review queue, and notes handoff.',
        status: 'Next',
      },
      {
        id: 'product-launch',
        name: 'Product Launch',
        description: 'Release state, risks, changelog, and launch copy.',
        status: 'Next',
      },
      {
        id: 'content-studio',
        name: 'Content Studio',
        description: 'Ideas, drafts, channels, and reusable source context.',
        status: 'Draft',
      },
      {
        id: 'academy',
        name: 'Academy',
        description: 'Learning paths, practice loops, and review rhythm.',
        status: 'Later',
      },
      {
        id: 'relationships',
        name: 'Relationships',
        description: 'People, recent touchpoints, and next follow-ups.',
        status: 'Later',
      },
    ],
  },
  zh: {
    title: '应用',
    subtitle: '基于你的 context 组织场景工作台。',
    badge: '实验',
    opening: '正在打开实验设置...',
    settings: '实验',
    statusNext: '优先',
    statusDraft: '草稿',
    statusLater: '稍后',
    openSettings: '打开实验设置',
    items: [
      {
        id: 'research-radar',
        name: '科研雷达',
        description: '每日论文、阅读队列和笔记沉淀。',
        status: '优先',
      },
      {
        id: 'product-launch',
        name: '产品发布',
        description: '发布状态、风险、changelog 和发布文案。',
        status: '优先',
      },
      {
        id: 'content-studio',
        name: '内容创作',
        description: '选题、草稿、渠道和可复用素材。',
        status: '草稿',
      },
      {
        id: 'academy',
        name: '学院',
        description: '学习路径、练习循环和复习节奏。',
        status: '稍后',
      },
      {
        id: 'relationships',
        name: '关系经营',
        description: '人物、最近互动和下一步跟进。',
        status: '稍后',
      },
    ],
  },
} as const;

const APP_ICONS: Record<string, ReactNode> = {
  'research-radar': <BookOpen size={17} />,
  'product-launch': <Megaphone size={17} />,
  'content-studio': <PenLine size={17} />,
  academy: <GraduationCap size={17} />,
  relationships: <Users size={17} />,
};

function AppStatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {status}
    </span>
  );
}

export default function AppsContent() {
  const router = useRouter();
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const railPreferences = useRailPreferences();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || railPreferences.apps) return;
    router.replace('/settings?tab=navigation');
  }, [hydrated, railPreferences.apps, router]);

  if (!hydrated || !railPreferences.apps) {
    return (
      <LoadingPageShell
        as="main"
        className="min-h-[calc(100dvh-var(--app-titlebar-h))] bg-background"
        data-content-page-shell="apps"
      >
        <div className="flex min-h-[40dvh] items-center justify-center">
          <p className="text-sm text-muted-foreground">{copy.opening}</p>
        </div>
      </LoadingPageShell>
    );
  }

  return (
    <WorkbenchPageShell
      as="main"
      className="min-h-[calc(100dvh-var(--app-titlebar-h))] bg-background"
      data-content-page-shell="apps"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border/60 pb-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/65 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <LayoutGrid size={13} />
              {copy.badge}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-normal text-foreground md:text-4xl">
              {copy.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {copy.subtitle}
            </p>
          </div>
          <Link
            href="/settings?tab=navigation"
            className="hit-target-box inline-flex h-9 items-center gap-2 self-start rounded-md border border-border/70 bg-background/70 px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:self-auto"
          >
            {copy.openSettings}
            <ArrowRight size={14} />
          </Link>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={copy.title}>
          {copy.items.map((item) => (
            <article
              key={item.id}
              className="group flex min-h-36 flex-col justify-between rounded-lg border border-border/60 bg-background/55 p-4 transition-colors hover:border-border hover:bg-muted/20"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-[var(--amber-subtle)] text-[var(--amber)]">
                    {APP_ICONS[item.id]}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">{item.name}</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <AppStatusBadge status={item.status} />
              </div>
            </article>
          ))}
        </section>
      </div>
    </WorkbenchPageShell>
  );
}
