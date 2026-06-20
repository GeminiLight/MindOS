'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Infinity,
  Leaf,
  Menu,
  MessageSquareText,
  Moon,
  MoreVertical,
  NotebookText,
  Plus,
  Repeat2,
  Scale,
  Search,
  SunMedium,
  Target,
} from 'lucide-react';
import { ECHO_SEGMENT_HREF, type EchoSegment } from '@/lib/echo-segments';
import { buildEchoInsightUserPrompt } from '@/lib/echo-insight-prompt';
import type { Locale, Messages } from '@/lib/i18n';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import { openAskModal } from '@/hooks/useAskModal';
import { ContentPageShell } from '@/components/shared/ContentPageShell';
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
  'echo-content-page min-h-full bg-[radial-gradient(circle_at_72%_8%,color-mix(in_srgb,var(--amber)_12%,transparent),transparent_28%),linear-gradient(180deg,color-mix(in_srgb,var(--background)_94%,var(--card))_0%,var(--background)_100%)] px-4 py-5 md:px-7 md:py-7';

const paperSurfaceClass =
  'rounded-lg border border-border/55 bg-[color-mix(in_srgb,var(--card)_72%,var(--background))] shadow-[0_18px_55px_color-mix(in_srgb,var(--foreground)_8%,transparent)]';

const paperPanelClass =
  'rounded-lg border border-border/45 bg-[color-mix(in_srgb,var(--background)_76%,var(--card))] shadow-[0_16px_45px_color-mix(in_srgb,var(--foreground)_7%,transparent)]';

const subtleButtonClass =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border/55 bg-[color-mix(in_srgb,var(--background)_78%,var(--card))] px-3 py-2 font-sans text-sm text-foreground transition-[background-color,border-color,color,transform] duration-150 hover:border-[var(--amber)]/30 hover:bg-[var(--amber-subtle)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const pageHeadingClass =
  'font-sans text-3xl font-medium leading-tight tracking-normal text-foreground md:text-4xl';

const panelHeadingClass =
  'font-sans text-xl font-medium leading-tight tracking-normal text-foreground';

function EchoIconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-[var(--amber-subtle)] hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  label,
  onClick,
  href,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    'inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--amber)] px-5 py-2 font-sans text-sm font-medium text-[var(--amber-foreground)] shadow-[0_12px_24px_color-mix(in_srgb,var(--amber)_24%,transparent)] transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

  if (href) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {label}
    </button>
  );
}

function EchoTopBar({
  leading,
  trailing,
}: {
  leading: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-7 flex min-h-9 items-center justify-between gap-3 font-sans text-sm text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5">{leading}</div>
      <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
    </div>
  );
}

function BackForwardControls() {
  return (
    <>
      <EchoIconButton label="Back">
        <ChevronLeft size={20} strokeWidth={1.8} aria-hidden />
      </EchoIconButton>
      <EchoIconButton label="Forward">
        <ChevronRight size={20} strokeWidth={1.8} aria-hidden />
      </EchoIconButton>
    </>
  );
}

function BackToOverviewLink({ label, ariaLabel }: { label: string; ariaLabel: string }) {
  return (
    <Link
      href={ECHO_SEGMENT_HREF.overview}
      aria-label={ariaLabel}
      className="inline-flex min-h-9 items-center gap-2 rounded-md px-0 py-1 font-sans text-lg font-medium text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ChevronLeft size={23} strokeWidth={1.8} aria-hidden />
      {label}
    </Link>
  );
}

