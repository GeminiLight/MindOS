'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import type { EchoSegment } from '@/lib/echo-segments';
import { useLocale } from '@/lib/LocaleContext';
import { openAskModal } from '@/hooks/useAskModal';
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

export default function EchoSegmentPageClient({ segment }: { segment: EchoSegment }) {
  const { t } = useLocale();
  const p = t.echoPages;
  const echo = t.panels.echo;
  const title = segmentTitle(segment, echo);
  const lead = segmentLead(segment, p);
  const factsHeadingId = useId();

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

  return (
    <article className="max-w-2xl mx-auto px-4 py-8 md:py-10" aria-labelledby="echo-page-title">
      <nav aria-label={p.breadcrumbNav} className="text-sm text-muted-foreground mb-6 font-sans">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <li>
            <Link
              href="/echo/about-you"
              className="hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-0.5"
            >
              {p.parent}
            </Link>
          </li>
          <li aria-hidden className="text-border">
            /
          </li>
          <li className="text-foreground font-medium" aria-current="page">
            {title}
          </li>
        </ol>
      </nav>

      <h1 id="echo-page-title" className="font-display text-2xl md:text-3xl text-foreground tracking-tight">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed font-sans">{lead}</p>

      <div className="mt-8 space-y-4">
        <EchoFactSnapshot
          headingId={factsHeadingId}
          heading={p.factsHeading}
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
        <div className="mt-6 rounded-lg border border-border/60 bg-card/30 p-4">
          <label htmlFor="echo-daily-line" className="text-sm font-medium text-foreground font-sans">
            {p.dailyLineLabel}
          </label>
          <textarea
            id="echo-daily-line"
            value={dailyLine}
            onChange={(e) => setDailyLine(e.target.value)}
            onBlur={persistDaily}
            rows={3}
            placeholder={p.dailyLinePlaceholder}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[5rem]"
          />
          <button
            type="button"
            onClick={openDailyAsk}
            className="mt-3 inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground font-sans hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {p.continueAgent}
          </button>
        </div>
      ) : null}

      {segment === 'growth' ? (
        <div className="mt-6 rounded-lg border border-border/60 bg-card/30 p-4">
          <label htmlFor="echo-growth-intent" className="text-sm font-medium text-foreground font-sans">
            {p.growthIntentLabel}
          </label>
          <textarea
            id="echo-growth-intent"
            value={growthIntent}
            onChange={(e) => setGrowthIntent(e.target.value)}
            onBlur={persistGrowth}
            rows={4}
            placeholder={p.growthIntentPlaceholder}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[6rem]"
          />
          <p className="mt-2 text-2xs text-muted-foreground font-sans">{p.growthSavedNote}</p>
        </div>
      ) : null}

      {segment === 'past-you' ? (
        <div className="mt-6">
          <button
            type="button"
            disabled
            title={p.pastYouDisabledHint}
            className="inline-flex items-center rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground font-sans opacity-80 cursor-not-allowed"
          >
            {p.pastYouAnother}
          </button>
          <p className="mt-2 text-2xs text-muted-foreground font-sans">{p.pastYouDisabledHint}</p>
        </div>
      ) : null}

      {segment !== 'daily' ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => openAskModal(`${p.parent} / ${title}\n\n`, 'user')}
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground font-sans hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
