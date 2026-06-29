'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  ListFilter,
  MessageSquareText,
  NotebookText,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Target,
  Trash2,
} from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useVisiblePolling } from '@/lib/use-visible-polling';

type EchoCopy = Messages['echoPages'];
type ImprintCardType = 'event' | 'signal' | 'next';
type ImprintGenerationTrigger = 'auto' | 'manual';
type ImprintScheduleMode = 'manual' | 'daily' | 'interval';

type ImprintSchedule = {
  mode: ImprintScheduleMode;
  dailyTime: string;
  intervalHours: number;
  due?: boolean;
  nextRunAt?: string;
};

type ImprintGenerationState = {
  trigger: ImprintGenerationTrigger;
  updatedAt: string;
  runCount: number;
};

type ImprintCardCandidate = {
  id: string;
  type: ImprintCardType;
  title: string;
  summary: string;
  createdAt: string;
  source: string;
  whyItMatters: string;
  route: string;
};

type RemoteImprintCard = Partial<ImprintCardCandidate> & {
  id?: string;
  type?: string;
};

type ImprintCardsApiResponse = {
  state?: {
    lastGeneratedAt?: string;
    lastTrigger?: ImprintGenerationTrigger;
    runCount?: number;
    schedule?: Partial<ImprintSchedule>;
  };
  cards?: RemoteImprintCard[];
  skipped?: boolean;
};

const laneOrder: ImprintCardType[] = ['event', 'signal', 'next'];
const IMPRINT_STATUS_REFRESH_MS = 60_000;
const DEFAULT_IMPRINT_SCHEDULE: ImprintSchedule = {
  mode: 'daily',
  dailyTime: '20:00',
  intervalHours: 24,
};
const INTERVAL_HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function formatGenerationTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isImprintCardType(type: string): type is ImprintCardType {
  return type === 'event' || type === 'signal' || type === 'next';
}

function normalizeCandidate(candidate: EchoCopy['imprintCardCandidates'][number], index: number): ImprintCardCandidate {
  const type = isImprintCardType(candidate.type) ? candidate.type : 'event';
  return {
    id: `${type}-${index}`,
    type,
    title: candidate.title,
    summary: candidate.summary,
    createdAt: candidate.createdAt,
    source: candidate.source,
    whyItMatters: candidate.whyItMatters,
    route: candidate.route,
  };
}

function normalizeRemoteCandidate(candidate: RemoteImprintCard, index: number): ImprintCardCandidate | null {
  const type = typeof candidate.type === 'string' && isImprintCardType(candidate.type) ? candidate.type : null;
  if (!type || typeof candidate.title !== 'string' || typeof candidate.summary !== 'string') return null;
  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `${type}-remote-${index}`,
    type,
    title: candidate.title,
    summary: candidate.summary,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    source: typeof candidate.source === 'string' ? candidate.source : '',
    whyItMatters: typeof candidate.whyItMatters === 'string' ? candidate.whyItMatters : '',
    route: typeof candidate.route === 'string' ? candidate.route : '',
  };
}

function formatApiTime(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return formatGenerationTime(parsed);
}

function formatScheduleClock(value: string | undefined) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return formatGenerationTime(parsed);
}

function isScheduleMode(value: string): value is ImprintScheduleMode {
  return value === 'manual' || value === 'daily' || value === 'interval';
}

function normalizeRemoteSchedule(value: Partial<ImprintSchedule> | undefined, fallback: ImprintSchedule): ImprintSchedule {
  if (!value) return fallback;
  const mode = typeof value.mode === 'string' && isScheduleMode(value.mode) ? value.mode : fallback.mode;
  const dailyTime = typeof value.dailyTime === 'string' && TIME_RE.test(value.dailyTime) ? value.dailyTime : fallback.dailyTime;
  const intervalHours = typeof value.intervalHours === 'number' && Number.isFinite(value.intervalHours)
    ? Math.max(1, Math.min(24, Math.round(value.intervalHours)))
    : fallback.intervalHours;
  return {
    mode,
    dailyTime,
    intervalHours,
    ...(typeof value.due === 'boolean' ? { due: value.due } : {}),
    ...(typeof value.nextRunAt === 'string' ? { nextRunAt: value.nextRunAt } : {}),
  };
}

