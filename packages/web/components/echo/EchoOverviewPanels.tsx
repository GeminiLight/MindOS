'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Archive, ArrowUpRight, Bot, FolderOpen, GitBranch, Leaf, MessageSquareText, NotebookText, SunMedium } from 'lucide-react';
import { ECHO_SEGMENT_HREF } from '@/lib/echo-segments';
import type { EchoSavedItem, EchoStoredSegment } from '@/lib/echo-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EchoAssistantGenerateButton } from './EchoSegmentPageHeader';
import type { EchoCopy } from './echo-structured-cards';

const echoSurfaceClass = 'rounded-xl border border-border/60 bg-card/45 shadow-sm';
const echoPanelClass = 'rounded-xl border border-border/50 bg-background/55 shadow-sm';

function echoFlowCopy(segment: EchoStoredSegment, p: EchoCopy) {
  switch (segment) {
    case 'imprint':
      return {
        source: p.imprintFlowSource,
        generate: p.imprintFlowGenerate,
        save: p.imprintFlowSave,
        consume: p.imprintFlowConsume,
      };
    case 'threads':
      return {
        source: p.threadsFlowSource,
        generate: p.threadsFlowGenerate,
        save: p.threadsFlowSave,
        consume: p.threadsFlowConsume,
      };
    case 'growth':
      return {
        source: p.growthFlowSource,
        generate: p.growthFlowGenerate,
        save: p.growthFlowSave,
        consume: p.growthFlowConsume,
      };
    case 'practice':
      return {
        source: p.practiceFlowSource,
        generate: p.practiceFlowGenerate,
        save: p.practiceFlowSave,
        consume: p.practiceFlowConsume,
      };
  }
}
export function EchoWorktablePanel({
  segment,
  selectedItem,
  savedCount,
  recentSessionCount,
  p,
  onGenerate,
}: {
  segment: EchoStoredSegment;
  selectedItem: EchoSavedItem | null;
  savedCount: number;
  recentSessionCount: number;
  p: EchoCopy;
  onGenerate: () => void;
}) {
  const flow = echoFlowCopy(segment, p);
  const routeSteps = [
    { label: p.echoFlowSourceLabel, body: flow.source },
    { label: p.echoFlowGenerateLabel, body: flow.generate },
    { label: p.echoFlowSaveLabel, body: flow.save },
    { label: p.echoFlowConsumeLabel, body: flow.consume },
  ];
  const contextLabel = selectedItem
    ? p.echoFlowSelectedItem(selectedItem.title, selectedItem.path)
    : p.echoFlowNoSelection;
  const contextRows = [
    {
      label: p.echoStudioSelectedLabel,
      value: contextLabel,
      icon: <MessageSquareText size={15} aria-hidden />,
    },
    {
      label: p.echoStudioRecentLabel,
      value: p.echoWorktableRecentCount(recentSessionCount),
      icon: <Bot size={15} aria-hidden />,
    },
    {
      label: p.echoStudioSavedLabel,
      value: p.echoWorktableSavedCount(savedCount),
      icon: <Archive size={15} aria-hidden />,
    },
  ];

  return (
    <section
      className={cn(echoSurfaceClass, 'flex min-h-[18rem] min-w-0 flex-col overflow-hidden')}
      aria-labelledby="echo-flow-title"
      data-testid="echo-worktable"
    >
      <header className="border-b border-border/45 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground" aria-hidden>
            <FolderOpen size={16} />
          </span>
          <div className="min-w-0">
            <h2 id="echo-flow-title" className="font-sans text-base font-medium leading-tight text-foreground">
              {p.echoFlowTitle}
            </h2>
            <p className="mt-1 line-clamp-2 font-sans text-xs leading-5 text-muted-foreground">
              {p.echoFlowSubtitle}
            </p>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 px-5 py-5">
        <div className="space-y-3">
          {contextRows.map((row) => (
            <div key={row.label} className="flex min-w-0 gap-3 rounded-lg border border-border/45 bg-background/45 px-3.5 py-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground">
                {row.icon}
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">{row.label}</p>
                <p className="mt-1 line-clamp-2 break-words font-sans text-sm leading-5 text-foreground">{row.value}</p>
              </div>
            </div>
          ))}
        </div>

        <ol className="grid gap-2 md:grid-cols-4" aria-label={p.echoStudioRouteLabel}>
          {routeSteps.map((step, index) => (
            <li key={step.label} className="min-w-0 rounded-lg border border-border/40 bg-muted/20 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background/80 font-mono text-[0.65rem] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-sans text-xs font-medium text-foreground">{step.label}</span>
              </div>
              <p className="mt-2 line-clamp-3 font-sans text-xs leading-5 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-auto flex flex-col gap-3 border-t border-border/45 pt-4">
          <p className="font-sans text-xs leading-5 text-muted-foreground">
            <span className="font-medium text-foreground">{p.echoWorktableAiLabel}</span>
            {' · '}
            {p.echoWorktableAiBoundary}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <EchoAssistantGenerateButton
              p={p}
              segment={segment}
              onGenerate={onGenerate}
              size="sm"
              className="w-full justify-center sm:w-fit"
            />
            <span className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/55 px-2.5 py-1 font-sans text-xs text-muted-foreground">
              {p.echoStudioRouteHint}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function OverviewPanel({
  p,
  dailyLine,
  onContinue,
}: {
  p: EchoCopy;
  dailyLine: string;
  onContinue: () => void;
}) {
  const loop = [
    { title: p.overviewTodayTitle, body: p.overviewTodayBody, href: ECHO_SEGMENT_HREF.imprint },
    { title: p.overviewGrowthTitle, body: p.overviewGrowthBody, href: ECHO_SEGMENT_HREF.growth },
    { title: p.overviewPracticeTitle, body: p.overviewPracticeBody, href: ECHO_SEGMENT_HREF.practice },
  ];

  return (
    <>
      <section className={cn(echoSurfaceClass, 'overflow-hidden p-6 md:p-8')} aria-labelledby="echo-overview-rhythm-title">
        <span className="mb-3 inline-flex rounded-full bg-muted/45 px-3 py-1 font-sans text-xs font-medium text-muted-foreground">
          {p.todayLabel}
        </span>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(28rem,1.1fr)] xl:items-end">
          <div className="min-w-0">
            <h2 id="echo-overview-rhythm-title" className="max-w-2xl font-sans text-xl font-semibold leading-tight text-foreground md:text-2xl">
              {p.overviewHeroTitle}
            </h2>
            <p className="mt-3 max-w-2xl font-sans text-sm leading-6 text-muted-foreground">{p.overviewHeroSubtitle}</p>
          </div>
          <ol className="grid gap-2 sm:grid-cols-3" aria-label={p.overviewHeroSubtitle}>
            {loop.map((item, index) => (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  className="group block h-full rounded-lg border border-border/45 bg-background/45 px-3.5 py-3 transition-[background-color,border-color] duration-150 hover:border-[var(--amber)]/35 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-mono text-[0.68rem] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mt-2 block font-sans text-sm font-medium text-foreground">{item.title}</span>
                  <span className="mt-1 line-clamp-2 font-sans text-xs leading-5 text-muted-foreground">{item.body}</span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={cn(echoSurfaceClass, 'p-6 md:p-7')}>
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SunMedium size={19} className="text-[var(--amber)]" aria-hidden />
              <h2 className="font-sans text-base font-medium text-foreground">{p.overviewNarrativeTitle}</h2>
            </div>
            <p className="mt-4 max-w-xl font-sans text-sm leading-7 text-muted-foreground">
              {dailyLine.trim() || p.overviewNarrativeBody}
            </p>
          </div>
          <Button type="button" variant="amber" size="xl" onClick={onContinue}>
            {p.continueLabel}
          </Button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.imprint}
          icon={<NotebookText size={25} strokeWidth={1.65} />}
          title={p.overviewTodayTitle}
          value={p.overviewMetrics[0]?.value ?? ''}
          body={p.overviewTodayBody}
          tone="amber"
        />
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.growth}
          icon={<Leaf size={25} strokeWidth={1.65} />}
          title={p.overviewGrowthTitle}
          value={p.overviewMetrics[1]?.value ?? ''}
          body={p.overviewGrowthBody}
          tone="sage"
        />
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.practice}
          icon={<GitBranch size={25} strokeWidth={1.65} />}
          title={p.overviewPracticeTitle}
          value={p.overviewMetrics[2]?.value ?? ''}
          body={p.overviewPracticeBody}
          tone="graphite"
        />
      </div>
    </>
  );
}

function OverviewStatCard({
  href,
  icon,
  title,
  value,
  body,
  tone,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  value: string;
  body: string;
  tone: 'amber' | 'sage' | 'graphite';
}) {
  const toneClass = tone === 'sage'
    ? 'text-[var(--success)]'
    : tone === 'amber'
      ? 'text-[var(--amber)]'
      : 'text-muted-foreground';

  return (
    <Link
      href={href}
      className={cn(
        echoPanelClass,
        'group block min-h-[8.75rem] p-5 transition-[background-color,border-color,transform] duration-150 hover:border-[var(--amber)]/30 hover:bg-muted/25 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className={toneClass}>{icon}</div>
        <span className="rounded-md bg-muted/45 px-2 py-1 font-sans text-xs text-muted-foreground">{value}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-sans text-base font-medium text-foreground">{title}</h2>
        <ArrowUpRight size={15} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      <p className="mt-3 font-sans text-sm leading-6 text-muted-foreground">{body}</p>
    </Link>
  );
}
