'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Brain, Check, History, Sun, UserRound } from 'lucide-react';
import type { EchoSegment } from '@/lib/echo-segments';
import { buildEchoInsightUserPrompt } from '@/lib/echo-insight-prompt';
import type { Locale, Messages } from '@/lib/i18n';
import { useLocale } from '@/lib/stores/locale-store';
import { openAskModal } from '@/hooks/useAskModal';
import { EchoHero } from './EchoHero';
import EchoSegmentNav from './EchoSegmentNav';
import { EchoInsightCollapsible } from './EchoInsightCollapsible';
import { EchoContinuedGroups, EchoFactSnapshot } from './EchoPageSections';
import DailyEchoReportButton from './DailyEcho/DailyEchoReportButton';
import DailyEchoReportDrawer from './DailyEcho/DailyEchoReportDrawer';
import type { DailyEchoReport } from '@/lib/daily-echo/types';
import { generateDailyEchoReport } from '@/lib/daily-echo/generator';
import { loadDailyEchoConfig } from '@/lib/daily-echo/config';

const STORAGE_DAILY = 'mindos-echo-daily-line';
const STORAGE_GROWTH = 'mindos-echo-growth-intent';

function segmentTitle(segment: EchoSegment, echo: ReturnType<typeof useLocale>['t']['panels']['echo']): string {
  switch (segment) {
    case 'about-you':
      return echo.aboutYouTitle;
    case 'continued':
      return echo.continuedTitle;
    case 'daily':
      return echo.dailyEchoTitle;
    case 'past-you':
      return echo.pastYouTitle;
    case 'growth':
      return echo.intentGrowthTitle;
  }
}

function segmentLead(segment: EchoSegment, p: ReturnType<typeof useLocale>['t']['echoPages']): string {
  switch (segment) {
    case 'about-you':
      return p.aboutYouLead;
    case 'continued':
      return p.continuedLead;
    case 'daily':
      return p.dailyLead;
    case 'past-you':
      return p.pastYouLead;
    case 'growth':
      return p.growthLead;
  }
}

const SEGMENT_ICON: Record<EchoSegment, ReactNode> = {
  'about-you': <UserRound size={18} strokeWidth={1.75} />,
  continued: <Bookmark size={18} strokeWidth={1.75} />,
  daily: <Sun size={18} strokeWidth={1.75} />,
  'past-you': <History size={18} strokeWidth={1.75} />,
  growth: <Brain size={18} strokeWidth={1.75} />,
};

const fieldLabelClass =
  'block font-sans text-2xs font-semibold uppercase tracking-wide text-muted-foreground';
const inputClass =
  'mt-2 w-full min-h-[5rem] resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-sans text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-[var(--amber)]/40';
const cardSectionClass =
  'rounded-xl border border-border bg-card p-5 shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--amber)]/20 hover:shadow sm:p-6';

function echoSnapshotCopy(segment: EchoSegment, p: Messages['echoPages']): { title: string; body: string } {
  switch (segment) {
    case 'about-you':
      return { title: p.snapshotAboutYouTitle, body: p.snapshotAboutYouBody };
    case 'continued':
      return { title: p.snapshotContinuedTitle, body: p.snapshotContinuedBody };
    case 'daily':
      return { title: p.snapshotDailyTitle, body: p.snapshotDailyBody };
    case 'past-you':
      return { title: p.snapshotPastYouTitle, body: p.snapshotPastYouBody };
    case 'growth':
      return { title: p.snapshotGrowthTitle, body: p.snapshotGrowthBody };
  }
}

