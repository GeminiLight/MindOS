'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { EchoSegment } from '@/lib/echo-segments';
import { useLocale } from '@/lib/LocaleContext';
import { openAskModal } from '@/hooks/useAskModal';
import { EchoHero } from './EchoHero';
import EchoSegmentNav from './EchoSegmentNav';
import {
  EchoCollapsibleInsight,
  EchoContinuedGroups,
  EchoFactSnapshot,
} from './EchoPageSections';

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

const fieldLabelClass =
  'block font-sans text-2xs font-semibold uppercase tracking-wide text-muted-foreground';
const inputClass =
  'mt-2 w-full min-h-[5rem] resize-y rounded-lg border border-border bg-background px-3 py-2.5 font-sans text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const cardSectionClass =
  'rounded-xl border border-border bg-card p-5 shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--amber)]/20 hover:shadow-md sm:p-6';

export default function EchoSegmentPageClient({ segment }: { segment: EchoSegment }) {
  const { t } = useLocale();
  const p = t.echoPages;
  const echo = t.panels.echo;
  const title = segmentTitle(segment, echo);
  const lead = segmentLead(segment, p);
  const factsHeadingId = useId();
  const pageTitleId = 'echo-page-title';

  const [dailyLine, setDailyLine] = useState('');
  const [growthIntent, setGrowthIntent] = useState('');

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
  }, [dailyLine]);

  const persistGrowth = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_GROWTH, growthIntent);
    } catch {
      /* ignore */
    }
  }, [growthIntent]);

  const openDailyAsk = useCallback(() => {
    persistDaily();
    openAskModal(p.dailyAskPrefill(dailyLine), 'user');
  }, [dailyLine, p, persistDaily]);

  const primaryBtnClass =
    'inline-flex items-center rounded-lg bg-primary px-4 py-2.5 font-sans text-sm font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const secondaryBtnClass =
    'inline-flex items-center rounded-lg border border-border bg-background px-4 py-2.5 font-sans text-sm font-medium text-foreground transition-colors duration-150 hover:border-[var(--amber)]/35 hover:bg-[var(--amber-dim)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <article
      className="mx-auto max-w-3xl px-4 py-6 sm:px-6 md:py-11"
      aria-labelledby={pageTitleId}
    >
      <EchoHero
        breadcrumbNav={p.breadcrumbNav}
        parentHref="/echo/about-you"
        parent={p.parent}
        heroKicker={p.heroKicker}
        pageTitle={title}
        lead={lead}
        titleId={pageTitleId}
      />

      <EchoSegmentNav activeSegment={segment} />

      <div className="mt-6 space-y-6 sm:mt-8">
        <EchoFactSnapshot
          headingId={factsHeadingId}
          heading={p.factsHeading}
          snapshotBadge={p.snapshotBadge}
          emptyTitle={p.emptyFactsTitle}
          emptyBody={p.emptyFactsBody}
        />
        {segment === 'continued' ? (
          <EchoContinuedGroups
            draftsLabel={p.continuedDrafts}
            todosLabel={p.continuedTodos}
            subEmptyHint={p.subEmptyHint}
          />
        ) : null}
      </div>

      {segment === 'daily' ? (
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
          <div className="mt-4">
            <button type="button" onClick={openDailyAsk} className={primaryBtnClass}>
              {p.continueAgent}
            </button>
          </div>
        </section>
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
          <p className="mt-3 font-sans text-2xs text-muted-foreground">{p.growthSavedNote}</p>
        </section>
      ) : null}

      {segment === 'past-you' ? (
        <section className={`${cardSectionClass} mt-6`}>
          <button
            type="button"
            disabled
            title={p.pastYouDisabledHint}
            className="inline-flex cursor-not-allowed items-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-2.5 font-sans text-sm text-muted-foreground opacity-85"
          >
            {p.pastYouAnother}
          </button>
          <p className="mt-3 font-sans text-2xs text-muted-foreground">{p.pastYouDisabledHint}</p>
        </section>
      ) : null}

      {segment !== 'daily' ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openAskModal(`${p.parent} / ${title}\n\n`, 'user')}
            className={secondaryBtnClass}
          >
            {p.continueAgent}
          </button>
        </div>
      ) : null}

      <EchoCollapsibleInsight
        title={p.insightTitle}
        showLabel={p.insightShow}
        hideLabel={p.insightHide}
        hint={p.insightHint}
        generateLabel={p.generateInsight}
        disabledHint={p.generateInsightDisabled}
      />
    </article>
  );
}
