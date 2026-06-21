'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronLeft,
  FlaskConical,
  Flag,
  Infinity,
  Leaf,
  MessageSquareText,
  Moon,
  NotebookText,
  Repeat2,
  Scale,
  Sparkles,
  SunMedium,
  Target,
} from 'lucide-react';
import { ECHO_SEGMENT_HREF, type EchoSegment } from '@/lib/echo-segments';
import {
  buildEchoAssistantRunPrompt,
  buildEchoRecentSessionSummaries,
  getEchoAssistantIdForSegment,
  type EchoPromptFact,
} from '@/lib/echo-assistants';
import type { Locale, Messages } from '@/lib/i18n';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import { openAskModal } from '@/hooks/useAskModal';
import { useSessions } from '@/lib/agent-session-store';
import { ContentPageShell } from '@/components/shared/ContentPageShell';
import { Button, buttonVariants } from '@/components/ui/button';
import { EchoHero } from './EchoHero';
import { EchoInsightCollapsible } from './EchoInsightCollapsible';
import DailyEchoReportButton from './DailyEcho/DailyEchoReportButton';
import DailyEchoReportDrawer from './DailyEcho/DailyEchoReportDrawer';
import type { DailyEchoReport } from '@/lib/daily-echo/types';
import { generateDailyEchoReport } from '@/lib/daily-echo/generator';
import { loadDailyEchoConfig } from '@/lib/daily-echo/config';

const STORAGE_DAILY = 'mindos-echo-daily-line';
const STORAGE_GROWTH = 'mindos-echo-growth-intent';

type EchoCopy = Messages['echoPages'];

function segmentTitle(segment: EchoSegment, echo: ReturnType<typeof useLocale>['t']['panels']['echo']): string {
  switch (segment) {
    case 'overview':
      return echo.overviewTitle;
    case 'imprint':
      return echo.imprintTitle;
    case 'threads':
      return echo.threadsTitle;
    case 'growth':
      return echo.growthTitle;
    case 'practice':
      return echo.practiceTitle;
  }
}

function segmentLead(segment: EchoSegment, p: EchoCopy): string {
  switch (segment) {
    case 'overview':
      return p.overviewLead;
    case 'imprint':
      return p.imprintLead;
    case 'threads':
      return p.threadsLead;
    case 'growth':
      return p.growthLead;
    case 'practice':
      return p.practiceLead;
  }
}

function echoSnapshotCopy(segment: EchoSegment, p: EchoCopy): { title: string; body: string } {
  switch (segment) {
    case 'overview':
      return { title: p.snapshotOverviewTitle, body: p.snapshotOverviewBody };
    case 'imprint':
      return { title: p.snapshotImprintTitle, body: p.snapshotImprintBody };
    case 'threads':
      return { title: p.snapshotThreadsTitle, body: p.snapshotThreadsBody };
    case 'growth':
      return { title: p.snapshotGrowthTitle, body: p.snapshotGrowthBody };
    case 'practice':
      return { title: p.snapshotPracticeTitle, body: p.snapshotPracticeBody };
  }
}

function echoAssistantActionCopy(segment: Exclude<EchoSegment, 'overview'>, p: EchoCopy): { title: string; label: string; icon: ReactNode } {
  switch (segment) {
    case 'imprint':
      return {
        title: p.assistantImprintTitle,
        label: p.assistantGenerateImprint,
        icon: <NotebookText size={18} strokeWidth={1.7} />,
      };
    case 'threads':
      return {
        title: p.assistantThreadsTitle,
        label: p.assistantGenerateThreads,
        icon: <MessageSquareText size={18} strokeWidth={1.7} />,
      };
    case 'growth':
      return {
        title: p.assistantGrowthTitle,
        label: p.assistantGenerateGrowth,
        icon: <Leaf size={18} strokeWidth={1.7} />,
      };
    case 'practice':
      return {
        title: p.assistantPracticeTitle,
        label: p.assistantGeneratePractice,
        icon: <FlaskConical size={18} strokeWidth={1.7} />,
      };
  }
}

