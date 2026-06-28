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
import { EchoInsightCollapsible } from './EchoInsightCollapsible';
import EchoMemoryReaderPanel from './EchoMemoryReaderPanel';
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

function EchoSegmentFlowPanel({
  segment,
  selectedItem,
  p,
}: {
  segment: EchoStoredSegment;
  selectedItem: EchoSavedItem | null;
  p: EchoCopy;
}) {
  const flow = echoFlowCopy(segment, p);
  const steps = [
    { label: p.echoFlowSourceLabel, body: flow.source, icon: <FolderOpen size={16} aria-hidden /> },
    { label: p.echoFlowGenerateLabel, body: flow.generate, icon: <Bot size={16} aria-hidden /> },
    { label: p.echoFlowSaveLabel, body: flow.save, icon: <Archive size={16} aria-hidden /> },
    { label: p.echoFlowConsumeLabel, body: flow.consume, icon: <Route size={16} aria-hidden /> },
  ];

  return (
    <section
      className={cn(echoSurfaceClass, 'overflow-hidden')}
      aria-labelledby="echo-flow-title"
      data-testid="echo-page-contract"
    >
      <div className="border-b border-border/45 px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 id="echo-flow-title" className="font-sans text-base font-medium text-foreground">
              {p.echoFlowTitle}
            </h2>
            <p className="mt-1 max-w-3xl font-sans text-sm leading-6 text-muted-foreground">
              {p.echoFlowSubtitle}
            </p>
          </div>
          <p className="rounded-md border border-border/55 bg-background/65 px-3 py-2 font-sans text-xs leading-5 text-muted-foreground lg:max-w-sm">
            {selectedItem
              ? p.echoFlowSelectedItem(selectedItem.title, selectedItem.path)
              : p.echoFlowNoSelection}
          </p>
        </div>
      </div>
      <div className="grid divide-y divide-border/45 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        {steps.map((step) => (
          <div key={step.label} className="min-w-0 p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground">
                {step.icon}
              </span>
              <h3 className="font-sans text-sm font-medium text-foreground">{step.label}</h3>
            </div>
            <p className="mt-3 font-sans text-sm leading-6 text-muted-foreground">{step.body}</p>
          </div>
        ))}
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
  const [dailyEchoReport, setDailyEchoReport] = useState<DailyEchoReport | null>(null);
  const [isDailyEchoOpen, setIsDailyEchoOpen] = useState(false);
  const [isDailyEchoGenerating, setIsDailyEchoGenerating] = useState(false);
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
  const echoAssistantMaxSteps = echoAssistantId ? getEchoAssistantMaxSteps(echoAssistantId) : undefined;
  const activeEchoSegment: EchoStoredSegment | null = segment === 'overview' ? null : segment;
  const recentSessions = useMemo(() => buildEchoRecentSessionSummaries(sessions), [sessions]);
  const selectedEchoItem = activeEchoSegment
    ? (savedEchoDetail ?? savedEchoItems.find((item) => item.path === selectedEchoPath) ?? null)
    : null;

  useEffect(() => {
    if (!activeEchoSegment) {
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

    fetch(`/api/echo?segment=${activeEchoSegment}`, { signal: ctrl.signal })
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
  }, [activeEchoSegment]);

  useEffect(() => {
    if (!activeEchoSegment || savedEchoItems.length === 0) {
      setSelectedEchoPath(null);
      return;
    }

    setSelectedEchoPath((current) => {
      if (current && savedEchoItems.some((item) => item.path === current)) return current;
      return savedEchoItems[0]?.path ?? null;
    });
  }, [activeEchoSegment, savedEchoItems]);

  useEffect(() => {
    if (!activeEchoSegment || !selectedEchoPath) {
      setSavedEchoDetail(null);
      setSavedEchoDetailLoading(false);
      setSavedEchoDetailError('');
      return;
    }

    const ctrl = new AbortController();
    setSavedEchoDetailLoading(true);
    setSavedEchoDetailError('');

    fetch(`/api/echo?segment=${activeEchoSegment}&path=${encodeURIComponent(selectedEchoPath)}`, { signal: ctrl.signal })
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
  }, [activeEchoSegment, selectedEchoPath]);

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
      if (dailyEchoReport) {
        facts.push(
          { label: p.dailyReportTitle, value: dailyEchoReport.rawMarkdown },
          { label: p.reportThemesTitle, value: dailyEchoReport.themes.map((theme) => theme.name).join(', ') },
          { label: p.reportAlignmentTitle, value: dailyEchoReport.alignment.analysis },
        );
      }
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
    dailyEchoReport,
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

  const assistantHeaderAction = activeEchoSegment
    ? (
      <EchoAssistantGenerateButton
        p={p}
        segment={activeEchoSegment}
        onGenerate={triggerEchoAssistantGenerate}
        className={segment === 'imprint' ? 'max-sm:flex-1' : undefined}
      />
    )
    : undefined;
  const headerActions = segment === 'imprint'
    ? (
      <>
        {assistantHeaderAction}
        <Button type="button" variant="outline" size="xl" onClick={openImprintAsk} className="max-sm:flex-1">
          {p.continueRecordLabel}
        </Button>
        <DailyEchoReportButton
          onGenerated={handleDailyEchoGenerated}
          onError={(err) => console.error('[EchoImprint]', err)}
          locale={{ t: p }}
          variant="outline"
          size="xl"
          className="max-sm:flex-1"
        />
      </>
    )
    : assistantHeaderAction;

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

        {segment === 'overview' && (
          <OverviewPanel
            p={p}
            dailyLine={dailyLine}
            onContinue={openImprintAsk}
          />
        )}

        {activeEchoSegment && (
          <>
            <EchoSegmentFlowPanel
              segment={activeEchoSegment}
              selectedItem={selectedEchoItem}
              p={p}
            />
            <EchoMemoryReaderPanel
              segment={activeEchoSegment}
              listTitle={echoReaderListTitle(activeEchoSegment, title, p)}
              listSubtitle={echoReaderSubtitle(activeEchoSegment, p)}
              emptyLabel={echoReaderEmptyLabel(activeEchoSegment, p)}
              detailEmptyLabel={echoReaderDetailEmptyLabel(activeEchoSegment, p)}
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

        {echoAssistantId && segment !== 'overview' && (
          <EchoInsightCollapsible
            noAiHint={p.generateInsightNoAi}
            generatingLabel={p.insightGenerating}
            errorPrefix={p.insightErrorPrefix}
            retryLabel={p.insightRetry}
            saveLabel={p.echoSaveLabel}
            savingLabel={p.echoSavingLabel}
            savedLabel={p.echoSavedLabel}
            saveErrorPrefix={p.echoSaveErrorPrefix}
            segment={segment}
            assistantId={echoAssistantId}
            userPrompt={echoAssistantPrompt}
            generateSignal={assistantGenerateSignal}
            maxSteps={echoAssistantMaxSteps}
            onSaved={handleEchoSaved}
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
