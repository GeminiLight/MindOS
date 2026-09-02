'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ECHO_CARDS_UPDATED_EVENT } from '@/lib/echo-card-events';
import type { Locale, Messages } from '@/lib/i18n';

export type EchoCopy = Messages['echoPages'];

export type PromotionTarget = 'playbook' | 'practice';
export type EchoScheduleMode = 'manual' | 'daily' | 'interval';
type EchoCardApiSegment = 'insight' | 'promotion';

export type EchoSchedule = {
  mode: EchoScheduleMode;
  dailyTime: string;
  intervalHours: number;
};

type EchoCardMessageRef = {
  messageIndex: number;
  role: string;
  quote: string;
};

type EchoCardSourceSession = {
  id: string;
  title?: string;
  runtime?: string;
  createdAt?: number;
  updatedAt?: number;
  messageRefs?: EchoCardMessageRef[];
};

export type EchoStructuredSource = {
  label: string;
  sessions: EchoCardSourceSession[];
};

export type EchoStructuredCard<TKind extends string> = {
  id: string;
  kind: TKind;
  title: string;
  content: string;
  createdAt: string;
  source: EchoStructuredSource;
  review?: {
    status: 'pending' | 'approved' | 'rejected';
    reviewedAt?: string;
    note?: string;
    assetId?: string;
    targetPath?: string;
  };
};

type RemoteEchoStructuredCard = Partial<Omit<EchoStructuredCard<string>, 'source'>> & {
  source?: unknown;
  review?: unknown;
};

type EchoCardsApiResponse = {
  state?: {
    lastGeneratedAt?: string;
    lastTrigger?: 'auto' | 'manual';
    runCount?: number;
    schedule?: Partial<EchoSchedule> & {
      due?: boolean;
      nextRunAt?: string;
    };
  };
  cards?: RemoteEchoStructuredCard[];
  skipped?: boolean;
};

const DEFAULT_ECHO_SCHEDULE: EchoSchedule = {
  mode: 'daily',
  dailyTime: '20:00',
  intervalHours: 24,
};
export const ECHO_INTERVAL_HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];
const ECHO_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function promotionTargetLabel(target: PromotionTarget, p: EchoCopy): string {
  return target === 'playbook' ? p.promotionPlaybookLabel : p.promotionPracticeLabel;
}

export function normalizePromotionTarget(target: string): PromotionTarget {
  return target === 'practice' ? 'practice' : 'playbook';
}

function isEchoScheduleMode(value: string): value is EchoScheduleMode {
  return value === 'manual' || value === 'daily' || value === 'interval';
}

export function echoScheduleStatusLabel(schedule: EchoSchedule, p: EchoCopy) {
  if (schedule.mode === 'manual') return p.imprintScheduleManualOnly;
  if (schedule.mode === 'interval') return p.imprintScheduleIntervalHours(schedule.intervalHours);
  return p.imprintScheduleDailyAt(schedule.dailyTime);
}

export function updateEchoScheduleMode(
  setSchedule: Dispatch<SetStateAction<EchoSchedule>>,
  value: string,
) {
  if (!isEchoScheduleMode(value)) return;
  setSchedule((current) => ({ ...current, mode: value }));
}

export function updateEchoScheduleDailyTime(
  setSchedule: Dispatch<SetStateAction<EchoSchedule>>,
  value: string,
) {
  if (!ECHO_TIME_RE.test(value)) return;
  setSchedule((current) => ({ ...current, dailyTime: value }));
}

export function updateEchoScheduleIntervalHours(
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

function normalizeRemoteEchoSchedule(value: Partial<EchoSchedule> | undefined, fallback: EchoSchedule): EchoSchedule {
  const mode = value?.mode === 'manual' || value?.mode === 'daily' || value?.mode === 'interval'
    ? value.mode
    : fallback.mode;
  const dailyTime = typeof value?.dailyTime === 'string' && ECHO_TIME_RE.test(value.dailyTime)
    ? value.dailyTime
    : fallback.dailyTime;
  const intervalHours = typeof value?.intervalHours === 'number' && Number.isFinite(value.intervalHours)
    ? Math.max(1, Math.min(24, Math.round(value.intervalHours)))
    : fallback.intervalHours;
  return { mode, dailyTime, intervalHours };
}

function normalizeRemoteStructuredCard<TKind extends string>(
  candidate: RemoteEchoStructuredCard,
  index: number,
  normalizeKind: (kind: string) => TKind,
): EchoStructuredCard<TKind> | null {
  if (typeof candidate.title !== 'string' || typeof candidate.content !== 'string') return null;
  const sourceRecord = candidate.source && typeof candidate.source === 'object' && !Array.isArray(candidate.source)
    ? candidate.source as { label?: unknown; sessions?: unknown }
    : {};
  const review = normalizeRemoteEchoReview(candidate.review);
  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `echo-card-${index}`,
    kind: normalizeKind(typeof candidate.kind === 'string' ? candidate.kind : ''),
    title: candidate.title,
    content: candidate.content,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    source: {
      label: typeof sourceRecord.label === 'string' ? sourceRecord.label : '',
      sessions: normalizeRemoteEchoSourceSessions(sourceRecord.sessions),
    },
    ...(review ? { review } : {}),
  };
}