const threadIcons = [
  <SunMedium key="sun" size={20} strokeWidth={1.7} />,
  <Target key="target" size={20} strokeWidth={1.7} />,
  <Scale key="scale" size={20} strokeWidth={1.7} />,
  <BookOpen key="book" size={20} strokeWidth={1.7} />,
  <Infinity key="infinity" size={20} strokeWidth={1.7} />,
];

const habitIcons = [
  <SunMedium key="sun" size={18} strokeWidth={1.7} />,
  <BookOpen key="book" size={18} strokeWidth={1.7} />,
  <Leaf key="leaf" size={18} strokeWidth={1.7} />,
  <Moon key="moon" size={18} strokeWidth={1.7} />,
];

const echoPageClass =
  'echo-content-page min-h-full bg-background';

const echoBodyClass =
  'mx-auto flex w-full max-w-5xl flex-col gap-6';

const echoSurfaceClass =
  'rounded-xl border border-border/60 bg-card/45 shadow-sm';

const echoPanelClass =
  'rounded-xl border border-border/50 bg-background/55 shadow-sm';

const panelHeadingClass =
  'font-sans text-lg font-semibold leading-tight text-foreground';

function BackToOverviewLink({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  return (
    <Link
      href={ECHO_SEGMENT_HREF.overview}
      aria-label={ariaLabel}
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'sm' }),
        '-ml-2 w-fit text-muted-foreground',
      )}
    >
      <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
      {label}
    </Link>
  );
}

function EchoPageHeader({
  p,
  segment,
  title,
  lead,
  titleId,
  actions,
}: {
  p: EchoCopy;
  segment: EchoSegment;
  title: string;
  lead: string;
  titleId: string;
  actions?: ReactNode;
}) {
  return (
    <EchoHero
      pageTitle={title}
      lead={lead}
      titleId={titleId}
      beforeTitle={segment === 'overview' ? undefined : (
        <BackToOverviewLink label={p.backToOverviewLabel} ariaLabel={p.backToOverviewAriaLabel} />
      )}
      actions={actions}
    />
  );
}

function EchoAssistantActionStrip({
  p,
  segment,
  onGenerate,
}: {
  p: EchoCopy;
  segment: Exclude<EchoSegment, 'overview'>;
  onGenerate: () => void;
}) {
  const action = echoAssistantActionCopy(segment, p);

  return (
    <section
      className={cn(
        echoPanelClass,
        'flex flex-col gap-4 border-[var(--amber)]/20 bg-[var(--amber-subtle)]/25 p-4 md:flex-row md:items-center md:justify-between',
      )}
      aria-label={action.title}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--amber)]/20 bg-background/75 text-[var(--amber)]" aria-hidden>
          {action.icon}
        </span>
        <div className="min-w-0">
          <h2 className="truncate font-sans text-sm font-medium text-foreground">{action.title}</h2>
          <p className="mt-0.5 truncate font-sans text-xs text-muted-foreground">{p.assistantActionHint}</p>
        </div>
      </div>
      <Button type="button" variant="amber" size="lg" onClick={onGenerate}>
        <Sparkles size={15} aria-hidden />
        {action.label}
      </Button>
    </section>
  );
}

