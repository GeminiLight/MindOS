'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Archive,
  BookOpen,
  Bot,
  ClipboardCheck,
  Clock3,
  FolderOpen,
  GitBranch,
  Leaf,
  MessageSquareText,
  NotebookText,
  Pencil,
  RefreshCw,
  SunMedium,
  Trash2,
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
import {
  buildEchoCardChatPrompt,
  EchoCardActionBar,
  EchoCardBody,
  EchoCardDetailFields,
  EchoCardFrame,
  EchoCardHeader,
  EchoCardTitle,
} from './EchoSemanticCard';

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

const echoSurfaceClass =
  'rounded-xl border border-border/60 bg-card/45 shadow-sm';

const echoPanelClass =
  'rounded-xl border border-border/50 bg-background/55 shadow-sm';

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
              {p.echoStudioRouteHint}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

type PromotionTarget = 'playbook' | 'practice';
type EchoScheduleMode = 'manual' | 'daily' | 'interval';

type EchoSchedule = {
  mode: EchoScheduleMode;
  dailyTime: string;
  intervalHours: number;
};

const DEFAULT_ECHO_SCHEDULE: EchoSchedule = {
  mode: 'daily',
  dailyTime: '20:00',
  intervalHours: 24,
};
const ECHO_INTERVAL_HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];
const ECHO_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function promotionTargetLabel(target: PromotionTarget, p: EchoCopy): string {
  return target === 'playbook' ? p.promotionPlaybookLabel : p.promotionPracticeLabel;
}

function normalizePromotionTarget(target: string): PromotionTarget {
  return target === 'practice' ? 'practice' : 'playbook';
}

function isEchoScheduleMode(value: string): value is EchoScheduleMode {
  return value === 'manual' || value === 'daily' || value === 'interval';
}

function echoScheduleStatusLabel(schedule: EchoSchedule, p: EchoCopy) {
  if (schedule.mode === 'manual') return p.imprintScheduleManualOnly;
  if (schedule.mode === 'interval') return p.imprintScheduleIntervalHours(schedule.intervalHours);
  return p.imprintScheduleDailyAt(schedule.dailyTime);
}

function updateEchoScheduleMode(
  setSchedule: Dispatch<SetStateAction<EchoSchedule>>,
  value: string,
) {
  if (!isEchoScheduleMode(value)) return;
  setSchedule((current) => ({ ...current, mode: value }));
}

function updateEchoScheduleDailyTime(
  setSchedule: Dispatch<SetStateAction<EchoSchedule>>,
  value: string,
) {
  if (!ECHO_TIME_RE.test(value)) return;
  setSchedule((current) => ({ ...current, dailyTime: value }));
}

function updateEchoScheduleIntervalHours(
  setSchedule: Dispatch<SetStateAction<EchoSchedule>>,
  value: string,
) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return;
  setSchedule((current) => ({
    ...current,
    intervalHours: Math.max(1, Math.min(24, parsed)),
  }));
}

type InsightTarget = 'pattern' | 'judgment';

function insightTargetLabel(target: InsightTarget, p: EchoCopy): string {
  return target === 'pattern' ? p.insightPatternLabel : p.insightJudgmentLabel;
}

function normalizeInsightTarget(target: string): InsightTarget {
  return target === 'judgment' ? 'judgment' : 'pattern';
}

function buildCardChatPrompt({
  p,
  kindLabel,
  title,
  content,
  source,
  evidence,
}: {
  p: EchoCopy;
  kindLabel: string;
  title: string;
  content: string;
  source: string;
  evidence: string;
}) {
  return buildEchoCardChatPrompt({
    prompt: p.echoCardChatPrompt,
    kindPromptLabel: p.echoCardKindPromptLabel,
    titlePromptLabel: p.echoCardTitlePromptLabel,
    contentPromptLabel: p.echoCardContentPromptLabel,
    sourceLabel: p.echoCardSourceLabel,
    evidenceLabel: p.echoCardEvidenceLabel,
    kindLabel,
    title,
    content,
    source,
    evidence,
  });
}