function normalizeRemoteEchoReview(value: unknown): EchoStructuredCard<string>['review'] | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (record.status !== 'pending' && record.status !== 'approved' && record.status !== 'rejected') return null;
  return {
    status: record.status,
    ...(typeof record.reviewedAt === 'string' ? { reviewedAt: record.reviewedAt } : {}),
    ...(typeof record.note === 'string' ? { note: record.note } : {}),
    ...(typeof record.assetId === 'string' ? { assetId: record.assetId } : {}),
    ...(typeof record.targetPath === 'string' ? { targetPath: record.targetPath } : {}),
  };
}

function normalizeRemoteEchoSourceSessions(value: unknown): EchoCardSourceSession[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id) return null;
      const messageRefs = normalizeRemoteEchoMessageRefs(record.messageRefs);
      return {
        id,
        ...(typeof record.title === 'string' && record.title.trim() ? { title: record.title.trim() } : {}),
        ...(typeof record.runtime === 'string' && record.runtime.trim() ? { runtime: record.runtime.trim() } : {}),
        ...(typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? { createdAt: record.createdAt } : {}),
        ...(typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? { updatedAt: record.updatedAt } : {}),
        ...(messageRefs.length > 0 ? { messageRefs } : {}),
      };
    })
    .filter((session): session is EchoCardSourceSession => session !== null);
}

function normalizeRemoteEchoMessageRefs(value: unknown): EchoCardMessageRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const messageIndex = typeof record.messageIndex === 'number' && Number.isFinite(record.messageIndex)
        ? Math.max(0, Math.floor(record.messageIndex))
        : -1;
      const role = typeof record.role === 'string' ? record.role.trim() : '';
      const quote = typeof record.quote === 'string' ? record.quote.trim() : '';
      if (messageIndex < 0 || !role || !quote) return null;
      return { messageIndex, role, quote };
    })
    .filter((ref): ref is EchoCardMessageRef => ref !== null);
}

export function formatStructuredSourceForPrompt(source: EchoStructuredSource): string {
  const sessionLines = source.sessions.flatMap((session) => {
    const heading = [
      session.runtime,
      session.title || session.id,
    ].filter(Boolean).join(' · ');
    const refs = (session.messageRefs ?? []).map((ref) => (
      `  - #${ref.messageIndex + 1} ${ref.role}: ${ref.quote}`
    ));
    return [heading ? `- ${heading}` : `- ${session.id}`, ...refs];
  });
  return [source.label, ...sessionLines].filter(Boolean).join('\n');
}

