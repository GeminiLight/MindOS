'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  MessageSquareText,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useVisiblePolling } from '@/lib/use-visible-polling';

type EchoCopy = Messages['echoPages'];
type ImprintGenerationTrigger = 'auto' | 'manual';
type ImprintScheduleMode = 'manual' | 'daily' | 'interval';
type ImprintView = 'digest' | 'moments';

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
  title: string;
  summary: string;
  createdAt: string;
  source: string;
  whyItMatters: string;
  route: string;
};

type RemoteImprintCard = Partial<ImprintCardCandidate> & {
  id?: string;
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

function normalizeCandidate(candidate: EchoCopy['imprintCardCandidates'][number], index: number): ImprintCardCandidate {
  return {
    id: `imprint-${index}`,
    title: candidate.title,
    summary: candidate.summary,
    createdAt: candidate.createdAt,
    source: candidate.source,
    whyItMatters: candidate.whyItMatters,
    route: candidate.route,
  };
}

function normalizeRemoteCandidate(candidate: RemoteImprintCard, index: number): ImprintCardCandidate | null {
  if (typeof candidate.title !== 'string' || typeof candidate.summary !== 'string') return null;
  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `imprint-remote-${index}`,
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

function digestBodyFor(candidates: ImprintCardCandidate[], p: EchoCopy) {
  const anchor = candidates[0]?.title;
  if (!anchor) return p.imprintDigestEmptyBody;
  return p.imprintDigestBody(anchor, Math.max(0, candidates.length - 1));
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
  const [activeViews, setActiveViews] = useState<Record<ImprintView, boolean>>({
    digest: true,
    moments: true,
  });
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

  function toggleView(view: ImprintView) {
    setActiveViews((current) => {
      if (current[view] && Object.values(current).filter(Boolean).length === 1) return current;
      return { ...current, [view]: !current[view] };
    });
  }

  const scheduleLabel = scheduleStatusLabel(schedule, p);
  const headerScheduleLabel = scheduleModeLabel(schedule, p);

  return (
    <section
      className="min-w-0"
      aria-label={p.imprintCardsEyebrow}
      data-testid="echo-imprint-generated-list"
      aria-busy={isGenerating}
    >
      <header>
        <p
          className="font-mono text-[0.68rem] leading-5 text-muted-foreground"
          data-testid="echo-imprint-generation-status"
          title={p.echoGeneratedStatusTitle(generation.updatedAt)}
        >
          {p.echoGeneratedStatusLine(p.imprintCardsCheckpointLabel, headerScheduleLabel)}
        </p>

        <div
          className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-3"
          data-testid="echo-imprint-control-row"
        >
          <div
            className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border/35 bg-muted/15 p-1"
            role="group"
            aria-label={p.imprintCardsEyebrow}
            data-testid="echo-imprint-tabs"
          >
            <ImprintViewTab
              view="digest"
              active={activeViews.digest}
              label={p.imprintDigestTitle}
              icon={<ShieldCheck size={14} aria-hidden />}
              onClick={() => toggleView('digest')}
            />
            <ImprintViewTab
              view="moments"
              active={activeViews.moments}
              label={p.imprintMomentsTitle}
              icon={<MessageSquareText size={14} aria-hidden />}
              onClick={() => toggleView('moments')}
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-border/20 bg-muted/10 p-1" data-testid="echo-imprint-actions">
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
            className="mt-3 grid gap-3 rounded-lg border border-border/45 bg-background/70 p-3 md:grid-cols-[minmax(13rem,1fr)_minmax(8rem,0.45fr)_auto]"
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

      </header>

      <div className="pt-5">
        {activeViews.digest ? (
          <ImprintDigest
            p={p}
            body={digestBodyFor(visibleCandidates, p)}
            momentCount={visibleCandidates.length}
          />
        ) : null}

        {activeViews.moments ? (
          <ImprintMoments
            candidates={visibleCandidates}
            draftSummaries={draftSummaries}
            editingId={editingId}
            p={p}
            onEdit={toggleEditing}
            onUpdateSummary={updateDraftSummary}
            onDelete={deleteCard}
          />
        ) : null}
      </div>
    </section>
  );
}

function ImprintViewTab({
  view,
  active,
  label,
  icon,
  onClick,
}: {
  view: ImprintView;
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-controls={`echo-imprint-${view}-panel`}
      data-testid={`echo-imprint-tab-${view}`}
      className={cn(
        'flex min-h-9 min-w-0 items-center gap-2 rounded-md px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className={cn('shrink-0', active ? 'text-[var(--amber)]' : 'text-muted-foreground')}>{icon}</span>
      <span className="whitespace-nowrap font-sans text-xs font-medium sm:text-sm">{label}</span>
    </button>
  );
}

function ImprintDigest({
  p,
  body,
  momentCount,
}: {
  p: EchoCopy;
  body: string;
  momentCount: number;
}) {
  return (
    <section
      className="rounded-xl border border-border/45 bg-background/55 p-5"
      id="echo-imprint-digest-panel"
      data-testid="echo-imprint-digest"
    >
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 font-sans text-sm font-medium text-foreground">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/35 text-[var(--amber)]" aria-hidden>
              <ShieldCheck size={14} strokeWidth={1.8} />
            </span>
            <h3 className="min-w-0 truncate">{p.imprintDigestTitle}</h3>
          </div>
          <p className="mt-3 max-w-3xl font-sans text-base leading-7 text-foreground">
            {body}
          </p>
        </div>
        <span className="w-fit whitespace-nowrap rounded-md border border-border/45 bg-background/65 px-2 py-1 font-mono text-[0.68rem] text-muted-foreground">
          {p.imprintMomentsCount(momentCount)}
        </span>
      </div>
    </section>
  );
}

function ImprintMoments({
  candidates,
  draftSummaries,
  editingId,
  p,
  onEdit,
  onUpdateSummary,
  onDelete,
}: {
  candidates: ImprintCardCandidate[];
  draftSummaries: Record<string, string>;
  editingId: string | null;
  p: EchoCopy;
  onEdit: (cardId: string) => void;
  onUpdateSummary: (cardId: string, value: string) => void;
  onDelete: (cardId: string) => void;
}) {
  return (
    <section
      id="echo-imprint-moments-panel"
      className="mt-3"
      data-testid="echo-imprint-moments"
    >
      <div className="space-y-3">
        {candidates.length > 0 ? candidates.map((card) => (
          <ReviewCard
            key={card.id}
            card={card}
            draftSummary={draftSummaries[card.id] ?? card.summary}
            isEditing={editingId === card.id}
            p={p}
            onEdit={() => onEdit(card.id)}
            onUpdateSummary={(value) => onUpdateSummary(card.id, value)}
            onDelete={() => onDelete(card.id)}
          />
        )) : (
          <p
            className="rounded-lg border border-border/45 bg-muted/10 px-4 py-5 font-sans text-sm leading-6 text-muted-foreground"
            data-testid="echo-imprint-moments-empty"
          >
            {p.imprintMomentsEmptyLabel}
          </p>
        )}
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
  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-background/70 transition-[background-color,border-color,box-shadow,opacity] duration-150',
        'border-border/55 hover:border-[var(--amber)]/30 hover:shadow-sm',
      )}
      data-testid="echo-imprint-card"
    >
      <div className="absolute bottom-0 left-0 top-0 w-1 bg-[var(--amber)]/70" aria-hidden />
      <div className="px-4 py-4 pl-5 md:px-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.68rem] leading-5 text-muted-foreground">
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
