'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Archive,
  Bot,
  FolderOpen,
  FlaskConical,
  Leaf,
  MessageSquareText,
  NotebookText,
  Route,
  SunMedium,
} from 'lucide-react';
import { ECHO_SEGMENT_HREF, type EchoSegment } from '@/lib/echo-segments';
import {
  buildEchoAssistantRunPrompt,
  buildEchoRecentSessionSummaries,
  getEchoAssistantMaxSteps,
  getEchoAssistantIdForSegment,
  type EchoPromptFact,
} from '@/lib/echo-assistants';
import type { EchoSavedItem, EchoSavedItemDetail, EchoStoredSegment } from '@/lib/echo-store';
import type { Locale, Messages } from '@/lib/i18n';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import { openAskModal } from '@/hooks/useAskModal';
import { useSessions } from '@/lib/agent-session-store';
import { ContentPageShell } from '@/components/shared/ContentPageShell';
import { Button } from '@/components/ui/button';
import { EchoAssistantGenerateButton, EchoPageHeader } from './EchoSegmentPageHeader';
import EchoImprintCardsReview from './EchoImprintCardsReview';
import { EchoInsightCollapsible } from './EchoInsightCollapsible';
import EchoMemoryReaderPanel from './EchoMemoryReaderPanel';

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

const echoPageClass =
  'echo-content-page min-h-full bg-background';

const echoBodyClass =
  'flex w-full flex-col gap-6';

const echoSurfaceClass =
  'rounded-xl border border-border/60 bg-card/45 shadow-sm';

const echoPanelClass =
  'rounded-xl border border-border/50 bg-background/55 shadow-sm';

function echoReaderListTitle(segment: EchoStoredSegment, title: string, p: EchoCopy): string {
  if (segment === 'imprint') return p.imprintEventBookTitle;
  if (segment === 'threads') return p.threadsListTitle;
  return title;
}

function echoReaderSubtitle(segment: EchoStoredSegment, p: EchoCopy): string {
  switch (segment) {
    case 'imprint':
      return p.imprintEventBookSubtitle;
    case 'threads':
      return p.threadsReaderSubtitle;
    case 'growth':
      return p.growthReaderSubtitle;
    case 'practice':
      return p.practiceReaderSubtitle;
  }
}

function echoReaderEmptyLabel(segment: EchoStoredSegment, p: EchoCopy): string {
  switch (segment) {
    case 'imprint':
      return p.imprintReaderEmptyLabel;
    case 'threads':
      return p.threadsReaderEmptyLabel;
    case 'growth':
      return p.growthReaderEmptyLabel;
    case 'practice':
      return p.practiceReaderEmptyLabel;
  }
}

function echoReaderDetailEmptyLabel(segment: EchoStoredSegment, p: EchoCopy): string {
  switch (segment) {
    case 'imprint':
      return p.imprintReaderDetailEmptyLabel;
    case 'threads':
      return p.threadsReaderDetailEmptyLabel;
    case 'growth':
      return p.growthReaderDetailEmptyLabel;
    case 'practice':
      return p.practiceReaderDetailEmptyLabel;
  }
}

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

