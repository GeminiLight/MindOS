'use client';

import Link from 'next/link';
import { Archive, ArrowUpRight, Bot, FolderOpen, MessageSquareText, NotebookText } from 'lucide-react';
import { ECHO_SEGMENT_HREF } from '@/lib/echo-segments';
import type { EchoSavedItem, EchoStoredSegment } from '@/lib/echo-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EchoAssistantGenerateButton } from './EchoSegmentPageHeader';
import type { EchoCopy } from './echo-structured-cards';

const echoSurfaceClass = 'rounded-xl border border-border/60 bg-card/45 shadow-sm';

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
      <section className="border-b border-border/60 pb-8 pt-2" aria-labelledby="echo-reflection-title">
        <div className="flex flex-col items-start gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <NotebookText size={19} className="text-muted-foreground" aria-hidden />
              <h2 id="echo-reflection-title" className="font-sans text-base font-medium text-foreground">{p.overviewReflectionTitle}</h2>
            </div>
            <p className="mt-4 max-w-prose whitespace-pre-wrap break-words font-sans text-sm leading-7 text-foreground">
              {dailyLine.trim() || p.overviewNarrativeBody}
            </p>
          </div>
          <Button type="button" variant="amber" size="xl" className="min-h-11 w-full sm:w-auto" onClick={onContinue}>
            {p.overviewReflectAction}
          </Button>
        </div>
      </section>
      <nav aria-label={p.overviewHeroSubtitle} className="divide-y divide-border/60">
        {loop.map(item => (
          <Link key={item.href} href={item.href}
            className="group flex min-h-16 items-center justify-between gap-4 rounded-md px-2 py-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-foreground">{item.title}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p>
            </div>
            <ArrowUpRight size={16} className="shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
          </Link>
        ))}
      </nav>
    </>
  );
}