function editableSchedule(schedule: ImprintSchedule): ImprintSchedule {
  return {
    mode: schedule.mode,
    dailyTime: schedule.dailyTime,
    intervalHours: schedule.intervalHours,
  };
}

function scheduleModeLabel(schedule: ImprintSchedule, p: EchoCopy) {
  if (schedule.mode === 'manual') return p.imprintScheduleManualLabel;
  if (schedule.mode === 'interval') return p.imprintScheduleIntervalHours(schedule.intervalHours);
  return p.imprintScheduleDailyAt(schedule.dailyTime);
}

function scheduleStatusLabel(schedule: ImprintSchedule, p: EchoCopy) {
  if (schedule.mode === 'manual') return p.imprintScheduleManualOnly;
  if (schedule.due) return p.imprintScheduleDueNow;
  const next = formatScheduleClock(schedule.nextRunAt);
  return next ? p.imprintScheduleNextRun(next) : scheduleModeLabel(schedule, p);
}

function typeMeta(type: ImprintCardType, p: EchoCopy) {
  switch (type) {
    case 'event':
      return {
        label: p.imprintCardTypeEventLabel,
        icon: <NotebookText size={13} aria-hidden />,
      };
    case 'signal':
      return {
        label: p.imprintCardTypeSignalLabel,
        icon: <Target size={13} aria-hidden />,
      };
    case 'next':
      return {
        label: p.imprintCardTypeNextLabel,
        icon: <ArrowRight size={13} aria-hidden />,
      };
  }
}

function toneForType(type: ImprintCardType) {
  switch (type) {
    case 'event':
      return {
        text: 'text-[var(--amber)]',
        border: 'border-[var(--amber)]/35',
        bg: 'bg-[var(--amber-subtle)]',
        rail: 'bg-[var(--amber)]',
      };
    case 'signal':
      return {
        text: 'text-[var(--success)]',
        border: 'border-[var(--success)]/30',
        bg: 'bg-[var(--success)]/5',
        rail: 'bg-[var(--success)]',
      };
    case 'next':
      return {
        text: 'text-foreground',
        border: 'border-border/70',
        bg: 'bg-muted/35',
        rail: 'bg-foreground/55',
      };
  }
}