function EchoWorktablePanel({
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
              <Route size={12} aria-hidden />
              {p.echoStudioRouteHint}
            </span>
          </div>
        </div>
      </div>
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
  const loop = [
    { title: p.overviewTodayTitle, body: p.overviewTodayBody, href: ECHO_SEGMENT_HREF.imprint },
    { title: p.overviewThreadTitle, body: p.overviewThreadBody, href: ECHO_SEGMENT_HREF.threads },
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
          <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label={p.overviewHeroSubtitle}>
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
  const [assistantGenerateSignal, setAssistantGenerateSignal] = useState(0);
  const [savedEchoItems, setSavedEchoItems] = useState<EchoSavedItem[]>([]);
  const [selectedEchoPath, setSelectedEchoPath] = useState<string | null>(null);
  const [savedEchoDetail, setSavedEchoDetail] = useState<EchoSavedItemDetail | null>(null);
  const [savedEchoLoading, setSavedEchoLoading] = useState(false);
  const [savedEchoError, setSavedEchoError] = useState('');
  const [savedEchoDetailLoading, setSavedEchoDetailLoading] = useState(false);
  const [savedEchoDetailError, setSavedEchoDetailError] = useState('');

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
  }, [dailyLine]);

  const openImprintAsk = useCallback(() => {
    persistDaily();
    openAskModal(p.dailyAskPrefill(dailyLine), 'user');
  }, [dailyLine, p, persistDaily]);

  const echoAssistantId = getEchoAssistantIdForSegment(segment);
  const echoAssistantMaxSteps = echoAssistantId ? getEchoAssistantMaxSteps(echoAssistantId) : undefined;
  const activeEchoSegment: EchoStoredSegment | null = segment === 'overview' ? null : segment;
  const readerEchoSegment: EchoStoredSegment | null =
    segment === 'threads' || segment === 'growth' || segment === 'practice' ? segment : null;
  const recentSessions = useMemo(() => buildEchoRecentSessionSummaries(sessions), [sessions]);
  const selectedEchoItem = readerEchoSegment
    ? (savedEchoDetail ?? savedEchoItems.find((item) => item.path === selectedEchoPath) ?? null)
    : null;

  useEffect(() => {
    if (!readerEchoSegment) {
      setSavedEchoItems([]);
      setSelectedEchoPath(null);
      setSavedEchoDetail(null);
      setSavedEchoLoading(false);
      setSavedEchoError('');
      setSavedEchoDetailLoading(false);
      setSavedEchoDetailError('');
      return;
    }

    const ctrl = new AbortController();
    setSavedEchoLoading(true);
    setSavedEchoError('');

    fetch(`/api/echo?segment=${readerEchoSegment}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as { items?: EchoSavedItem[]; error?: string };
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setSavedEchoItems(Array.isArray(body.items) ? body.items : []);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === 'AbortError') return;
        setSavedEchoError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSavedEchoLoading(false);
      });

    return () => ctrl.abort();
  }, [readerEchoSegment]);

  useEffect(() => {
    if (!readerEchoSegment || savedEchoItems.length === 0) {
      setSelectedEchoPath(null);
      return;
    }

    setSelectedEchoPath((current) => {
      if (current && savedEchoItems.some((item) => item.path === current)) return current;
      return savedEchoItems[0]?.path ?? null;
    });
  }, [readerEchoSegment, savedEchoItems]);

  useEffect(() => {
    if (!readerEchoSegment || !selectedEchoPath) {
      setSavedEchoDetail(null);
      setSavedEchoDetailLoading(false);
      setSavedEchoDetailError('');
      return;
    }

    const ctrl = new AbortController();
    setSavedEchoDetailLoading(true);
    setSavedEchoDetailError('');

    fetch(`/api/echo?segment=${readerEchoSegment}&path=${encodeURIComponent(selectedEchoPath)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({})) as { item?: EchoSavedItemDetail; error?: string };
        if (!res.ok || !body.item) throw new Error(body.error || `HTTP ${res.status}`);
        setSavedEchoDetail(body.item);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === 'AbortError') return;
        setSavedEchoDetail(null);
        setSavedEchoDetailError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSavedEchoDetailLoading(false);
      });

    return () => ctrl.abort();
  }, [readerEchoSegment, selectedEchoPath]);

  const handleEchoSaved = useCallback((item: EchoSavedItem) => {
    setSavedEchoItems((current) => [
      item,
      ...current.filter((entry) => entry.path !== item.path),
    ]);
    setSelectedEchoPath(item.path);
  }, []);

  const echoAssistantPrompt = useMemo(() => {
    if (!echoAssistantId || segment === 'overview') return '';
    const facts: EchoPromptFact[] = [];

    if (savedEchoDetail) {
      facts.push({
        label: 'Selected Echo item',
        value: [
          `Title: ${savedEchoDetail.title}`,
          `Path: ${savedEchoDetail.path}`,
          savedEchoDetail.markdown.slice(0, 6000),
        ].join('\n\n'),
      });
    }

    if (segment === 'imprint') {
      facts.push(
        { label: p.dailyLineLabel, value: dailyLine.trim() || p.dailyLinePlaceholder },
        {
          label: 'Visible log entries',
          value: p.imprintLogEntries.map((entry) => `${entry.time} ${entry.title} - ${entry.body}`).join(' | '),
        },
      );
    }

    if (segment === 'threads' && !savedEchoDetail) {
      facts.push(
        { label: p.threadsListTitle, value: p.threadItems.map((item) => item.title).join(', ') },
      );
    }

    if (segment === 'growth' && !savedEchoDetail) {
      facts.push(
        { label: p.growthIntentLabel, value: growthIntent.trim() || p.growthIntentPlaceholder },
        { label: p.growthMilestonesTitle, value: p.growthMilestones.map((item) => `${item.date} ${item.title}`).join(' | ') },
        { label: p.growthHabitsTitle, value: p.growthHabits.map((habit) => `${habit.title} ${habit.value}/${habit.total}`).join(' | ') },
      );
    }

    if (segment === 'practice' && !savedEchoDetail) {
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
    dailyLine,
    echoAssistantId,
    growthIntent,
    lead,
    locale,
    p,
    recentSessions,
    savedEchoDetail,
    segment,
    snapshot.body,
    snapshot.title,
    title,
  ]);

  const triggerEchoAssistantGenerate = useCallback(() => {
    setAssistantGenerateSignal((value) => value + 1);
  }, []);

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
        />

        {segment === 'overview' && (
          <OverviewPanel
            p={p}
            dailyLine={dailyLine}
            onContinue={openImprintAsk}
          />
        )}

        {activeEchoSegment === 'imprint' && (
          <EchoImprintCardsReview p={p} />
        )}

        {readerEchoSegment && (
          <>
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]" data-testid="echo-studio">
              <EchoWorktablePanel
                segment={readerEchoSegment}
                selectedItem={selectedEchoItem}
                savedCount={savedEchoItems.length}
                recentSessionCount={recentSessions.length}
                p={p}
                onGenerate={triggerEchoAssistantGenerate}
              />
              {echoAssistantId ? (
                <EchoInsightCollapsible
                  noAiHint={p.generateInsightNoAi}
                  generatingLabel={p.insightGenerating}
                  errorPrefix={p.insightErrorPrefix}
                  retryLabel={p.insightRetry}
                  saveLabel={p.echoSaveLabel}
                  savingLabel={p.echoSavingLabel}
                  savedLabel={p.echoSavedLabel}
                  saveErrorPrefix={p.echoSaveErrorPrefix}
                  draftTitle={p.echoDraftTitle}
                  draftIdleLabel={p.echoDraftIdleLabel}
                  draftOutputLabel={p.echoDraftOutputLabel}
                  draftSavedHint={p.echoDraftSavedHint}
                  segment={readerEchoSegment}
                  assistantId={echoAssistantId}
                  userPrompt={echoAssistantPrompt}
                  generateSignal={assistantGenerateSignal}
                  maxSteps={echoAssistantMaxSteps}
                  onSaved={handleEchoSaved}
                />
              ) : null}
            </div>
            <EchoMemoryReaderPanel
              segment={readerEchoSegment}
              listTitle={echoReaderListTitle(readerEchoSegment, title, p)}
              listSubtitle={echoReaderSubtitle(readerEchoSegment, p)}
              emptyLabel={echoReaderEmptyLabel(readerEchoSegment, p)}
              detailEmptyLabel={echoReaderDetailEmptyLabel(readerEchoSegment, p)}
              items={savedEchoItems}
              selectedPath={selectedEchoPath}
              onSelect={setSelectedEchoPath}
              detail={savedEchoDetail}
              loading={savedEchoLoading}
              error={savedEchoError}
              detailLoading={savedEchoDetailLoading}
              detailError={savedEchoDetailError}
              p={p}
            />
          </>
        )}
      </div>
    </ContentPageShell>
  );
}