export default function EchoSegmentPageClient({ segment }: { segment: EchoSegment }) {
  const { t, locale } = useLocale();
  const p = t.echoPages;
  const echo = t.panels.echo;
  const title = segmentTitle(segment, echo);
  const lead = segmentLead(segment, p);
  const factsHeadingId = useId();
  const pageTitleId = 'echo-page-title';

  const [dailyLine, setDailyLine] = useState('');
  const [growthIntent, setGrowthIntent] = useState('');
  const [dailySaved, setDailySaved] = useState(false);
  const [growthSaved, setGrowthSaved] = useState(false);
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
      /* ignore */
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

  const openDailyAsk = useCallback(() => {
    persistDaily();
    openAskModal(p.dailyAskPrefill(dailyLine), 'user');
  }, [dailyLine, p, persistDaily]);

  const openSegmentAsk = useCallback(() => {
    openAskModal(`${p.parent} / ${title}\n\n`, 'user');
  }, [p.parent, title]);

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
      console.error('[EchoDaily] Regenerate failed:', err);
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
        continuedDrafts: p.continuedDrafts,
        continuedTodos: p.continuedTodos,
        subEmptyHint: p.subEmptyHint,
        dailyLineLabel: p.dailyLineLabel,
        dailyLine,
        growthIntentLabel: p.growthIntentLabel,
        growthIntent,
      }),
    [
      locale,
      segment,
      title,
      p.factsHeading,
      snapshot,
      p.continuedDrafts,
      p.continuedTodos,
      p.subEmptyHint,
      p.dailyLineLabel,
      dailyLine,
      p.growthIntentLabel,
      growthIntent,
    ],
  );

  const secondaryBtnClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2.5 font-sans text-sm font-medium text-foreground transition-colors duration-150 hover:border-[var(--amber)]/35 hover:bg-[var(--amber-dim)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  const agentBtn = (onClick: () => void) => (
    <button type="button" onClick={onClick} className={secondaryBtnClass}>
      {p.continueAgent}
      <ArrowUpRight size={14} className="shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );

  return (
    <article
      className="mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-11"
      aria-labelledby={pageTitleId}
    >
      <EchoHero
        heroKicker={p.heroKicker}
        pageTitle={title}
        lead={lead}
        titleId={pageTitleId}
      >
        <EchoSegmentNav activeSegment={segment} />
      </EchoHero>

      <div className="mt-6 space-y-6 sm:mt-8">
        <EchoFactSnapshot
          headingId={factsHeadingId}
          heading={p.factsHeading}
          snapshotBadge={p.snapshotBadge}
          emptyTitle={snapshot.title}
          emptyBody={snapshot.body}
          icon={SEGMENT_ICON[segment]}
          actions={segment === 'about-you' ? agentBtn(openSegmentAsk) : undefined}
        />
        {segment === 'continued' ? (
          <EchoContinuedGroups
            draftsLabel={p.continuedDrafts}
            todosLabel={p.continuedTodos}
            subEmptyHint={p.subEmptyHint}
            footer={agentBtn(openSegmentAsk)}
          />
        ) : null}
      </div>

      {segment === 'daily' ? (
        <>
          <section className={`${cardSectionClass} mt-6`}>
            <label htmlFor="echo-daily-line" className={fieldLabelClass}>
              {p.dailyLineLabel}
            </label>
            <textarea
              id="echo-daily-line"
              value={dailyLine}
              onChange={(e) => setDailyLine(e.target.value)}
              onBlur={persistDaily}
              rows={3}
              placeholder={p.dailyLinePlaceholder}
              className={inputClass}
            />
            <p className="mt-3 flex items-center gap-2 font-sans text-2xs text-muted-foreground">
              <span>{p.dailySavedNote}</span>
              <span className="inline-flex items-center gap-1 text-[var(--success)]" aria-live="polite">
                {dailySaved ? <><Check size={12} aria-hidden /> {p.savedFlash}</> : null}
              </span>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <DailyEchoReportButton
                onGenerated={handleDailyEchoGenerated}
                onError={(err) => console.error('[EchoDaily]', err)}
                locale={{ t: p }}
              />
              {agentBtn(openDailyAsk)}
            </div>
          </section>
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
      ) : null}

      {segment === 'growth' ? (
        <section className={`${cardSectionClass} mt-6`}>
          <label htmlFor="echo-growth-intent" className={fieldLabelClass}>
            {p.growthIntentLabel}
          </label>
          <textarea
            id="echo-growth-intent"
            value={growthIntent}
            onChange={(e) => setGrowthIntent(e.target.value)}
            onBlur={persistGrowth}
            rows={4}
            placeholder={p.growthIntentPlaceholder}
            className={`${inputClass} min-h-[6.5rem]`}
          />
          <p className="mt-3 flex items-center gap-2 font-sans text-2xs text-muted-foreground">
            <span>{p.growthSavedNote}</span>
            <span className="inline-flex items-center gap-1 text-[var(--success)]" aria-live="polite">
              {growthSaved ? <><Check size={12} aria-hidden /> {p.savedFlash}</> : null}
            </span>
          </p>
          <div className="mt-4 border-t border-border/60 pt-4">
            {agentBtn(openSegmentAsk)}
          </div>
        </section>
      ) : null}

      {segment === 'past-you' ? (
        <section className={`${cardSectionClass} mt-6`}>
          <div className="flex items-center gap-3">
            <span className={fieldLabelClass}>{p.pastYouDrawLabel}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-sans text-2xs font-medium text-muted-foreground">
              {p.pastYouComingSoon}
            </span>
          </div>
          <p className="mt-3 font-sans text-sm leading-relaxed text-muted-foreground">{p.pastYouDisabledHint}</p>
          <div className="mt-4 border-t border-border/60 pt-4">
            {agentBtn(openSegmentAsk)}
          </div>
        </section>
      ) : null}

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
    </article>
  );
}