function InsightPanel({
  p,
  onGenerate,
}: {
  p: EchoCopy;
  onGenerate: () => void;
}) {
  const [activeFilters, setActiveFilters] = useState<Record<InsightTarget, boolean>>({
    pattern: true,
    judgment: true,
  });
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [schedule, setSchedule] = useState<EchoSchedule>({ ...DEFAULT_ECHO_SCHEDULE });
  const insightCandidates = p.insightCandidates.map((candidate) => ({
    ...candidate,
    target: normalizeInsightTarget(candidate.kind),
  }));
  const filters: Array<{ id: InsightTarget; label: string; icon: ReactNode }> = [
    {
      id: 'pattern',
      label: p.insightPatternsLabel,
      icon: <BookOpen size={15} aria-hidden />,
    },
    {
      id: 'judgment',
      label: p.insightJudgmentsLabel,
      icon: <ClipboardCheck size={15} aria-hidden />,
    },
  ];
  const visibleInsights = insightCandidates.filter((candidate) => activeFilters[candidate.target]);
  const scheduleStatusLabel = echoScheduleStatusLabel(schedule, p);

  function toggleFilter(filter: InsightTarget) {
    setActiveFilters((current) => {
      const next = { ...current, [filter]: !current[filter] };
      return next.pattern || next.judgment ? next : current;
    });
  }

  return (
    <section
      className="min-w-0"
      aria-label={p.insightSurfaceTitle}
      data-testid="echo-insight"
    >
      <header>
        <p
          className="font-mono text-[0.68rem] leading-5 text-muted-foreground"
          data-testid="echo-insight-generation-status"
          title={p.growthReaderSubtitle}
        >
          {p.echoGeneratedStatusLine(p.insightStatusSourceLabel, scheduleStatusLabel)}
        </p>

        <div
          className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3"
          data-testid="echo-insight-control-row"
        >
          <div
            className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border/35 bg-muted/15 p-1"
            role="group"
            aria-label={p.insightFiltersAriaLabel}
            data-testid="echo-insight-filters"
          >
            {filters.map((filter) => {
              const active = activeFilters[filter.id];
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`echo-insight-filter-${filter.id}`}
                  className={cn(
                    'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                  onClick={() => toggleFilter(filter.id)}
                >
                  <span className={cn('shrink-0', active ? 'text-[var(--amber)]' : 'text-muted-foreground')}>{filter.icon}</span>
                  <span className="whitespace-nowrap font-sans text-xs font-medium sm:text-sm">{filter.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/20 bg-muted/10 p-1" data-testid="echo-insight-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'text-muted-foreground hover:text-foreground',
                isSchedulePanelOpen && 'bg-muted text-foreground',
              )}
              onClick={() => setIsSchedulePanelOpen((open) => !open)}
              aria-label={p.insightScheduleAction}
              aria-expanded={isSchedulePanelOpen}
              title={p.insightScheduleAction}
              data-testid="echo-insight-schedule-button"
            >
              <Clock3 size={13} aria-hidden />
              <span className="sr-only">{p.insightScheduleAction}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onGenerate}
              aria-label={p.insightGenerateAriaLabel}
              title={p.insightGenerateAriaLabel}
              data-testid="echo-insight-generate-button"
            >
              <RefreshCw size={14} aria-hidden />
              <span className="sr-only">{p.insightGenerateAriaLabel}</span>
            </Button>
          </div>
        </div>

        {isSchedulePanelOpen ? (
          <EchoSchedulePanel
            p={p}
            schedule={schedule}
            setSchedule={setSchedule}
            statusLabel={scheduleStatusLabel}
            testIdPrefix="echo-insight"
          />
        ) : null}
      </header>

      <div className="pt-5">
        <div className="space-y-3">
          {visibleInsights.map((candidate) => (
            <EchoCardFrame
              key={candidate.title}
              kind={candidate.target}
              testId="echo-insight-candidate"
            >
              <div className="min-w-0">
                <EchoCardHeader
                  kind={candidate.target}
                  label={insightTargetLabel(candidate.target, p)}
                  source={candidate.source}
                />
                <EchoCardTitle>{candidate.title}</EchoCardTitle>
                <EchoCardBody>{candidate.content}</EchoCardBody>
              </div>
              <EchoCardDetailFields
                sourceLabel={p.echoCardSourceLabel}
                source={candidate.source}
                evidenceLabel={p.echoCardEvidenceLabel}
                evidence={candidate.evidence}
              />
              <EchoCardActions
                p={p}
                title={candidate.title}
                onChat={() => openAskModal(buildCardChatPrompt({
                  p,
                  kindLabel: insightTargetLabel(candidate.target, p),
                  title: candidate.title,
                  content: candidate.content,
                  source: candidate.source,
                  evidence: candidate.evidence,
                }), 'user', null, { newSession: true })}
              />
            </EchoCardFrame>
          ))}
        </div>
      </div>
    </section>
  );
}

function PromotionPanel({
  p,
  onGenerate,
}: {
  p: EchoCopy;
  onGenerate: () => void;
}) {
  const [activeFilters, setActiveFilters] = useState<Record<PromotionTarget, boolean>>({
    playbook: true,
    practice: true,
  });
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [schedule, setSchedule] = useState<EchoSchedule>({ ...DEFAULT_ECHO_SCHEDULE });
  const recentPromotions = p.promotionCandidates.map((candidate) => ({
    ...candidate,
    target: normalizePromotionTarget(candidate.kind),
  }));
  const filters: Array<{ id: PromotionTarget; label: string; icon: ReactNode }> = [
    {
      id: 'playbook',
      label: p.promotionPlaybooksLabel,
      icon: <BookOpen size={15} aria-hidden />,
    },
    {
      id: 'practice',
      label: p.promotionPracticesLabel,
      icon: <ClipboardCheck size={15} aria-hidden />,
    },
  ];
  const visiblePromotions = recentPromotions.filter((candidate) => activeFilters[candidate.target]);
  const scheduleStatusLabel = echoScheduleStatusLabel(schedule, p);

  function toggleFilter(filter: PromotionTarget) {
    setActiveFilters((current) => {
      const next = { ...current, [filter]: !current[filter] };
      return next.playbook || next.practice ? next : current;
    });
  }

  return (
    <section
      className="min-w-0"
      aria-label={p.promotionReviewTitle}
      data-testid="echo-promotion"
    >
      <header>
        <p
          className="font-mono text-[0.68rem] leading-5 text-muted-foreground"
          data-testid="echo-promotion-generation-status"
          title={p.echoGeneratedStatusTitle(p.imprintCardsInitialUpdatedAt)}
        >
          {p.echoGeneratedStatusLine(p.imprintCardsCheckpointLabel, scheduleStatusLabel)}
        </p>

        <div
          className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3"
          data-testid="echo-promotion-control-row"
        >
          <div
            className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border/35 bg-muted/15 p-1"
            role="group"
            aria-label={p.promotionFiltersAriaLabel}
            data-testid="echo-promotion-filters"
          >
            {filters.map((filter) => {
              const active = activeFilters[filter.id];
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`echo-promotion-filter-${filter.id}`}
                  className={cn(
                    'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  )}
                  onClick={() => toggleFilter(filter.id)}
                >
                  <span className={cn('shrink-0', active ? 'text-[var(--amber)]' : 'text-muted-foreground')}>{filter.icon}</span>
                  <span className="whitespace-nowrap font-sans text-xs font-medium sm:text-sm">{filter.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/20 bg-muted/10 p-1" data-testid="echo-promotion-actions">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'text-muted-foreground hover:text-foreground',
                isSchedulePanelOpen && 'bg-muted text-foreground',
              )}
              onClick={() => setIsSchedulePanelOpen((open) => !open)}
              aria-label={p.promotionScheduleAction}
              aria-expanded={isSchedulePanelOpen}
              title={p.promotionScheduleAction}
              data-testid="echo-promotion-schedule-button"
            >
              <Clock3 size={13} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onGenerate}
              aria-label={p.promotionGenerateAriaLabel}
              title={p.promotionGenerateAriaLabel}
              data-testid="echo-promotion-generate-button"
            >
              <RefreshCw size={14} aria-hidden />
            </Button>
          </div>
        </div>

        {isSchedulePanelOpen ? (
          <EchoSchedulePanel
            p={p}
            schedule={schedule}
            setSchedule={setSchedule}
            statusLabel={scheduleStatusLabel}
            testIdPrefix="echo-promotion"
          />
        ) : null}

      </header>

      <div className="pt-5">
        <div className="space-y-3">
          {visiblePromotions.map((candidate) => (
            <EchoCardFrame
              key={candidate.title}
              kind={candidate.target}
              testId="echo-promotion-candidate"
            >
              <div className="min-w-0">
                <EchoCardHeader
                  kind={candidate.target}
                  label={promotionTargetLabel(candidate.target, p)}
                  source={candidate.source}
                />
                <EchoCardTitle>{candidate.title}</EchoCardTitle>
                <EchoCardBody>{candidate.content}</EchoCardBody>
              </div>
              <EchoCardDetailFields
                sourceLabel={p.echoCardSourceLabel}
                source={candidate.source}
                evidenceLabel={p.echoCardEvidenceLabel}
                evidence={candidate.evidence}
              />
              <EchoCardActions
                p={p}
                title={candidate.title}
                onChat={() => openAskModal(buildCardChatPrompt({
                  p,
                  kindLabel: promotionTargetLabel(candidate.target, p),
                  title: candidate.title,
                  content: candidate.content,
                  source: candidate.source,
                  evidence: candidate.evidence,
                }), 'user', null, { newSession: true })}
              />
            </EchoCardFrame>
          ))}
        </div>
      </div>
    </section>
  );
}

function EchoSchedulePanel({
  p,
  schedule,
  setSchedule,
  statusLabel,
  testIdPrefix,
}: {
  p: EchoCopy;
  schedule: EchoSchedule;
  setSchedule: Dispatch<SetStateAction<EchoSchedule>>;
  statusLabel: string;
  testIdPrefix: string;
}) {
  return (
    <div
      className="mt-3 grid gap-3 rounded-lg border border-border/45 bg-background/70 p-3 sm:grid-cols-[minmax(13rem,1fr)_minmax(8rem,0.45fr)] xl:grid-cols-[minmax(13rem,1fr)_minmax(8rem,0.45fr)_auto]"
      data-testid={`${testIdPrefix}-schedule-panel`}
    >
      <fieldset className="min-w-0 space-y-1.5" data-testid={`${testIdPrefix}-schedule-mode`}>
        <legend className="font-sans text-[0.7rem] font-medium text-muted-foreground">
          {p.imprintScheduleModeLabel}
        </legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/45 bg-muted/20 p-1">
          <EchoScheduleModeButton
            mode="daily"
            active={schedule.mode === 'daily'}
            label={p.imprintScheduleDailyLabel}
            testIdPrefix={testIdPrefix}
            onClick={() => updateEchoScheduleMode(setSchedule, 'daily')}
          />
          <EchoScheduleModeButton
            mode="interval"
            active={schedule.mode === 'interval'}
            label={p.imprintScheduleIntervalLabel}
            testIdPrefix={testIdPrefix}
            onClick={() => updateEchoScheduleMode(setSchedule, 'interval')}
          />
          <EchoScheduleModeButton
            mode="manual"
            active={schedule.mode === 'manual'}
            label={p.imprintScheduleManualLabel}
            testIdPrefix={testIdPrefix}
            onClick={() => updateEchoScheduleMode(setSchedule, 'manual')}
          />
        </div>
      </fieldset>
      {schedule.mode === 'daily' ? (
        <label className="grid min-w-[8rem] gap-1 font-sans text-[0.7rem] font-medium text-muted-foreground">
          <span>{p.imprintScheduleTimeLabel}</span>
          <input
            type="time"
            className="h-8 rounded-md border border-border bg-background px-2 font-sans text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            value={schedule.dailyTime}
            onChange={(event) => updateEchoScheduleDailyTime(setSchedule, event.currentTarget.value)}
            data-testid={`${testIdPrefix}-schedule-time`}
          />
        </label>
      ) : null}
      {schedule.mode === 'interval' ? (
        <label className="grid min-w-[8rem] gap-1 font-sans text-[0.7rem] font-medium text-muted-foreground">
          <span>{p.imprintScheduleEveryLabel}</span>
          <select
            className="h-8 rounded-md border border-border bg-background px-2 font-sans text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            value={String(schedule.intervalHours)}
            onChange={(event) => updateEchoScheduleIntervalHours(setSchedule, event.currentTarget.value)}
            data-testid={`${testIdPrefix}-schedule-interval`}
          >
            {ECHO_INTERVAL_HOUR_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                {p.imprintScheduleIntervalHours(hours)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex min-w-0 items-end font-mono text-[0.68rem] leading-5 text-muted-foreground sm:col-span-2 sm:justify-end xl:col-span-1">
        <span
          className="inline-flex h-8 min-w-0 items-center whitespace-nowrap rounded-md border border-border/45 bg-muted/15 px-2"
          data-testid={`${testIdPrefix}-schedule-status`}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

function EchoScheduleModeButton({
  mode,
  active,
  label,
  testIdPrefix,
  onClick,
}: {
  mode: EchoScheduleMode;
  active: boolean;
  label: string;
  testIdPrefix: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'h-7 min-w-0 rounded-md px-2 font-sans text-xs font-medium transition-[background-color,color,box-shadow,opacity] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
      )}
      aria-pressed={active}
      data-testid={`${testIdPrefix}-schedule-mode-${mode}`}
      onClick={onClick}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

function EchoCardActions({
  p,
  title,
  onChat,
}: {
  p: EchoCopy;
  title: string;
  onChat: () => void;
}) {
  return (
    <EchoCardActionBar
      left={(
        <>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Pencil size={13} aria-hidden />
            {p.promotionEditLabel}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
            <Trash2 size={13} aria-hidden />
            {p.promotionDeleteLabel}
          </Button>
        </>
      )}
      right={(
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber)] hover:bg-[var(--amber)]/15 hover:text-[var(--amber)]"
          aria-label={p.echoCardChatAria(title)}
          data-testid="echo-card-chat-button"
          onClick={onChat}
        >
          <MessageSquareText size={13} aria-hidden />
          {p.echoCardChatLabel}
        </Button>
      )}
    />
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
            `${p.echoCardEvidenceLabel} ${candidate.evidence}`,
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
            `${p.echoCardEvidenceLabel} ${candidate.evidence}`,
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
          <EchoImprintCardsReview p={p} />
        )}

        {readerEchoSegment && (
          <>
            {readerEchoSegment === 'practice' ? (
              <>
                <PromotionPanel
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
