'use client';

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useMemo, useState } from 'react';
import { BookOpen, Check, ClipboardCheck, Clock3, ListFilter, MessageSquareText, Pencil, RefreshCw } from 'lucide-react';
import { openAskModal } from '@/hooks/useAskModal';
import type { Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import EchoPromotionReviewActions from './EchoPromotionReviewActions';
import {
  buildEchoCardChatPrompt,
  EchoCardActionBar,
  EchoCardBody,
  EchoCardDeleteButton,
  EchoCardDetailFields,
  EchoCardFrame,
  EchoCardHeader,
  EchoCardTitle,
} from './EchoSemanticCard';
import {
  ECHO_INTERVAL_HOUR_OPTIONS,
  echoScheduleStatusLabel,
  formatStructuredSourceForPrompt,
  normalizePromotionTarget,
  promotionTargetLabel,
  updateEchoScheduleDailyTime,
  updateEchoScheduleIntervalHours,
  updateEchoScheduleMode,
  useEchoStructuredCards,
  type EchoCopy,
  type EchoSchedule,
  type EchoScheduleMode,
  type EchoStructuredCard,
  type PromotionTarget,
} from './echo-structured-cards';

export type InsightTarget = 'pattern' | 'judgment';

export function insightTargetLabel(target: InsightTarget, p: EchoCopy): string {
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
}: {
  p: EchoCopy;
  kindLabel: string;
  title: string;
  content: string;
  source: string;
}) {
  return buildEchoCardChatPrompt({
    prompt: p.echoCardChatPrompt,
    kindPromptLabel: p.echoCardKindPromptLabel,
    titlePromptLabel: p.echoCardTitlePromptLabel,
    contentPromptLabel: p.echoCardContentPromptLabel,
    sourceLabel: p.echoCardSourceLabel,
    kindLabel,
    title,
    content,
    source,
  });
}