function OverviewPanel({
  p,
  dailyLine,
  onContinue,
}: {
  p: EchoCopy;
  dailyLine: string;
  onContinue: () => void;
}) {
  return (
    <>
      <section className={cn(echoSurfaceClass, 'relative isolate overflow-hidden p-6 md:p-8')} aria-labelledby="echo-overview-rhythm-title">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute right-10 top-10 h-16 w-16 rounded-full border border-[var(--amber)]/20 bg-[var(--amber)]/10" />
          <div className="absolute -bottom-10 right-[-4%] h-40 w-[76%] rounded-t-full border-t border-muted-foreground/15" />
          <div className="absolute -bottom-5 right-8 h-32 w-[62%] rounded-t-full border-t border-muted-foreground/20" />
          <div className="absolute bottom-3 right-24 h-24 w-[48%] rounded-t-full border-t border-[var(--amber)]/20" />
        </div>
        <span className="mb-3 inline-flex rounded-full bg-muted/45 px-3 py-1 font-sans text-xs font-medium text-muted-foreground">
          {p.todayLabel}
        </span>
        <h2 id="echo-overview-rhythm-title" className="max-w-2xl font-sans text-xl font-semibold leading-tight text-foreground md:text-2xl">
          {p.overviewHeroTitle}
        </h2>
        <p className="mt-3 max-w-2xl font-sans text-sm leading-6 text-muted-foreground">{p.overviewHeroSubtitle}</p>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.imprint}
          icon={<NotebookText size={25} strokeWidth={1.65} />}
          title={p.overviewTodayTitle}
          value={p.overviewMetrics[0]?.value ?? ''}
          body={p.overviewTodayBody}
          tone="amber"
        />
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.threads}
          icon={<MessageSquareText size={25} strokeWidth={1.65} />}
          title={p.overviewThreadTitle}
          value={p.overviewMetrics[1]?.value ?? ''}
          body={p.overviewThreadBody}
          tone="graphite"
        />
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.growth}
          icon={<Leaf size={25} strokeWidth={1.65} />}
          title={p.overviewGrowthTitle}
          value={p.overviewMetrics[2]?.value ?? ''}
          body={p.overviewGrowthBody}
          tone="sage"
        />
        <OverviewStatCard
          href={ECHO_SEGMENT_HREF.practice}
          icon={<FlaskConical size={25} strokeWidth={1.65} />}
          title={p.overviewPracticeTitle}
          value={p.overviewMetrics[3]?.value ?? ''}
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

