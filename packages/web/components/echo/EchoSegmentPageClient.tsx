'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { type EchoSegment } from '@/lib/echo-segments';
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
import { openAskModal } from '@/hooks/useAskModal';
import { useSessions } from '@/lib/agent-session-store';
import { ContentPageShell } from '@/components/shared/ContentPageShell';
import { EchoPageHeader } from './EchoSegmentPageHeader';
import EchoImprintCardsReview from './EchoImprintCardsReview';
import { EchoInsightCollapsible } from './EchoInsightCollapsible';
import EchoMemoryReaderPanel from './EchoMemoryReaderPanel';
import { EchoWorktablePanel, OverviewPanel } from './EchoOverviewPanels';
import {
  InsightPanel,
  PromotionPanel,
  insightTargetLabel,
  type InsightTarget,
} from './EchoStructuredPanels';
import { promotionTargetLabel, type PromotionTarget } from './echo-structured-cards';

const STORAGE_DAILY = 'mindos-echo-daily-line';

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
  'echo-content-page';

const echoBodyClass =
  'flex w-full flex-col gap-6';

function echoReaderListTitle(segment: EchoStoredSegment, title: string, p: EchoCopy): string {
  if (segment === 'imprint') return p.imprintEventBookTitle;
  if (segment === 'threads') return p.threadsListTitle;
  if (segment === 'growth') return p.echoSavedListTitle;
  return title;
}

function echoReaderSubtitle(segment: EchoStoredSegment, p: EchoCopy): string {
  switch (segment) {
    case 'imprint':
      return p.imprintEventBookSubtitle;
    case 'threads':
      return p.threadsReaderSubtitle;
    case 'growth':
      return '';
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

export default function EchoSegmentPageClient({ segment }: { segment: EchoSegment }) {
  const { t, locale } = useLocale();
  const p = t.echoPages;
  const echo = t.panels.echo;
  const title = segmentTitle(segment, echo);
  const lead = segmentLead(segment, p);
  const pageTitleId = 'echo-page-title';
  const sessions = useSessions();

  const [dailyLine, setDailyLine] = useState('');
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
  const savedEchoReaderSegment: EchoStoredSegment | null =
    readerEchoSegment === 'threads' ? readerEchoSegment : null;
  const recentSessions = useMemo(() => buildEchoRecentSessionSummaries(sessions), [sessions]);
  const selectedEchoItem = savedEchoReaderSegment
    ? (savedEchoDetail ?? savedEchoItems.find((item) => item.path === selectedEchoPath) ?? null)
    : null;

  useEffect(() => {
    if (!savedEchoReaderSegment) {
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

    fetch(`/api/echo?segment=${savedEchoReaderSegment}`, { signal: ctrl.signal })
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
  }, [savedEchoReaderSegment]);

  useEffect(() => {
    if (!savedEchoReaderSegment || savedEchoItems.length === 0) {
      setSelectedEchoPath(null);
      return;
    }

    setSelectedEchoPath((current) => {
      if (current && savedEchoItems.some((item) => item.path === current)) return current;
      return savedEchoItems[0]?.path ?? null;
    });
  }, [savedEchoReaderSegment, savedEchoItems]);

  useEffect(() => {
    if (!savedEchoReaderSegment || !selectedEchoPath) {
      setSavedEchoDetail(null);
      setSavedEchoDetailLoading(false);
      setSavedEchoDetailError('');
      return;
    }

    const ctrl = new AbortController();
    setSavedEchoDetailLoading(true);
    setSavedEchoDetailError('');

    fetch(`/api/echo?segment=${savedEchoReaderSegment}&path=${encodeURIComponent(selectedEchoPath)}`, { signal: ctrl.signal })
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
  }, [savedEchoReaderSegment, selectedEchoPath]);

  const handleEchoSaved = useCallback((item: EchoSavedItem) => {
    if (!savedEchoReaderSegment || item.segment !== savedEchoReaderSegment) return;
    setSavedEchoItems((current) => [
      item,
      ...current.filter((entry) => entry.path !== item.path),
    ]);
    setSelectedEchoPath(item.path);
  }, [savedEchoReaderSegment]);

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
        {
          label: p.insightSurfaceTitle,
          value: p.insightCandidates.map((candidate) => [
            `${candidate.title} -> ${insightTargetLabel(candidate.kind as InsightTarget, p)}`,
            `${p.echoCardSourceLabel} ${candidate.source}`,
            candidate.content,
          ].join(' / ')).join(' | '),
        },
      );
    }

    if (segment === 'practice' && !savedEchoDetail) {
      facts.push(
        {
          label: p.promotionPendingTitle,
          value: p.promotionCandidates.map((candidate) => [
            `${candidate.title} -> ${promotionTargetLabel(candidate.kind as PromotionTarget, p)}`,
            `${p.echoCardSourceLabel} ${candidate.source}`,
            candidate.content,
          ].join(' / ')).join(' | '),
        },
      );
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
          <EchoImprintCardsReview p={p} locale={locale as Locale} />
        )}

        {readerEchoSegment && (
          <>
            {readerEchoSegment === 'practice' ? (
              <>
                <PromotionPanel
                  p={p}
                  locale={locale as Locale}
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
                    draftTitle={p.promotionDraftTitle}
                    draftIdleLabel={p.promotionDraftIdleLabel}
                    draftOutputLabel={p.promotionDraftOutputLabel}
                    draftSavedHint={p.echoDraftSavedHint}
                    segment={readerEchoSegment}
                    assistantId={echoAssistantId}
                    userPrompt={echoAssistantPrompt}
                    generateSignal={assistantGenerateSignal}
                    maxSteps={echoAssistantMaxSteps}
                    onSaved={handleEchoSaved}
                    hideUntilRequested
                  />
                ) : null}
              </>
            ) : readerEchoSegment === 'growth' ? (
              <>
                <InsightPanel
                  p={p}
                  locale={locale as Locale}
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
                    hideUntilRequested
                  />
                ) : null}
              </>
            ) : (
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
            )}
            {savedEchoReaderSegment ? (
              <EchoMemoryReaderPanel
                segment={savedEchoReaderSegment}
                listTitle={echoReaderListTitle(savedEchoReaderSegment, title, p)}
                listSubtitle={echoReaderSubtitle(savedEchoReaderSegment, p)}
                emptyLabel={echoReaderEmptyLabel(savedEchoReaderSegment, p)}
                detailEmptyLabel={echoReaderDetailEmptyLabel(savedEchoReaderSegment, p)}
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
            ) : null}
          </>
        )}
      </div>
    </ContentPageShell>
  );
}