export function InsightPanel({
  p,
  locale,
}: {
  p: EchoCopy;
  locale: Locale;
}) {
  const [activeFilters, setActiveFilters] = useState<Record<InsightTarget, boolean>>({
    pattern: true,
    judgment: true,
  });
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const initialCards = useMemo(() => p.insightCandidates.map((candidate, index): EchoStructuredCard<InsightTarget> => ({
    id: `insight-fallback-${index}`,
    kind: normalizeInsightTarget(candidate.kind),
    title: candidate.title,
    content: candidate.content,
    createdAt: p.imprintCardsInitialUpdatedAt,
    source: { label: candidate.source, sessions: [] },
  })), [p]);
  const {
    cards,
    schedule,
    setSchedule,
    isGenerating,
    editingId,
    draftContent,
    requestGeneratedCards,
    updateDraftContent,
    toggleEditing,
    deleteCard,
  } = useEchoStructuredCards({
    apiSegment: 'insight',
    initialCards,
    normalizeKind: normalizeInsightTarget,
    locale,
  });
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
  const visibleInsights = cards.filter((candidate) => activeFilters[candidate.kind]);
  const scheduleStatusLabel = echoScheduleStatusLabel(schedule, p);
  const allFiltersActive = activeFilters.pattern && activeFilters.judgment;

  function toggleAllFilters() {
    setActiveFilters((current) => {
      const allActive = current.pattern && current.judgment;
      return {
        pattern: !allActive,
        judgment: !allActive,
      };
    });
  }

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
            <button
              type="button"
              aria-pressed={allFiltersActive}
              data-testid="echo-insight-filter-all"
              className={cn(
                'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                allFiltersActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
              onClick={toggleAllFilters}
            >
              <span className={cn('shrink-0', allFiltersActive ? 'text-[var(--amber)]' : 'text-muted-foreground')}>
                <ListFilter size={15} aria-hidden />
              </span>
              <span className="whitespace-nowrap font-sans text-xs font-medium sm:text-sm">{p.echoCardAllFilterLabel}</span>
            </button>
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
              onClick={() => void requestGeneratedCards('manual')}
              aria-label={p.insightGenerateAriaLabel}
              title={p.insightGenerateAriaLabel}
              data-testid="echo-insight-generate-button"
              disabled={isGenerating}
            >
              <RefreshCw size={14} className={cn(isGenerating && 'animate-spin')} aria-hidden />
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
          {visibleInsights.length > 0 ? visibleInsights.map((candidate) => {
            const content = draftContent[candidate.id] ?? candidate.content;
            const source = formatStructuredSourceForPrompt(candidate.source) || candidate.source.label;
            const isEditing = editingId === candidate.id;
            return (
              <EchoCardFrame
                key={candidate.id}
                kind={candidate.kind}
                testId="echo-insight-candidate"
              >
                <div className="min-w-0">
                  <EchoCardHeader
                    kind={candidate.kind}
                    label={insightTargetLabel(candidate.kind, p)}
                    timestamp={candidate.createdAt}
                  />
                  <EchoCardTitle>{candidate.title}</EchoCardTitle>
                  {isEditing ? (
                    <textarea
                      className="mt-3 min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm leading-6 text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                      aria-label={p.imprintCardEditAria(candidate.title)}
                      value={content}
                      onChange={(event) => updateDraftContent(candidate.id, event.currentTarget.value)}
                    />
                  ) : (
                    <EchoCardBody>{content}</EchoCardBody>
                  )}
                </div>
                <EchoCardDetailFields
                  sourceLabel={p.echoCardSourceLabel}
                  source={source}
                />
                <EchoCardActions
                  p={p}
                  title={candidate.title}
                  isEditing={isEditing}
                  onEdit={() => toggleEditing(candidate.id)}
                  onDelete={() => void deleteCard(candidate.id)}
                  onChat={() => openAskModal(buildCardChatPrompt({
                    p,
                    kindLabel: insightTargetLabel(candidate.kind, p),
                    title: candidate.title,
                    content,
                    source,
                  }), 'user', null, { newSession: true })}
                />
              </EchoCardFrame>
            );
          }) : (
            <EchoStructuredEmptyState
              label={p.insightCardsEmptyLabel}
              testId="echo-insight-empty"
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function PromotionPanel({
  p,
  locale,
}: {
  p: EchoCopy;
  locale: Locale;
}) {
  const [activeFilters, setActiveFilters] = useState<Record<PromotionTarget, boolean>>({
    playbook: true,
    practice: true,
  });
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const initialCards = useMemo(() => p.promotionCandidates.map((candidate, index): EchoStructuredCard<PromotionTarget> => ({
    id: `promotion-fallback-${index}`,
    kind: normalizePromotionTarget(candidate.kind),
    title: candidate.title,
    content: candidate.content,
    createdAt: p.imprintCardsInitialUpdatedAt,
    source: { label: candidate.source, sessions: [] },
  })), [p]);
  const {
    cards,
    schedule,
    setSchedule,
    isGenerating,
    editingId,
    draftContent,
    requestGeneratedCards,
    updateDraftContent,
    toggleEditing,
    deleteCard,
    reviewCard,
    reviewingId,
    reviewErrorById,
  } = useEchoStructuredCards({
    apiSegment: 'promotion',
    initialCards,
    normalizeKind: normalizePromotionTarget,
    locale,
  });
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
  const visiblePromotions = cards.filter((candidate) => activeFilters[candidate.kind]);
  const scheduleStatusLabel = echoScheduleStatusLabel(schedule, p);
  const allFiltersActive = activeFilters.playbook && activeFilters.practice;

  function toggleAllFilters() {
    setActiveFilters((current) => {
      const allActive = current.playbook && current.practice;
      return {
        playbook: !allActive,
        practice: !allActive,
      };
    });
  }

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
            <button
              type="button"
              aria-pressed={allFiltersActive}
              data-testid="echo-promotion-filter-all"
              className={cn(
                'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                allFiltersActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
              )}
              onClick={toggleAllFilters}
            >
              <span className={cn('shrink-0', allFiltersActive ? 'text-[var(--amber)]' : 'text-muted-foreground')}>
                <ListFilter size={15} aria-hidden />
              </span>
              <span className="whitespace-nowrap font-sans text-xs font-medium sm:text-sm">{p.echoCardAllFilterLabel}</span>
            </button>
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
              onClick={() => void requestGeneratedCards('manual')}
              aria-label={p.promotionGenerateAriaLabel}
              title={p.promotionGenerateAriaLabel}
              data-testid="echo-promotion-generate-button"
              disabled={isGenerating}
            >
              <RefreshCw size={14} className={cn(isGenerating && 'animate-spin')} aria-hidden />
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
          {visiblePromotions.length > 0 ? visiblePromotions.map((candidate) => {
            const content = draftContent[candidate.id] ?? candidate.content;
            const source = formatStructuredSourceForPrompt(candidate.source) || candidate.source.label;
            const isEditing = editingId === candidate.id;
            return (
              <EchoCardFrame
                key={candidate.id}
                kind={candidate.kind}
                testId="echo-promotion-candidate"
              >
                <div className="min-w-0">
                  <EchoCardHeader
                    kind={candidate.kind}
                    label={promotionTargetLabel(candidate.kind, p)}
                    timestamp={candidate.createdAt}
                  />
                  <EchoCardTitle>{candidate.title}</EchoCardTitle>
                  {isEditing ? (
                    <textarea
                      className="mt-3 min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm leading-6 text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                      aria-label={p.imprintCardEditAria(candidate.title)}
                      value={content}
                      onChange={(event) => updateDraftContent(candidate.id, event.currentTarget.value)}
                    />
                  ) : (
                    <EchoCardBody>{content}</EchoCardBody>
                  )}
                </div>
                <EchoCardDetailFields
                  sourceLabel={p.echoCardSourceLabel}
                  source={source}
                />
                <EchoPromotionReviewActions
                  review={candidate.review}
                  canReview={candidate.source.sessions.some((session) => (session.messageRefs?.length ?? 0) > 0)}
                  reviewing={reviewingId === candidate.id}
                  error={reviewErrorById[candidate.id] ? p.promotionReviewFailedLabel : undefined}
                  approveLabel={p.promotionApproveLabel}
                  rejectLabel={p.promotionRejectLabel}
                  approvedLabel={p.promotionApprovedLabel}
                  rejectedLabel={p.promotionRejectedLabel}
                  assetPathLabel={p.promotionAssetPathLabel}
                  onApprove={() => void reviewCard(candidate.id, 'approve')}
                  onReject={() => void reviewCard(candidate.id, 'reject')}
                />
                <EchoCardActions
                  p={p}
                  title={candidate.title}
                  isEditing={isEditing}
                  onEdit={() => toggleEditing(candidate.id)}
                  onDelete={() => void deleteCard(candidate.id)}
                  onChat={() => openAskModal(buildCardChatPrompt({
                    p,
                    kindLabel: promotionTargetLabel(candidate.kind, p),
                    title: candidate.title,
                    content,
                    source,
                  }), 'user', null, { newSession: true })}
                  readOnly={candidate.review?.status === 'approved' || candidate.review?.status === 'rejected'}
                />
              </EchoCardFrame>
            );
          }) : (
            <EchoStructuredEmptyState
              label={p.promotionCardsEmptyLabel}
              testId="echo-promotion-empty"
            />
          )}
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
  isEditing,
  onEdit,
  onDelete,
  onChat,
  readOnly = false,
}: {
  p: EchoCopy;
  title: string;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onChat: () => void;
  readOnly?: boolean;
}) {
  return (
    <EchoCardActionBar
      left={readOnly ? null : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            title={isEditing ? p.imprintCardDoneLabel : p.promotionEditLabel}
            aria-label={isEditing ? p.imprintCardDoneLabel : p.promotionEditLabel}
            onClick={onEdit}
          >
            {isEditing ? <Check size={13} aria-hidden /> : <Pencil size={13} aria-hidden />}
            {isEditing ? p.imprintCardDoneLabel : p.promotionEditLabel}
          </Button>
          <EchoCardDeleteButton
            label={p.promotionDeleteLabel}
            confirmLabel={p.echoCardConfirmDeleteLabel}
            cancelLabel={p.echoCardCancelDeleteLabel}
            onDelete={onDelete}
          />
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

function EchoStructuredEmptyState({
  label,
  testId,
}: {
  label: string;
  testId: string;
}) {
  return (
    <p
      className="rounded-lg border border-border/45 bg-muted/10 px-4 py-5 font-sans text-sm leading-6 text-muted-foreground"
      data-testid={testId}
    >
      {label}
    </p>
  );
}