function EchoPageHeader({
  p,
  title,
  lead,
  actions,
  topTrailing,
}: {
  p: EchoCopy;
  title: string;
  lead?: string;
  actions?: ReactNode;
  topTrailing?: ReactNode;
}) {
  return (
    <header className="mb-7">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <BackToOverviewLink label={p.backToOverviewLabel} ariaLabel={p.backToOverviewAriaLabel} />
        {topTrailing ? <div className="flex shrink-0 items-center gap-1.5">{topTrailing}</div> : null}
      </div>
      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className={pageHeadingClass}>{title}</h1>
          {lead ? <p className="mt-3 max-w-xl font-sans text-sm leading-6 text-muted-foreground">{lead}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
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
    <div className="mx-auto w-full max-w-3xl">
      <EchoTopBar
        leading={(
          <>
            <BackForwardControls />
            <button type="button" className="ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 font-sans text-base font-medium text-foreground hover:bg-[var(--amber-subtle)]">
              {p.todayLabel}
              <ChevronDown size={16} aria-hidden />
            </button>
          </>
        )}
        trailing={(
          <>
            <EchoIconButton label="Search"><Search size={21} aria-hidden /></EchoIconButton>
            <EchoIconButton label="Calendar"><CalendarDays size={21} aria-hidden /></EchoIconButton>
          </>
        )}
      />

      <header className="relative isolate overflow-hidden rounded-lg px-7 pb-9 pt-3 md:px-9 md:pb-11">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute right-10 top-10 h-16 w-16 rounded-full bg-[radial-gradient(circle_at_35%_35%,color-mix(in_srgb,var(--amber)_56%,var(--background)),color-mix(in_srgb,var(--amber)_18%,transparent)_68%,transparent_70%)] blur-[0.2px]" />
          <div className="absolute bottom-0 right-0 h-36 w-[72%] rounded-t-[100%] bg-[linear-gradient(160deg,transparent_10%,color-mix(in_srgb,var(--muted)_72%,transparent)_45%,transparent_78%)] opacity-90" />
          <div className="absolute bottom-1 right-8 h-28 w-[62%] rounded-t-[100%] bg-[linear-gradient(160deg,transparent_20%,color-mix(in_srgb,var(--muted-foreground)_18%,transparent)_48%,transparent_82%)] opacity-80" />
          <div className="absolute bottom-4 right-24 h-20 w-[46%] rounded-t-[100%] bg-[linear-gradient(160deg,transparent_24%,color-mix(in_srgb,var(--amber)_12%,transparent)_52%,transparent_82%)]" />
        </div>
        <h1 className={pageHeadingClass}>
          {p.overviewHeroTitle}
        </h1>
        <p className="mt-3 font-sans text-base text-muted-foreground">{p.overviewHeroSubtitle}</p>
      </header>

      <section className={cn(paperSurfaceClass, 'mt-6 p-6 md:p-7')}>
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
          <PrimaryButton label={p.continueLabel} onClick={onContinue} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
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
      </div>
    </div>
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
        paperPanelClass,
        'group block min-h-[8.75rem] p-5 transition-[background-color,border-color,transform] duration-150 hover:border-[var(--amber)]/28 hover:bg-[color-mix(in_srgb,var(--background)_84%,var(--card))] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
  title,
  dailyLine,
  setDailyLine,
  dailySaved,
  persistDaily,
  onOpenAgent,
  onDailyEchoGenerated,
}: {
  p: EchoCopy;
  title: string;
  dailyLine: string;
  setDailyLine: (value: string) => void;
  dailySaved: boolean;
  persistDaily: () => void;
  onOpenAgent: () => void;
  onDailyEchoGenerated: (report: DailyEchoReport) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <EchoPageHeader
        p={p}
        title={title}
        topTrailing={(
          <>
            <EchoIconButton label="Search"><Search size={20} aria-hidden /></EchoIconButton>
            <EchoIconButton label="Theme"><SunMedium size={20} aria-hidden /></EchoIconButton>
            <EchoIconButton label="Menu"><Menu size={21} aria-hidden /></EchoIconButton>
          </>
        )}
        actions={(
          <>
            <DailyEchoReportButton
              onGenerated={onDailyEchoGenerated}
              onError={(err) => console.error('[EchoImprint]', err)}
              locale={{ t: p }}
            />
            <PrimaryButton label={p.continueRecordLabel} onClick={onOpenAgent} />
          </>
        )}
      />

      <div className="mb-7">
        <div className="inline-flex rounded-full bg-muted/55 p-1 font-sans text-sm">
          <span className="rounded-full bg-[var(--amber)] px-5 py-1.5 text-[var(--amber-foreground)] shadow-sm">{p.todayLabel}</span>
          <span className="px-5 py-1.5 text-muted-foreground">{p.weekLabel}</span>
        </div>
      </div>

      <section className={cn(paperSurfaceClass, 'overflow-hidden')}>
        <div className="divide-y divide-border/55">
          {p.imprintLogEntries.map((entry, index) => (
            <div key={`${entry.time}-${entry.title}`} className="grid grid-cols-[4.25rem_1fr] gap-4 px-4 py-4 md:grid-cols-[5rem_1fr] md:px-6">
              <div className="pt-1 font-sans text-sm font-medium tabular-nums text-muted-foreground">{entry.time}</div>
              <div className="relative pl-7">
                <span className={cn(
                  'absolute left-0 top-2 h-full w-px bg-border',
                  index === p.imprintLogEntries.length - 1 && 'hidden',
                )} aria-hidden />
                <span className="absolute left-[-4px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[color-mix(in_srgb,var(--amber)_16%,var(--background))] bg-[color-mix(in_srgb,var(--amber)_18%,var(--background))] shadow-[0_0_0_4px_color-mix(in_srgb,var(--amber)_8%,transparent)]" aria-hidden />
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

      <section className={cn(paperPanelClass, 'mt-5 p-5')}>
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
    </div>
  );
}

function ThreadsPanel({
  p,
  title,
  selectedIndex,
  onSelect,
}: {
  p: EchoCopy;
  title: string;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const selected = p.threadItems[selectedIndex] ?? p.threadItems[0];

  return (
    <div className="mx-auto w-full max-w-5xl">
      <EchoPageHeader
        p={p}
        title={title}
        lead={p.threadsLead}
        topTrailing={(
          <>
            <EchoIconButton label="Search"><Search size={22} aria-hidden /></EchoIconButton>
            <button type="button" aria-label="New thread" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] shadow-[0_10px_22px_color-mix(in_srgb,var(--amber)_22%,transparent)]">
              <Plus size={20} aria-hidden />
            </button>
          </>
        )}
      />

      <div className="grid min-h-[31rem] gap-5 lg:grid-cols-[minmax(16rem,0.82fr)_minmax(0,1.4fr)]">
        <section className={cn(paperPanelClass, 'overflow-hidden')}>
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
                  active ? 'bg-[color-mix(in_srgb,var(--amber)_14%,var(--background))]' : 'hover:bg-muted/30',
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

        <section className={cn(paperSurfaceClass, 'flex flex-col p-7 md:p-9')}>
          <div className="flex items-start gap-4">
            <span className="mt-1 text-[var(--amber)]" aria-hidden>{threadIcons[selectedIndex % threadIcons.length]}</span>
            <div className="min-w-0">
              <h1 className="font-sans text-2xl font-medium leading-tight tracking-normal text-foreground">{selected.title}</h1>
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

          <div className="mt-auto flex items-center gap-2 pt-8">
            <EchoIconButton label="Bookmark"><Bookmark size={19} aria-hidden /></EchoIconButton>
            <EchoIconButton label="More"><MoreVertical size={19} aria-hidden /></EchoIconButton>
          </div>
        </section>
      </div>
    </div>
  );
}

function GrowthPanel({
  p,
  title,
  growthIntent,
  setGrowthIntent,
  growthSaved,
  persistGrowth,
  onOpenAgent,
}: {
  p: EchoCopy;
  title: string;
  growthIntent: string;
  setGrowthIntent: (value: string) => void;
  growthSaved: boolean;
  persistGrowth: () => void;
  onOpenAgent: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <EchoPageHeader
        p={p}
        title={title}
        lead={p.growthLead}
        topTrailing={(
          <>
            <EchoIconButton label="Calendar"><CalendarDays size={21} aria-hidden /></EchoIconButton>
            <EchoIconButton label="More"><MoreVertical size={21} aria-hidden /></EchoIconButton>
          </>
        )}
        actions={(
          <>
            <div className="inline-flex items-center gap-1 rounded-lg bg-muted/35 px-1.5 py-1">
              <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-sans text-sm font-medium text-foreground hover:bg-background/65">
                {p.seasonLabel}
                <ChevronDown size={15} aria-hidden />
              </button>
              <BackForwardControls />
            </div>
            <PrimaryButton label={p.growthChatLabel} onClick={onOpenAgent} />
          </>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cn(paperSurfaceClass, 'p-7')}>
          <div className="mb-7 flex items-center gap-3">
            <Flag size={22} className="text-[var(--amber)]" aria-hidden />
            <h1 className={panelHeadingClass}>{p.growthMilestonesTitle}</h1>
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

        <section className={cn(paperSurfaceClass, 'p-7')}>
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

      <section className={cn(paperSurfaceClass, 'relative mt-5 overflow-hidden p-7 md:p-8')}>
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
              <button type="button" onClick={persistGrowth} className={subtleButtonClass}>
                {growthSaved ? p.savedFlash : p.growthSaveLabel}
              </button>
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 right-4 hidden h-32 w-20 text-[var(--success)]/38 md:block" aria-hidden>
          <span className="absolute bottom-0 left-12 h-24 w-2 origin-bottom -rotate-12 rounded-full bg-current" />
          <span className="absolute bottom-8 left-7 h-10 w-6 origin-bottom -rotate-45 rounded-full bg-current opacity-70" />
          <span className="absolute bottom-14 left-12 h-12 w-7 origin-bottom rotate-45 rounded-full bg-current opacity-65" />
          <span className="absolute bottom-20 left-3 h-10 w-6 origin-bottom -rotate-45 rounded-full bg-current opacity-55" />
          <span className="absolute bottom-24 left-14 h-12 w-7 origin-bottom rotate-45 rounded-full bg-current opacity-50" />
        </div>
      </section>
    </div>
  );
}

export default function EchoSegmentPageClient({ segment }: { segment: EchoSegment }) {
  const { t, locale } = useLocale();
  const p = t.echoPages;
  const echo = t.panels.echo;
  const title = segmentTitle(segment, echo);
  const lead = segmentLead(segment, p);
  const pageTitleId = 'echo-page-title';

  const [dailyLine, setDailyLine] = useState('');
  const [growthIntent, setGrowthIntent] = useState('');
  const [dailySaved, setDailySaved] = useState(false);
  const [growthSaved, setGrowthSaved] = useState(false);
  const [selectedThreadIndex, setSelectedThreadIndex] = useState(0);
  const [dailyEchoReport, setDailyEchoReport] = useState<DailyEchoReport | null>(null);
  const [isDailyEchoOpen, setIsDailyEchoOpen] = useState(false);
  const [isDailyEchoGenerating, setIsDailyEchoGenerating] = useState(false);
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

  const insightUserPrompt = useMemo(
    () =>
      buildEchoInsightUserPrompt({
        locale: locale as Locale,
        segment,
        segmentTitle: title,
        factsHeading: p.factsHeading,
        emptyTitle: snapshot.title,
        emptyBody: snapshot.body,
        dailyLineLabel: p.dailyLineLabel,
        dailyLine,
        growthIntentLabel: p.growthIntentLabel,
        growthIntent,
      }),
    [locale, segment, title, p.factsHeading, snapshot, p.dailyLineLabel, dailyLine, p.growthIntentLabel, growthIntent],
  );

  return (
    <ContentPageShell
      as="article"
      className={echoPageClass}
      aria-labelledby={pageTitleId}
    >
      <h1 id={pageTitleId} className="sr-only">{title}</h1>

      {segment === 'overview' && (
        <OverviewPanel
          p={p}
          dailyLine={dailyLine}
          onContinue={openImprintAsk}
        />
      )}

      {segment === 'imprint' && (
        <>
          <ImprintPanel
            p={p}
            title={echo.imprintTitle}
            dailyLine={dailyLine}
            setDailyLine={setDailyLine}
            dailySaved={dailySaved}
            persistDaily={persistDaily}
            onOpenAgent={openImprintAsk}
            onDailyEchoGenerated={handleDailyEchoGenerated}
          />
          <DailyEchoReportDrawer
            isOpen={isDailyEchoOpen}
            report={dailyEchoReport}
            isGenerating={isDailyEchoGenerating}
            onClose={() => setIsDailyEchoOpen(false)}
            onRegenerate={handleDailyEchoRegenerate}
            onContinueAgent={handleDailyEchoContinueAgent}
            locale={{ t: p }}
          />
        </>
      )}

      {segment === 'threads' && (
        <ThreadsPanel
          p={p}
          title={echo.threadsTitle}
          selectedIndex={selectedThreadIndex}
          onSelect={setSelectedThreadIndex}
        />
      )}

      {segment === 'growth' && (
        <GrowthPanel
          p={p}
          title={echo.growthTitle}
          growthIntent={growthIntent}
          setGrowthIntent={setGrowthIntent}
          growthSaved={growthSaved}
          persistGrowth={persistGrowth}
          onOpenAgent={openSegmentAsk}
        />
      )}

      {(segment === 'threads' || segment === 'growth') && (
        <div className="mx-auto mt-6 w-full max-w-5xl">
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
            userPrompt={insightUserPrompt}
          />
        </div>
      )}
    </ContentPageShell>
  );
}