export default function EchoImprintCardsReview({ p }: { p: EchoCopy }) {
  const initialCandidates = useMemo(
    () => p.imprintCardCandidates.map((candidate, index) => normalizeCandidate(candidate, index)),
    [p],
  );
  const [candidates, setCandidates] = useState<ImprintCardCandidate[]>(initialCandidates);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [draftSummaries, setDraftSummaries] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<ImprintCardType>>(() => new Set(laneOrder));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [isUpdatingSchedule, setIsUpdatingSchedule] = useState(false);
  const generationInFlightRef = useRef(false);
  const [schedule, setSchedule] = useState<ImprintSchedule>({ ...DEFAULT_IMPRINT_SCHEDULE });
  const [generation, setGeneration] = useState<ImprintGenerationState>(() => ({
    trigger: 'auto',
    updatedAt: p.imprintCardsInitialUpdatedAt,
    runCount: 0,
  }));

  useEffect(() => {
    setCandidates(initialCandidates);
  }, [initialCandidates]);

  useVisiblePolling(() => {
    void loadImprints({ runIfDue: true });
  }, IMPRINT_STATUS_REFRESH_MS);

  const visibleCandidates = useMemo(
    () => candidates.filter((card) => !deletedIds.has(card.id)),
    [candidates, deletedIds],
  );
  const filteredCandidates = useMemo(
    () => visibleCandidates.filter((card) => selectedTypes.has(card.type)),
    [selectedTypes, visibleCandidates],
  );

  const typeCounts = useMemo(
    () => Object.fromEntries(
      laneOrder.map((type) => [type, visibleCandidates.filter((card) => card.type === type).length]),
    ) as Record<ImprintCardType, number>,
    [visibleCandidates],
  );

  async function loadImprints({ runIfDue }: { runIfDue: boolean }) {
    try {
      const response = await fetch('/api/echo/imprints', { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json() as ImprintCardsApiResponse;
      applyImprintResponse(body);
      if (runIfDue && body.state?.schedule?.due) {
        await requestGeneratedImprints('auto');
      }
    } catch {
      // Keep the local fallback cards when the backend is unavailable.
    }
  }

  async function requestGeneratedImprints(trigger: ImprintGenerationTrigger) {
    if (generationInFlightRef.current) return;
    generationInFlightRef.current = true;
    setIsGenerating(true);
    try {
      const response = await fetch('/api/echo/imprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger }),
      });
      if (!response.ok) throw new Error('failed to generate imprints');
      const body = await response.json() as ImprintCardsApiResponse;
      if (!applyImprintResponse(body)) {
        setGeneration((current) => ({
          trigger,
          updatedAt: formatGenerationTime(),
          runCount: current.runCount + 1,
        }));
      }
    } catch {
      setGeneration((current) => ({
        trigger,
        updatedAt: formatGenerationTime(),
        runCount: current.runCount + 1,
      }));
    } finally {
      generationInFlightRef.current = false;
      setIsGenerating(false);
    }
  }

  function applyImprintResponse(body: ImprintCardsApiResponse): boolean {
    const remoteCards = Array.isArray(body.cards)
      ? body.cards.map(normalizeRemoteCandidate).filter((card): card is ImprintCardCandidate => Boolean(card))
      : null;
    if (remoteCards && (remoteCards.length > 0 || (body.state?.runCount ?? 0) > 0)) {
      setCandidates(remoteCards);
      setDeletedIds(new Set());
      setDraftSummaries({});
    }
    if (body.state) {
      const state = body.state;
      if (state.schedule) {
        setSchedule((current) => normalizeRemoteSchedule(state.schedule, current));
      }
      setGeneration((current) => ({
        trigger: state.lastTrigger ?? current.trigger,
        updatedAt: formatApiTime(state.lastGeneratedAt, current.updatedAt),
        runCount: typeof state.runCount === 'number' ? state.runCount : current.runCount,
      }));
    }
    return Boolean(remoteCards && (remoteCards.length > 0 || (body.state?.runCount ?? 0) > 0));
  }

  function deleteCard(cardId: string) {
    setDeletedIds((current) => {
      const next = new Set(current);
      next.add(cardId);
      return next;
    });
    setEditingId((current) => (current === cardId ? null : current));
    void deleteCardRemote(cardId);
  }

  async function deleteCardRemote(cardId: string) {
    try {
      const response = await fetch('/api/echo/imprints', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cardId }),
      });
      if (!response.ok) return;
      applyImprintResponse(await response.json() as ImprintCardsApiResponse);
    } catch {
      // Optimistic local delete remains in place.
    }
  }

  function updateDraftSummary(cardId: string, value: string) {
    setDraftSummaries((current) => ({ ...current, [cardId]: value }));
  }

  function toggleEditing(cardId: string) {
    if (editingId === cardId) {
      setEditingId(null);
      void persistCardDraft(cardId);
      return;
    }
    setEditingId(cardId);
  }

  async function persistCardDraft(cardId: string) {
    const currentSummary = draftSummaries[cardId];
    if (currentSummary === undefined) return;
    setCandidates((current) => current.map((card) => (
      card.id === cardId ? { ...card, summary: currentSummary } : card
    )));
    try {
      const response = await fetch('/api/echo/imprints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cardId, summary: currentSummary }),
      });
      if (!response.ok) return;
      applyImprintResponse(await response.json() as ImprintCardsApiResponse);
    } catch {
      // The local edit stays visible; the next successful backend sync can reconcile.
    }
  }

  function toggleTypeFilter(type: ImprintCardType) {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  const allSelected = selectedTypes.size === laneOrder.length && laneOrder.every((type) => selectedTypes.has(type));

  function toggleAllFilters() {
    setSelectedTypes(allSelected ? new Set() : new Set(laneOrder));
  }

  function updateImprints() {
    void requestGeneratedImprints('manual');
  }

  async function persistSchedule(nextSchedule: ImprintSchedule) {
    const previous = schedule;
    const patch = editableSchedule(nextSchedule);
    setSchedule(patch);
    setIsUpdatingSchedule(true);
    try {
      const response = await fetch('/api/echo/imprints', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: patch }),
      });
      if (!response.ok) {
        setSchedule(previous);
        return;
      }
      applyImprintResponse(await response.json() as ImprintCardsApiResponse);
    } catch {
      setSchedule(previous);
    } finally {
      setIsUpdatingSchedule(false);
    }
  }

  function updateScheduleMode(value: string) {
    if (!isScheduleMode(value)) return;
    void persistSchedule({ ...editableSchedule(schedule), mode: value });
  }

  function updateScheduleDailyTime(value: string) {
    if (!TIME_RE.test(value)) return;
    void persistSchedule({ ...editableSchedule(schedule), dailyTime: value });
  }

  function updateScheduleIntervalHours(value: string) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    void persistSchedule({
      ...editableSchedule(schedule),
      intervalHours: Math.max(1, Math.min(24, parsed)),
    });
  }

  const generationModeLabel = generation.trigger === 'manual'
    ? p.imprintCardsManualLabel
    : p.imprintCardsAutoLabel;
  const scheduleLabel = scheduleStatusLabel(schedule, p);

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/55 bg-card/50 shadow-sm"
      aria-label={p.imprintCardsEyebrow}
      data-testid="echo-imprint-generated-list"
      aria-busy={isGenerating}
    >
      <div className="px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-2 font-sans text-xs font-medium text-foreground">
                <MessageSquareText size={13} className="text-[var(--amber)]" aria-hidden />
                <span className="truncate">{p.imprintCardsEyebrow}</span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.68rem] leading-5 text-muted-foreground">
                <span data-testid="echo-imprint-checkpoint">{p.imprintCardsCheckpointLabel}</span>
                <span aria-hidden>·</span>
                <span>{p.imprintCardsWindow}</span>
                <span aria-hidden>·</span>
                <span data-testid="echo-imprint-generation-status">
                  {generationModeLabel} · {p.imprintCardsUpdatedAt(generation.updatedAt)}
                </span>
                <span aria-hidden>·</span>
                <span data-testid="echo-imprint-schedule-status">
                  {scheduleLabel}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 self-start md:self-auto">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'text-muted-foreground hover:text-foreground',
                  isSchedulePanelOpen && 'bg-muted text-foreground',
                )}
                title={p.imprintScheduleAction}
                aria-label={p.imprintScheduleAction}
                aria-expanded={isSchedulePanelOpen}
                data-testid="echo-imprint-schedule-button"
                onClick={() => setIsSchedulePanelOpen((open) => !open)}
              >
                <Clock3 size={13} aria-hidden />
                <span className="sr-only">{p.imprintScheduleAction}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                title={p.imprintCardsUpdateAction}
                aria-label={p.imprintCardsUpdateAction}
                data-testid="echo-imprint-update-button"
                onClick={updateImprints}
                disabled={isGenerating}
              >
                <RefreshCw size={13} className={cn(isGenerating && 'animate-spin')} aria-hidden />
                <span className="sr-only">{p.imprintCardsUpdateAction}</span>
              </Button>
            </div>
          </div>

          {isSchedulePanelOpen ? (
            <div
              className="grid gap-3 rounded-lg border border-border/45 bg-background/70 p-3 md:grid-cols-[minmax(13rem,1fr)_minmax(8rem,0.45fr)_auto]"
              data-testid="echo-imprint-schedule-panel"
            >
              <fieldset className="min-w-0 space-y-1.5" data-testid="echo-imprint-schedule-mode">
                <legend className="font-sans text-[0.7rem] font-medium text-muted-foreground">
                  {p.imprintScheduleModeLabel}
                </legend>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-border/45 bg-muted/20 p-1">
                  <ScheduleModeButton
                    mode="daily"
                    active={schedule.mode === 'daily'}
                    label={p.imprintScheduleDailyLabel}
                    disabled={isUpdatingSchedule}
                    onClick={() => updateScheduleMode('daily')}
                  />
                  <ScheduleModeButton
                    mode="interval"
                    active={schedule.mode === 'interval'}
                    label={p.imprintScheduleIntervalLabel}
                    disabled={isUpdatingSchedule}
                    onClick={() => updateScheduleMode('interval')}
                  />
                  <ScheduleModeButton
                    mode="manual"
                    active={schedule.mode === 'manual'}
                    label={p.imprintScheduleManualLabel}
                    disabled={isUpdatingSchedule}
                    onClick={() => updateScheduleMode('manual')}
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
                    onChange={(event) => updateScheduleDailyTime(event.currentTarget.value)}
                    disabled={isUpdatingSchedule}
                    data-testid="echo-imprint-schedule-time"
                  />
                </label>
              ) : null}
              {schedule.mode === 'interval' ? (
                <label className="grid min-w-[8rem] gap-1 font-sans text-[0.7rem] font-medium text-muted-foreground">
                  <span>{p.imprintScheduleEveryLabel}</span>
                  <select
                    className="h-8 rounded-md border border-border bg-background px-2 font-sans text-xs text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                    value={String(schedule.intervalHours)}
                    onChange={(event) => updateScheduleIntervalHours(event.currentTarget.value)}
                    disabled={isUpdatingSchedule}
                    data-testid="echo-imprint-schedule-interval"
                  >
                    {INTERVAL_HOUR_OPTIONS.map((hours) => (
                      <option key={hours} value={hours}>
                        {p.imprintScheduleIntervalHours(hours)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="flex min-w-0 items-end font-mono text-[0.68rem] leading-5 text-muted-foreground md:justify-end">
                <span
                  className="inline-flex h-8 min-w-0 items-center rounded-md border border-border/45 bg-muted/15 px-2"
                  data-testid="echo-imprint-schedule-save-state"
                >
                  {isUpdatingSchedule ? p.imprintScheduleUpdatingLabel : scheduleLabel}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 items-center gap-2 border-t border-border/35 pt-3">
            <ListFilter size={13} className="shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1" role="group" aria-label={p.imprintCardFilterAllLabel}>
              <AllFilterButton
                count={visibleCandidates.length}
                active={allSelected}
                p={p}
                onClick={toggleAllFilters}
              />
              {laneOrder.map((type) => (
                <TypeFilterButton
                  key={type}
                  type={type}
                  count={typeCounts[type]}
                  active={selectedTypes.has(type)}
                  p={p}
                  onClick={() => toggleTypeFilter(type)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {filteredCandidates.map((card) => (
            <ReviewCard
              key={card.id}
              card={card}
              draftSummary={draftSummaries[card.id] ?? card.summary}
              isEditing={editingId === card.id}
              p={p}
              onEdit={() => toggleEditing(card.id)}
              onUpdateSummary={(value) => updateDraftSummary(card.id, value)}
              onDelete={() => deleteCard(card.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewCard({
  card,
  draftSummary,
  isEditing,
  p,
  onEdit,
  onUpdateSummary,
  onDelete,
}: {
  card: ImprintCardCandidate;
  draftSummary: string;
  isEditing: boolean;
  p: EchoCopy;
  onEdit: () => void;
  onUpdateSummary: (value: string) => void;
  onDelete: () => void;
}) {
  const meta = typeMeta(card.type, p);
  const tone = toneForType(card.type);

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-background/70 transition-[background-color,border-color,box-shadow,opacity] duration-150',
        'border-border/55 hover:border-[var(--amber)]/30 hover:shadow-sm',
      )}
      data-testid={`echo-imprint-card-${card.type}`}
    >
      <div className={cn('absolute bottom-0 left-0 top-0 w-1 opacity-80', tone.rail)} aria-hidden />
      <div className="px-4 py-4 pl-5 md:px-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.68rem] leading-5 text-muted-foreground">
            <span className={cn('inline-flex items-center gap-1.5 font-sans font-medium', tone.text)}>
              {meta.icon}
              {meta.label}
            </span>
            <span aria-hidden>·</span>
            <span
              className="inline-flex items-center gap-1.5"
              data-testid="echo-imprint-created-at"
            >
              <Clock3 size={12} aria-hidden />
              <span>
                {p.imprintCardCreatedLabel} <time>{card.createdAt}</time>
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1 -mr-1 -mt-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              title={isEditing ? p.imprintCardDoneLabel : p.imprintCardEditLabel}
              aria-label={isEditing ? p.imprintCardDoneLabel : p.imprintCardEditLabel}
              onClick={onEdit}
            >
              {isEditing ? <Check size={13} aria-hidden /> : <Pencil size={13} aria-hidden />}
              <span className="sr-only">{isEditing ? p.imprintCardDoneLabel : p.imprintCardEditLabel}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-[var(--error)]"
              title={p.imprintCardDeleteLabel}
              aria-label={p.imprintCardDeleteLabel}
              onClick={onDelete}
            >
              <Trash2 size={13} aria-hidden />
              <span className="sr-only">{p.imprintCardDeleteLabel}</span>
            </Button>
          </div>
        </div>

        <h4 className="mt-4 max-w-3xl font-sans text-base font-semibold leading-6 text-foreground">
          {card.title}
        </h4>

        <div className="mt-3 min-w-0">
          {isEditing ? (
            <textarea
              className="min-h-28 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-sans text-sm leading-6 text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label={p.imprintCardEditAria(card.title)}
              value={draftSummary}
              onChange={(event) => onUpdateSummary(event.target.value)}
            />
          ) : (
            <p className="max-w-3xl font-sans text-sm leading-7 text-muted-foreground">{draftSummary}</p>
          )}
        </div>

        <div className="mt-4 overflow-hidden rounded-lg border border-border/45 bg-muted/15">
          <FoldedField
            icon={<MessageSquareText size={13} aria-hidden />}
            label={p.imprintCardSourceLabel}
            value={card.source}
          />
          <FoldedField
            icon={<ShieldCheck size={13} aria-hidden />}
            label={p.imprintCardWhyLabel}
            value={card.whyItMatters}
          />
          <FoldedField
            icon={<ArrowRight size={13} aria-hidden />}
            label={p.imprintCardRouteLabel}
            value={card.route}
          />
        </div>

      </div>
    </article>
  );
}

function FoldedField({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <details className="group border-t border-border/45 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 font-sans text-xs font-medium text-foreground transition hover:bg-background/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background/75 text-muted-foreground">
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/35 bg-background/45 px-3 py-3">
        <p className="break-words font-sans text-xs leading-5 text-muted-foreground">{value}</p>
      </div>
    </details>
  );
}

function ScheduleModeButton({
  mode,
  active,
  label,
  disabled,
  onClick,
}: {
  mode: ImprintScheduleMode;
  active: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'h-7 min-w-0 rounded-md px-2 font-sans text-xs font-medium transition-[background-color,color,box-shadow,opacity] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
      )}
      aria-pressed={active}
      disabled={disabled}
      data-testid={`echo-imprint-schedule-mode-${mode}`}
      onClick={onClick}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

function AllFilterButton({
  count,
  active,
  p,
  onClick,
}: {
  count: number;
  active: boolean;
  p: EchoCopy;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-sans text-xs transition-[background-color,color] duration-150',
        'hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-background/75 text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
      aria-label={`${p.imprintCardFilterAllLabel} ${count}`}
      data-testid="echo-imprint-card-lane-all"
      onClick={onClick}
    >
      <span className="font-medium">{p.imprintCardFilterAllLabel}</span>
      <span className="font-mono text-[0.68rem] text-muted-foreground">{count}</span>
    </button>
  );
}

function TypeFilterButton({
  type,
  count,
  active,
  p,
  onClick,
}: {
  type: ImprintCardType;
  count: number;
  active: boolean;
  p: EchoCopy;
  onClick: () => void;
}) {
  const meta = typeMeta(type, p);
  const tone = toneForType(type);
  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex h-6 items-center gap-1.5 rounded-md px-2 font-sans text-xs transition-[background-color,color,opacity] duration-150',
        'hover:bg-muted/25 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'text-foreground' : 'text-muted-foreground/60',
      )}
      aria-pressed={active}
      aria-label={`${meta.label} ${count}`}
      data-testid={`echo-imprint-card-lane-${type}`}
      onClick={onClick}
    >
      <span className={cn('absolute inset-x-2 bottom-0 h-px rounded-full opacity-0', active && tone.rail, active && 'opacity-75')} aria-hidden />
      <span className="font-medium">{meta.label}</span>
      <span className="font-mono text-[0.68rem] text-muted-foreground">{count}</span>
    </button>
  );
}