function ImprintPanel({
  p,
  dailyLine,
  setDailyLine,
  dailySaved,
  persistDaily,
}: {
  p: EchoCopy;
  dailyLine: string;
  setDailyLine: (value: string) => void;
  dailySaved: boolean;
  persistDaily: () => void;
}) {
  return (
    <>
      <div>
        <div className="inline-flex rounded-full bg-muted/55 p-1 font-sans text-sm">
          <span className="rounded-full bg-[var(--amber)] px-5 py-1.5 text-[var(--amber-foreground)] shadow-sm">{p.todayLabel}</span>
          <span className="px-5 py-1.5 text-muted-foreground">{p.weekLabel}</span>
        </div>
      </div>

      <section className={cn(echoSurfaceClass, 'overflow-hidden')}>
        <div className="divide-y divide-border/55">
          {p.imprintLogEntries.map((entry, index) => (
            <div key={`${entry.time}-${entry.title}`} className="grid grid-cols-[4.25rem_1fr] gap-4 px-4 py-4 md:grid-cols-[5rem_1fr] md:px-6">
              <div className="pt-1 font-sans text-sm font-medium tabular-nums text-muted-foreground">{entry.time}</div>
              <div className="relative pl-7">
                <span className={cn(
                  'absolute left-0 top-2 h-full w-px bg-border',
                  index === p.imprintLogEntries.length - 1 && 'hidden',
                )} aria-hidden />
                <span className="absolute left-[-4px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--amber)]/25 bg-[var(--amber)]/20 shadow-[0_0_0_4px_var(--amber-subtle)]" aria-hidden />
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h2 className="font-sans text-base font-medium text-foreground">{entry.title}</h2>
                    <p className="mt-2 max-w-2xl truncate font-sans text-sm text-muted-foreground">{entry.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-md bg-[var(--amber-subtle)] px-2.5 py-1 font-sans text-xs text-[var(--amber-text)]">{entry.tag}</span>
                    <span className="inline-flex items-center gap-1.5 font-sans text-sm text-muted-foreground">
                      <Bookmark size={16} aria-hidden />
                      {entry.count}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={cn(echoPanelClass, 'p-5')}>
        <label htmlFor="echo-daily-line" className="font-sans text-sm font-medium text-foreground">
          {p.dailyLineLabel}
        </label>
        <textarea
          id="echo-daily-line"
          value={dailyLine}
          onChange={(event) => setDailyLine(event.target.value)}
          onBlur={persistDaily}
          rows={3}
          placeholder={p.dailyLinePlaceholder}
          className="mt-3 w-full resize-y rounded-lg border border-border/55 bg-background/70 px-3 py-3 font-sans text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mt-3 flex items-center gap-2 font-sans text-xs text-muted-foreground">
          {p.dailySavedNote}
          <span className="inline-flex items-center gap-1 text-[var(--success)]" aria-live="polite">
            {dailySaved ? <><Check size={14} aria-hidden /> {p.savedFlash}</> : null}
          </span>
        </p>
      </section>
    </>
  );
}

function ThreadsPanel({
  p,
  selectedIndex,
  onSelect,
}: {
  p: EchoCopy;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const selected = p.threadItems[selectedIndex] ?? p.threadItems[0];

  return (
    <>
      <div className="grid min-h-[31rem] gap-5 lg:grid-cols-[minmax(16rem,0.82fr)_minmax(0,1.4fr)]">
        <section className={cn(echoPanelClass, 'overflow-hidden')}>
          <div className="border-b border-border/45 px-5 py-4">
            <h2 className="font-sans text-sm font-medium text-foreground">{p.threadsListTitle}</h2>
          </div>
          {p.threadItems.map((item, index) => {
            const active = index === selectedIndex;
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => onSelect(index)}
                className={cn(
                  'group relative flex w-full items-center gap-4 border-b border-border/45 px-5 py-5 text-left transition-[background-color,color] duration-150 last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'bg-[var(--amber)]/10' : 'hover:bg-muted/30',
                )}
              >
                {active ? <span className="absolute bottom-0 left-0 top-0 w-1 rounded-r-full bg-[var(--amber)]" aria-hidden /> : null}
                <span className={cn('shrink-0', active ? 'text-[var(--amber)]' : 'text-muted-foreground group-hover:text-foreground')} aria-hidden>
                  {threadIcons[index % threadIcons.length]}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-sans text-sm font-medium text-foreground">{item.title}</span>
                  <span className="mt-1 block font-sans text-xs text-muted-foreground">{item.meta}</span>
                </span>
              </button>
            );
          })}
        </section>

        <section className={cn(echoSurfaceClass, 'flex flex-col p-7 md:p-9')}>
          <div className="flex items-start gap-4">
            <span className="mt-1 text-[var(--amber)]" aria-hidden>{threadIcons[selectedIndex % threadIcons.length]}</span>
            <div className="min-w-0">
              <h2 className="font-sans text-xl font-semibold leading-tight text-foreground">{selected.title}</h2>
              <p className="mt-3 font-sans text-sm text-muted-foreground">{selected.meta}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {selected.tags.map((tag) => (
                  <span key={tag} className="rounded-md bg-[var(--amber-subtle)] px-3 py-1 font-sans text-xs text-[var(--amber-text)]">{tag}</span>
                ))}
              </div>
            </div>
          </div>

          <ul className="mt-8 space-y-4 font-sans text-sm leading-7 text-muted-foreground">
            {selected.points.map((point) => (
              <li key={point} className="flex gap-3">
                <span className="mt-3 h-1 w-1 shrink-0 rounded-full bg-foreground" aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          <div className="mt-9">
            <h2 className="font-sans text-lg font-medium text-foreground">{p.threadExtendTitle}</h2>
            <p className="mt-4 max-w-xl font-sans text-sm leading-7 text-muted-foreground">{selected.reflection}</p>
          </div>
        </section>
      </div>
    </>
  );
}

function GrowthPanel({
  p,
  growthIntent,
  setGrowthIntent,
  growthSaved,
  persistGrowth,
}: {
  p: EchoCopy;
  growthIntent: string;
  setGrowthIntent: (value: string) => void;
  growthSaved: boolean;
  persistGrowth: () => void;
}) {
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cn(echoSurfaceClass, 'p-7')}>
          <div className="mb-7 flex items-center gap-3">
            <Flag size={22} className="text-[var(--amber)]" aria-hidden />
            <h2 className={panelHeadingClass}>{p.growthMilestonesTitle}</h2>
          </div>
          <div className="space-y-0">
            {p.growthMilestones.map((item, index) => (
              <div key={item.title} className="grid grid-cols-[2rem_1fr] gap-4">
                <div className="relative flex justify-center">
                  <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--amber)]" aria-hidden />
                  {index < p.growthMilestones.length - 1 ? <span className="absolute bottom-0 top-5 w-px bg-[var(--amber)]/35" aria-hidden /> : null}
                </div>
                <div className="pb-7">
                  <p className="font-sans text-sm font-medium text-foreground">{item.title}</p>
                  <p className="mt-1 font-sans text-xs text-muted-foreground">{item.date}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={cn(echoSurfaceClass, 'p-7')}>
          <div className="mb-7 flex items-center gap-3">
            <Repeat2 size={22} className="text-foreground" aria-hidden />
            <h2 className={panelHeadingClass}>{p.growthHabitsTitle}</h2>
          </div>
          <div className="space-y-6">
            {p.growthHabits.map((habit, index) => {
              const progress = Math.min(100, Math.round((habit.value / habit.total) * 100));
              return (
                <div key={habit.title}>
                  <div className="mb-2 flex items-center gap-3">
                    <span className={cn(index % 2 === 0 ? 'text-[var(--amber)]' : 'text-[var(--success)]')} aria-hidden>
                      {habitIcons[index % habitIcons.length]}
                    </span>
                    <span className="font-sans text-sm font-medium text-foreground">{habit.title}</span>
                    <span className="ml-auto font-sans text-xs tabular-nums text-muted-foreground">{habit.value}/{habit.total}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted/60">
                    <div className="h-full rounded-full bg-[var(--amber)]" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className={cn(echoSurfaceClass, 'relative overflow-hidden p-7 md:p-8')}>
        <div className="max-w-2xl">
          <div className="mb-5 flex items-center gap-3">
            <Leaf size={24} className="text-[var(--success)]" aria-hidden />
            <h2 className={panelHeadingClass}>{p.growthReflectionTitle}</h2>
          </div>
          <p className="font-sans text-sm leading-8 text-muted-foreground">{growthIntent.trim() || p.growthReflectionBody}</p>
          <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto]">
            <textarea
              value={growthIntent}
              onChange={(event) => setGrowthIntent(event.target.value)}
              onBlur={persistGrowth}
              rows={3}
              placeholder={p.growthIntentPlaceholder}
              className="min-h-24 resize-y rounded-lg border border-border/50 bg-background/70 px-3 py-3 font-sans text-sm leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-row items-center gap-2 md:flex-col md:items-stretch">
              <Button type="button" variant="outline" size="lg" onClick={persistGrowth}>
                {growthSaved ? p.savedFlash : p.growthSaveLabel}
              </Button>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 right-3 hidden h-32 w-24 overflow-hidden text-[var(--success)]/38 md:block" aria-hidden>
          <span className="absolute bottom-0 left-8 h-24 w-2 origin-bottom -rotate-12 rounded-full bg-current" />
          <span className="absolute bottom-8 left-4 h-10 w-6 origin-bottom -rotate-45 rounded-full bg-current opacity-70" />
          <span className="absolute bottom-14 left-7 h-12 w-7 origin-bottom rotate-45 rounded-full bg-current opacity-65" />
          <span className="absolute bottom-20 left-3 h-10 w-6 origin-bottom -rotate-45 rounded-full bg-current opacity-55" />
          <span className="absolute bottom-24 left-7 h-12 w-7 origin-bottom rotate-45 rounded-full bg-current opacity-50" />
        </div>
      </section>
    </>
  );
}

function PracticePanel({ p }: { p: EchoCopy }) {
  return (
    <>
      <section className={cn(echoSurfaceClass, 'p-7 md:p-8')}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--amber-subtle)] text-[var(--amber-text)]" aria-hidden>
              <FlaskConical size={21} strokeWidth={1.7} />
            </div>
            <h2 className={panelHeadingClass}>{p.practiceExperimentsTitle}</h2>
            <p className="mt-3 max-w-2xl font-sans text-sm leading-7 text-muted-foreground">{p.practiceExperimentsBody}</p>
          </div>
          <span className="w-fit rounded-md bg-muted/55 px-3 py-1.5 font-sans text-xs text-muted-foreground">
            {p.practiceCycleLabel}
          </span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {p.practiceExperiments.map((experiment, index) => (
          <section key={experiment.title} className={cn(echoPanelClass, 'flex min-h-[17rem] flex-col p-5')}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <span className="rounded-md bg-[var(--amber-subtle)] px-2.5 py-1 font-sans text-xs text-[var(--amber-text)]">
                {p.practiceExperimentLabel} {index + 1}
              </span>
              <span className="rounded-md bg-muted/50 px-2.5 py-1 font-sans text-xs text-muted-foreground">{experiment.status}</span>
            </div>
            <h2 className="font-sans text-base font-medium leading-snug text-foreground">{experiment.title}</h2>
            <div className="mt-5 space-y-4 font-sans text-sm leading-6 text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">{p.practiceHypothesisLabel}</span>
                <br />
                {experiment.hypothesis}
              </p>
              <p>
                <span className="font-medium text-foreground">{p.practiceActionLabel}</span>
                <br />
                {experiment.action}
              </p>
              <p>
                <span className="font-medium text-foreground">{p.practiceCheckLabel}</span>
                <br />
                {experiment.check}
              </p>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export default function EchoSegmentPageClient({ segment }: { segment: EchoSegment }) {
  const { t, locale } = useLocale();
  const p = t.echoPages;
  const echo = t.panels.echo;
  const title = segmentTitle(segment, echo);
  const lead = segmentLead(segment, p);
  const pageTitleId = 'echo-page-title';
  const sessions = useSessions();

  const [dailyLine, setDailyLine] = useState('');
  const [growthIntent, setGrowthIntent] = useState('');
  const [dailySaved, setDailySaved] = useState(false);
  const [growthSaved, setGrowthSaved] = useState(false);
  const [selectedThreadIndex, setSelectedThreadIndex] = useState(0);
  const [dailyEchoReport, setDailyEchoReport] = useState<DailyEchoReport | null>(null);
  const [isDailyEchoOpen, setIsDailyEchoOpen] = useState(false);
  const [isDailyEchoGenerating, setIsDailyEchoGenerating] = useState(false);
  const [assistantGenerateSignal, setAssistantGenerateSignal] = useState(0);
  const dailySavedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const growthSavedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => {
    clearTimeout(dailySavedTimer.current);
    clearTimeout(growthSavedTimer.current);
  }, []);

  const snapshot = useMemo(() => echoSnapshotCopy(segment, p), [segment, p]);

  useEffect(() => {
    try {
      const d = localStorage.getItem(STORAGE_DAILY);
      if (d) setDailyLine(d);
      const g = localStorage.getItem(STORAGE_GROWTH);
      if (g) setGrowthIntent(g);
    } catch {
      /* local storage can be unavailable in restricted browser contexts */
    }
  }, []);

  const persistDaily = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_DAILY, dailyLine);
    } catch {
      /* ignore */
    }
    clearTimeout(dailySavedTimer.current);
    setDailySaved(true);
    dailySavedTimer.current = setTimeout(() => setDailySaved(false), 1800);
  }, [dailyLine]);

  const persistGrowth = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_GROWTH, growthIntent);
    } catch {
      /* ignore */
    }
    clearTimeout(growthSavedTimer.current);
    setGrowthSaved(true);
    growthSavedTimer.current = setTimeout(() => setGrowthSaved(false), 1800);
  }, [growthIntent]);

  const openImprintAsk = useCallback(() => {
    persistDaily();
    openAskModal(p.dailyAskPrefill(dailyLine), 'user');
  }, [dailyLine, p, persistDaily]);

  const openSegmentAsk = useCallback(() => {
    openAskModal(`${p.parent} / ${title}\n\n${lead}`, 'user');
  }, [lead, p.parent, title]);

  const handleDailyEchoGenerated = useCallback((report: DailyEchoReport) => {
    setDailyEchoReport(report);
    setIsDailyEchoOpen(true);
    setIsDailyEchoGenerating(false);
  }, []);

  const handleDailyEchoRegenerate = useCallback(async () => {
    setDailyEchoReport(null);
    setIsDailyEchoGenerating(true);
    try {
      const config = loadDailyEchoConfig();
      const report = await generateDailyEchoReport(new Date(), config, true);
      setDailyEchoReport(report);
    } catch (err) {
      console.error('[EchoImprint] Regenerate failed:', err);
    } finally {
      setIsDailyEchoGenerating(false);
    }
  }, []);

  const handleDailyEchoContinueAgent = useCallback((content: string) => {
    setIsDailyEchoOpen(false);
    openAskModal(content, 'user');
  }, []);

  const echoAssistantId = getEchoAssistantIdForSegment(segment);
  const activeEchoSegment = segment === 'overview' ? null : segment;
  const recentSessions = useMemo(() => buildEchoRecentSessionSummaries(sessions), [sessions]);
  const selectedThread = p.threadItems[selectedThreadIndex] ?? p.threadItems[0];
  const echoAssistantPrompt = useMemo(() => {
    if (!echoAssistantId || segment === 'overview') return '';
    const facts: EchoPromptFact[] = [];

    if (segment === 'imprint') {
      facts.push(
        { label: p.dailyLineLabel, value: dailyLine.trim() || p.dailyLinePlaceholder },
        {
          label: 'Visible log entries',
          value: p.imprintLogEntries.map((entry) => `${entry.time} ${entry.title} - ${entry.body}`).join(' | '),
        },
      );
      if (dailyEchoReport) {
        facts.push(
          { label: p.dailyReportTitle, value: dailyEchoReport.rawMarkdown },
          { label: p.reportThemesTitle, value: dailyEchoReport.themes.map((theme) => theme.name).join(', ') },
          { label: p.reportAlignmentTitle, value: dailyEchoReport.alignment.analysis },
        );
      }
    }

    if (segment === 'threads' && selectedThread) {
      facts.push(
        { label: p.threadsListTitle, value: p.threadItems.map((item) => item.title).join(', ') },
        { label: 'Selected thread', value: selectedThread.title },
        { label: 'Selected thread meta', value: selectedThread.meta },
        { label: 'Selected thread tags', value: selectedThread.tags.join(', ') },
        { label: 'Selected thread points', value: selectedThread.points.join(' | ') },
        { label: 'Selected thread reflection', value: selectedThread.reflection },
      );
    }

    if (segment === 'growth') {
      facts.push(
        { label: p.growthIntentLabel, value: growthIntent.trim() || p.growthIntentPlaceholder },
        { label: p.growthMilestonesTitle, value: p.growthMilestones.map((item) => `${item.date} ${item.title}`).join(' | ') },
        { label: p.growthHabitsTitle, value: p.growthHabits.map((habit) => `${habit.title} ${habit.value}/${habit.total}`).join(' | ') },
      );
    }

    if (segment === 'practice') {
      facts.push({
        label: p.practiceExperimentsTitle,
        value: p.practiceExperiments.map((experiment) => [
          `${experiment.title} (${experiment.status})`,
          `${p.practiceHypothesisLabel} ${experiment.hypothesis}`,
          `${p.practiceActionLabel} ${experiment.action}`,
          `${p.practiceCheckLabel} ${experiment.check}`,
        ].join(' / ')).join(' | '),
      });
    }

    return buildEchoAssistantRunPrompt({
      locale: locale as Locale,
      segment,
      segmentTitle: title,
      lead,
      snapshotTitle: snapshot.title,
      snapshotBody: snapshot.body,
      facts,
      recentSessions,
    });
  }, [
    dailyEchoReport,
    dailyLine,
    echoAssistantId,
    growthIntent,
    lead,
    locale,
    p,
    recentSessions,
    segment,
    selectedThread,
    snapshot.body,
    snapshot.title,
    title,
  ]);

  const triggerEchoAssistantGenerate = useCallback(() => {
    setAssistantGenerateSignal((value) => value + 1);
  }, []);

  const headerActions = segment === 'imprint'
    ? (
        <>
          <DailyEchoReportButton
            onGenerated={handleDailyEchoGenerated}
            onError={(err) => console.error('[EchoImprint]', err)}
            locale={{ t: p }}
          />
          <Button type="button" variant="amber" size="xl" onClick={openImprintAsk}>
            {p.continueRecordLabel}
          </Button>
        </>
      )
    : segment === 'growth'
      ? (
          <Button type="button" variant="amber" size="xl" onClick={openSegmentAsk}>
            {p.growthChatLabel}
          </Button>
        )
      : segment === 'practice'
        ? (
            <Button type="button" variant="amber" size="xl" onClick={openSegmentAsk}>
              {p.practiceChatLabel}
            </Button>
          )
      : undefined;

  return (
    <ContentPageShell
      as="article"
      className={echoPageClass}
      data-content-page-shell="echo"
      aria-labelledby={pageTitleId}
    >
      <div className={echoBodyClass}>
        <EchoPageHeader
          p={p}
          segment={segment}
          title={title}
          lead={lead}
          titleId={pageTitleId}
          actions={headerActions}
        />

        {activeEchoSegment && (
          <EchoAssistantActionStrip
            p={p}
            segment={activeEchoSegment}
            onGenerate={triggerEchoAssistantGenerate}
          />
        )}

        {segment === 'overview' && (
          <OverviewPanel
            p={p}
            dailyLine={dailyLine}
            onContinue={openImprintAsk}
          />
        )}

        {segment === 'imprint' && (
          <ImprintPanel
            p={p}
            dailyLine={dailyLine}
            setDailyLine={setDailyLine}
            dailySaved={dailySaved}
            persistDaily={persistDaily}
          />
        )}

        {segment === 'threads' && (
          <ThreadsPanel
            p={p}
            selectedIndex={selectedThreadIndex}
            onSelect={setSelectedThreadIndex}
          />
        )}

        {segment === 'growth' && (
          <GrowthPanel
            p={p}
            growthIntent={growthIntent}
            setGrowthIntent={setGrowthIntent}
            growthSaved={growthSaved}
            persistGrowth={persistGrowth}
          />
        )}

        {segment === 'practice' && (
          <PracticePanel p={p} />
        )}

        {echoAssistantId && segment !== 'overview' && (
          <EchoInsightCollapsible
            title={p.insightTitle}
            showLabel={p.insightShow}
            hideLabel={p.insightHide}
            hint={p.insightHint}
            generateLabel={p.generateInsight}
            noAiHint={p.generateInsightNoAi}
            generatingLabel={p.insightGenerating}
            errorPrefix={p.insightErrorPrefix}
            retryLabel={p.insightRetry}
            assistantId={echoAssistantId}
            userPrompt={echoAssistantPrompt}
            generateSignal={assistantGenerateSignal}
          />
        )}
      </div>

      {segment === 'imprint' && (
        <DailyEchoReportDrawer
          isOpen={isDailyEchoOpen}
          report={dailyEchoReport}
          isGenerating={isDailyEchoGenerating}
          onClose={() => setIsDailyEchoOpen(false)}
          onRegenerate={handleDailyEchoRegenerate}
          onContinueAgent={handleDailyEchoContinueAgent}
          locale={{ t: p }}
        />
      )}
    </ContentPageShell>
  );
}