export function useEchoStructuredCards<TKind extends string>({
  apiSegment,
  initialCards,
  normalizeKind,
  locale,
}: {
  apiSegment: EchoCardApiSegment;
  initialCards: EchoStructuredCard<TKind>[];
  normalizeKind: (kind: string) => TKind;
  locale: Locale;
}) {
  const [cards, setCards] = useState<EchoStructuredCard<TKind>[]>(initialCards);
  const [schedule, setSchedule] = useState<EchoSchedule>({ ...DEFAULT_ECHO_SCHEDULE });
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewErrorById, setReviewErrorById] = useState<Record<string, string>>({});
  const generationInFlightRef = useRef(false);

  useEffect(() => {
    setCards(initialCards);
  }, [initialCards]);

  useEffect(() => {
    void loadCards({ runIfDue: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiSegment]);

  useEffect(() => {
    const onEchoCardsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ segment?: string }>).detail;
      if (detail?.segment && detail.segment !== apiSegment) return;
      void loadCards({ runIfDue: false });
    };
    window.addEventListener(ECHO_CARDS_UPDATED_EVENT, onEchoCardsUpdated);
    return () => window.removeEventListener(ECHO_CARDS_UPDATED_EVENT, onEchoCardsUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiSegment]);

  async function loadCards({ runIfDue }: { runIfDue: boolean }) {
    try {
      const response = await fetch(`/api/echo/cards?segment=${apiSegment}`, { cache: 'no-store' });
      if (!response.ok) return;
      const body = await response.json() as EchoCardsApiResponse;
      applyCardsResponse(body);
      if (runIfDue && body.state?.schedule?.due) {
        await requestGeneratedCards('auto');
      }
    } catch {
      // Keep bundled fallback cards when the backend is unavailable.
    }
  }

  async function requestGeneratedCards(trigger: 'auto' | 'manual') {
    if (generationInFlightRef.current) return;
    generationInFlightRef.current = true;
    setIsGenerating(true);
    try {
      const response = await fetch('/api/echo/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: apiSegment, trigger, locale }),
      });
      if (!response.ok) throw new Error('failed to generate Echo cards');
      applyCardsResponse(await response.json() as EchoCardsApiResponse);
    } catch {
      // The fallback candidates remain visible if generation fails.
    } finally {
      generationInFlightRef.current = false;
      setIsGenerating(false);
    }
  }

  function applyCardsResponse(body: EchoCardsApiResponse): boolean {
    const remoteCards = Array.isArray(body.cards)
      ? body.cards.map((card, index) => normalizeRemoteStructuredCard(card, index, normalizeKind)).filter((card): card is EchoStructuredCard<TKind> => Boolean(card))
      : null;
    if (remoteCards && (remoteCards.length > 0 || (body.state?.runCount ?? 0) > 0)) {
      setCards(remoteCards);
      setDraftContent({});
      setEditingId(null);
    }
    if (body.state?.schedule) {
      setSchedule((current) => normalizeRemoteEchoSchedule(body.state?.schedule, current));
    }
    return Boolean(remoteCards && (remoteCards.length > 0 || (body.state?.runCount ?? 0) > 0));
  }

  const setScheduleAndPersist = useCallback<Dispatch<SetStateAction<EchoSchedule>>>((action) => {
    setSchedule((current) => {
      const next = typeof action === 'function'
        ? (action as (value: EchoSchedule) => EchoSchedule)(current)
        : action;
      void persistSchedule(next, current);
      return next;
    });
  }, [apiSegment]);

  async function persistSchedule(nextSchedule: EchoSchedule, previousSchedule: EchoSchedule) {
    try {
      const response = await fetch('/api/echo/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: apiSegment, schedule: nextSchedule }),
      });
      if (!response.ok) {
        setSchedule(previousSchedule);
        return;
      }
      applyCardsResponse(await response.json() as EchoCardsApiResponse);
    } catch {
      setSchedule(previousSchedule);
    }
  }

  function updateDraftContent(cardId: string, value: string) {
    setDraftContent((current) => ({ ...current, [cardId]: value }));
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
    const currentContent = draftContent[cardId];
    if (currentContent === undefined) return;
    setCards((current) => current.map((card) => (
      card.id === cardId ? { ...card, content: currentContent } : card
    )));
    try {
      const response = await fetch('/api/echo/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: apiSegment, id: cardId, content: currentContent }),
      });
      if (!response.ok) return;
      applyCardsResponse(await response.json() as EchoCardsApiResponse);
    } catch {
      // Local edit stays visible until the next successful sync.
    }
  }

  async function deleteCard(cardId: string) {
    setCards((current) => current.filter((card) => card.id !== cardId));
    if (editingId === cardId) setEditingId(null);
    try {
      const response = await fetch('/api/echo/cards', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: apiSegment, id: cardId }),
      });
      if (!response.ok) return;
      applyCardsResponse(await response.json() as EchoCardsApiResponse);
    } catch {
      // Optimistic local delete remains in place.
    }
  }

  async function reviewCard(cardId: string, action: 'approve' | 'reject') {
    if (reviewingId) return;
    setReviewingId(cardId);
    setReviewErrorById((current) => ({ ...current, [cardId]: '' }));
    try {
      const response = await fetch('/api/echo/cards', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segment: apiSegment, id: cardId, action }),
      });
      if (!response.ok) throw new Error('review failed');
      applyCardsResponse(await response.json() as EchoCardsApiResponse);
    } catch {
      setReviewErrorById((current) => ({ ...current, [cardId]: 'review failed' }));
    } finally {
      setReviewingId(null);
    }
  }

  return {
    cards,
    schedule,
    setSchedule: setScheduleAndPersist,
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
  };
}
