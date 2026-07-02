import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveSafe } from './core/security';
import type { AiTaskRunnerLike } from './ai/ai-task-runner';
import {
  echoCardExtractionTask,
  type EchoCardExtractionCandidate,
  type EchoCardSourceSessionInput,
  type EchoCardSourceSessionRef,
} from './ai/tasks/echo-card-extract';
import {
  ECHO_CARD_SEGMENTS,
  normalizeEchoCardLocale,
  type EchoCard,
  type EchoCardKind,
  type EchoCardSegment,
  type EchoCardSource,
  type EchoCardSourceMessageRef,
  type EchoCardSourceSession,
  type EchoCardsState,
  type EchoGenerationMode,
  type EchoGenerationTrigger,
  type EchoOutputLocale,
  type EchoScheduleStatus,
  type EchoSegmentGenerationState,
} from './echo-cards';
import {
  DEFAULT_ECHO_CARD_SCHEDULE,
  defaultEchoCardWindowMinutes,
  getEchoCardScheduleStatus,
  normalizeEchoCardSchedule,
  normalizeEchoCardWindowMinutes,
} from './echo-card-schedule';

export { getEchoCardScheduleStatus } from './echo-card-schedule';

export type EchoCardGenerationResult = {
  state: EchoCardsState;
  segmentState: EchoSegmentGenerationState;
  cards: EchoCard[];
  sourceWindow: {
    since: string;
    until: string;
    sessionCount: number;
  };
  extraction: {
    mode: EchoGenerationMode;
    taskId?: string;
    promptVersion?: string;
    error?: string;
  };
  schedule: EchoScheduleStatus;
};

export type GenerateEchoCardsInput = {
  mindRoot: string;
  segment: EchoCardSegment;
  sessions: unknown[];
  trigger?: EchoGenerationTrigger;
  locale?: EchoOutputLocale;
  now?: Date;
  windowMinutes?: number;
};

export type GenerateEchoCardsWithAiInput = GenerateEchoCardsInput & {
  aiTaskRunner?: AiTaskRunnerLike;
  signal?: AbortSignal;
};

const ECHO_CARDS_STATE_PATH = '.mindos/echo/cards.json';
const MAX_ACTIVE_CARDS = 5;
const MAX_STORED_CARDS = 80;
const MAX_CONTENT_CHARS = 420;

const SEGMENT_KIND: Record<EchoCardSegment, EchoCardKind[]> = {
  imprint: ['digest', 'moment'],
  insight: ['pattern', 'judgment'],
  promotion: ['playbook', 'practice'],
};

const DEFAULT_KIND: Record<EchoCardSegment, EchoCardKind> = {
  imprint: 'moment',
  insight: 'pattern',
  promotion: 'playbook',
};

const ECHO_COPY: Record<EchoOutputLocale, {
  untitledCard: string;
  untitledSession: string;
  sessionLabel: string;
  sessionWindowLabel: (count: number) => string;
  messagesLabel: string;
}> = {
  en: {
    untitledCard: 'Untitled Echo card',
    untitledSession: 'Untitled session',
    sessionLabel: 'Session',
    sessionWindowLabel: (count) => `${count} session window`,
    messagesLabel: 'messages',
  },
  zh: {
    untitledCard: '未命名 Echo 卡片',
    untitledSession: '未命名会话',
    sessionLabel: '会话',
    sessionWindowLabel: (count) => `${count} 个会话窗口`,
    messagesLabel: '消息',
  },
};

export function readEchoCardsState(mindRoot: string): EchoCardsState {
  try {
    const abs = resolveSafe(mindRoot, ECHO_CARDS_STATE_PATH);
    if (!fs.existsSync(abs)) return emptyState();
    return normalizeState(JSON.parse(fs.readFileSync(abs, 'utf-8')));
  } catch {
    return emptyState();
  }
}

export function writeEchoCardsState(mindRoot: string, state: EchoCardsState): void {
  const abs = resolveSafe(mindRoot, ECHO_CARDS_STATE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf-8');
}

export function generateEchoCards({
  mindRoot,
  segment,
  sessions,
  trigger = 'auto',
  locale = 'en',
  now = new Date(),
  windowMinutes,
}: GenerateEchoCardsInput): EchoCardGenerationResult {
  const source = prepareGenerationSource({ mindRoot, segment, sessions, trigger, now, windowMinutes });
  const outputLocale = normalizeEchoCardLocale(locale);
  if (source.sourceSessions.length === 0) {
    return emptyGenerationResult({
      previous: source.previous,
      segment,
      now,
      sourceWindow: source.sourceWindow,
      extraction: { mode: 'deterministic' },
    });
  }
  const generatedCards = buildCardsFromSessions(source.sourceSessions, segment, trigger, now, outputLocale);
  return completeGeneration({
    mindRoot,
    previous: source.previous,
    segment,
    trigger,
    locale: outputLocale,
    now,
    windowMinutes: source.windowMinutes,
    generatedCards,
    sourceWindow: source.sourceWindow,
    extraction: { mode: 'deterministic' },
  });
}

export async function generateEchoCardsWithAi({
  mindRoot,
  segment,
  sessions,
  trigger = 'auto',
  locale = 'en',
  now = new Date(),
  windowMinutes,
  aiTaskRunner,
  signal,
}: GenerateEchoCardsWithAiInput): Promise<EchoCardGenerationResult> {
  const source = prepareGenerationSource({ mindRoot, segment, sessions, trigger, now, windowMinutes });
  const outputLocale = normalizeEchoCardLocale(locale);
  if (source.sourceSessions.length === 0) {
    return emptyGenerationResult({
      previous: source.previous,
      segment,
      now,
      sourceWindow: source.sourceWindow,
      extraction: { mode: 'deterministic' },
    });
  }
  const lmAttempt = aiTaskRunner
    ? await buildCardsWithAi({
      aiTaskRunner,
      segment,
      trigger,
      sessions: source.sourceSessions,
      locale: outputLocale,
      now,
      sourceWindow: source.sourceWindow,
      signal,
    })
    : null;
  const extraction = lmAttempt?.extraction ?? { mode: 'deterministic' as const };
  const generatedCards = lmAttempt?.cards ?? buildCardsFromSessions(source.sourceSessions, segment, trigger, now, outputLocale);

  return completeGeneration({
    mindRoot,
    previous: source.previous,
    segment,
    trigger,
    locale: outputLocale,
    now,
    windowMinutes: source.windowMinutes,
    generatedCards,
    sourceWindow: source.sourceWindow,
    extraction,
  });
}

export function updateEchoCardSchedule(
  mindRoot: string,
  segment: EchoCardSegment,
  patch: unknown,
): EchoCardsState {
  const state = readEchoCardsState(mindRoot);
  const current = state.segments[segment];
  const schedule = normalizeEchoCardSchedule(patch, current.schedule);
  const next = normalizeState({
    ...state,
    segments: {
      ...state.segments,
      [segment]: {
        ...current,
        schedule,
        windowMinutes: defaultEchoCardWindowMinutes(schedule),
      },
    },
  });
  writeEchoCardsState(mindRoot, next);
  return next;
}

export function updateEchoCard(
  mindRoot: string,
  segment: EchoCardSegment,
  cardId: string,
  patch: { title?: unknown; content?: unknown },
  now = new Date(),
): EchoCard | null {
  const state = readEchoCardsState(mindRoot);
  const index = state.cards.findIndex((card) => card.segment === segment && card.id === cardId);
  if (index < 0) return null;

  const current = state.cards[index];
  const title = typeof patch.title === 'string' ? normalizeText(patch.title, 120) : current.title;
  const content = typeof patch.content === 'string' ? normalizeText(patch.content, MAX_CONTENT_CHARS) : current.content;
  const next: EchoCard = {
    ...current,
    title: title || current.title,
    content: content || current.content,
    updatedAt: now.toISOString(),
    userEdited: true,
  };
  state.cards[index] = next;
  writeEchoCardsState(mindRoot, state);
  return next;
}

export function deleteEchoCard(
  mindRoot: string,
  segment: EchoCardSegment,
  cardId: string,
  now = new Date(),
): EchoCard | null {
  const state = readEchoCardsState(mindRoot);
  const index = state.cards.findIndex((card) => card.segment === segment && card.id === cardId);
  if (index < 0) return null;
  const next: EchoCard = {
    ...state.cards[index],
    status: 'deleted',
    updatedAt: now.toISOString(),
  };
  state.cards[index] = next;
  writeEchoCardsState(mindRoot, state);
  return next;
}

export function activeEchoCards(state: EchoCardsState, segment: EchoCardSegment): EchoCard[] {
  return state.cards
    .filter((card) => card.segment === segment && card.status === 'active')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_ACTIVE_CARDS);
}

export function getAllowedEchoCardKinds(segment: EchoCardSegment): EchoCardKind[] {
  return SEGMENT_KIND[segment];
}

function prepareGenerationSource({
  mindRoot,
  segment,
  sessions,
  trigger,
  now,
  windowMinutes,
}: Pick<GenerateEchoCardsInput, 'mindRoot' | 'segment' | 'sessions' | 'trigger' | 'now' | 'windowMinutes'> & {
  now: Date;
  trigger: EchoGenerationTrigger;
  windowMinutes?: number;
}) {
  const previous = readEchoCardsState(mindRoot);
  const segmentState = previous.segments[segment];
  const effectiveWindowMinutes = normalizeEchoCardWindowMinutes(windowMinutes, segmentState.schedule);
  const until = now.toISOString();
  const since = trigger === 'auto' && segmentState.checkpointAt && isValidDate(segmentState.checkpointAt)
    ? segmentState.checkpointAt
    : new Date(now.getTime() - effectiveWindowMinutes * 60_000).toISOString();
  const sourceSessions = selectSourceSessions(sessions, since, until);
  return {
    previous,
    sourceSessions,
    windowMinutes: effectiveWindowMinutes,
    sourceWindow: {
      since,
      until,
      sessionCount: sourceSessions.length,
    },
  };
}

function emptyGenerationResult({
  previous,
  segment,
  now,
  sourceWindow,
  extraction,
}: {
  previous: EchoCardsState;
  segment: EchoCardSegment;
  now: Date;
  sourceWindow: EchoCardGenerationResult['sourceWindow'];
  extraction: EchoCardGenerationResult['extraction'];
}): EchoCardGenerationResult {
  return {
    state: previous,
    segmentState: previous.segments[segment],
    cards: activeEchoCards(previous, segment),
    sourceWindow,
    extraction,
    schedule: getEchoCardScheduleStatus(previous.segments[segment], now),
  };
}

function completeGeneration({
  mindRoot,
  previous,
  segment,
  trigger,
  locale,
  now,
  windowMinutes,
  generatedCards,
  sourceWindow,
  extraction,
}: {
  mindRoot: string;
  previous: EchoCardsState;
  segment: EchoCardSegment;
  trigger: EchoGenerationTrigger;
  locale: EchoOutputLocale;
  now: Date;
  windowMinutes: number;
  generatedCards: EchoCard[];
  sourceWindow: EchoCardGenerationResult['sourceWindow'];
  extraction: EchoCardGenerationResult['extraction'];
}): EchoCardGenerationResult {
  const until = now.toISOString();
  const currentSegment = previous.segments[segment];
  const nextSegment: EchoSegmentGenerationState = {
    ...currentSegment,
    checkpointAt: until,
    lastGeneratedAt: until,
    lastTrigger: trigger,
    lastGenerationMode: extraction.mode,
    ...(extraction.error ? { lastGenerationError: extraction.error } : { lastGenerationError: undefined }),
    runCount: currentSegment.runCount + 1,
    windowMinutes,
  };
  const nextState = normalizeState({
    ...previous,
    segments: {
      ...previous.segments,
      [segment]: nextSegment,
    },
    cards: mergeGeneratedCards(previous.cards, segment, generatedCards, {
      trigger,
      locale,
      extraction,
    }),
  });
  writeEchoCardsState(mindRoot, nextState);

  return {
    state: nextState,
    segmentState: nextState.segments[segment],
    cards: activeEchoCards(nextState, segment),
    sourceWindow,
    extraction,
    schedule: getEchoCardScheduleStatus(nextState.segments[segment], now),
  };
}

function emptyState(): EchoCardsState {
  return {
    schemaVersion: 1,
    segments: Object.fromEntries(ECHO_CARD_SEGMENTS.map((segment) => [
      segment,
      emptySegmentState(),
    ])) as Record<EchoCardSegment, EchoSegmentGenerationState>,
    cards: [],
  };
}

function emptySegmentState(): EchoSegmentGenerationState {
  const schedule = { ...DEFAULT_ECHO_CARD_SCHEDULE };
  return {
    schedule,
    runCount: 0,
    windowMinutes: defaultEchoCardWindowMinutes(schedule),
  };
}

function normalizeState(value: unknown): EchoCardsState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const empty = emptyState();
  const rawSegments = record.segments && typeof record.segments === 'object' && !Array.isArray(record.segments)
    ? record.segments as Record<string, unknown>
    : {};
  const segments = Object.fromEntries(ECHO_CARD_SEGMENTS.map((segment) => [
    segment,
    normalizeSegmentState(rawSegments[segment], empty.segments[segment]),
  ])) as Record<EchoCardSegment, EchoSegmentGenerationState>;
  const cards = Array.isArray(record.cards)
    ? record.cards.map(normalizeCard).filter((card): card is EchoCard => Boolean(card))
    : [];
  return {
    schemaVersion: 1,
    segments,
    cards: cards
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_STORED_CARDS),
  };
}

function normalizeSegmentState(value: unknown, base: EchoSegmentGenerationState): EchoSegmentGenerationState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const schedule = normalizeEchoCardSchedule(record.schedule, base.schedule);
  return {
    ...(typeof record.checkpointAt === 'string' && isValidDate(record.checkpointAt) ? { checkpointAt: record.checkpointAt } : {}),
    ...(typeof record.lastGeneratedAt === 'string' && isValidDate(record.lastGeneratedAt) ? { lastGeneratedAt: record.lastGeneratedAt } : {}),
    ...(record.lastTrigger === 'manual' || record.lastTrigger === 'auto' ? { lastTrigger: record.lastTrigger } : {}),
    ...(record.lastGenerationMode === 'lm' || record.lastGenerationMode === 'deterministic' ? { lastGenerationMode: record.lastGenerationMode } : {}),
    ...(typeof record.lastGenerationError === 'string' && record.lastGenerationError.trim() ? { lastGenerationError: normalizeText(record.lastGenerationError, 260) } : {}),
    schedule,
    runCount: typeof record.runCount === 'number' && Number.isFinite(record.runCount) ? Math.max(0, Math.floor(record.runCount)) : 0,
    windowMinutes: typeof record.windowMinutes === 'number' && Number.isFinite(record.windowMinutes)
      ? Math.max(1, Math.floor(record.windowMinutes))
      : defaultEchoCardWindowMinutes(schedule),
  };
}

function normalizeCard(value: unknown): EchoCard | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const segment = typeof record.segment === 'string' && ECHO_CARD_SEGMENTS.includes(record.segment as EchoCardSegment)
    ? record.segment as EchoCardSegment
    : null;
  if (!id || !segment) return null;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const content = normalizeText(record.content, MAX_CONTENT_CHARS);
  if (!content) return null;
  const source = normalizeCardSource(record.source);
  if (!source) return null;
  const kind = normalizeKind(record.kind, segment);
  return {
    id,
    segment,
    kind,
    title: normalizeText(record.title, 120) || ECHO_COPY.en.untitledCard,
    content,
    createdAt: normalizeCreatedAt(record.createdAt, nowDate),
    updatedAt: typeof record.updatedAt === 'string' && isValidDate(record.updatedAt) ? record.updatedAt : now,
    source,
    confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : 0.5,
    status: record.status === 'deleted' ? 'deleted' : 'active',
    generatedAt: typeof record.generatedAt === 'string' && isValidDate(record.generatedAt) ? record.generatedAt : now,
    generation: normalizeGeneration(record.generation, segment),
    ...(record.userEdited === true ? { userEdited: true } : {}),
  };
}

function normalizeKind(value: unknown, segment: EchoCardSegment): EchoCardKind {
  return typeof value === 'string' && SEGMENT_KIND[segment].includes(value as EchoCardKind)
    ? value as EchoCardKind
    : DEFAULT_KIND[segment];
}

function normalizeGeneration(value: unknown, segment: EchoCardSegment): EchoCard['generation'] {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    method: record.method === 'lm' || record.method === 'deterministic' ? record.method : 'deterministic',
    trigger: record.trigger === 'manual' || record.trigger === 'auto' ? record.trigger : 'auto',
    locale: normalizeEchoCardLocale(record.locale),
    ...(typeof record.taskId === 'string' && record.taskId.trim() ? { taskId: normalizeText(record.taskId, 80) } : {}),
    ...(typeof record.promptVersion === 'string' && record.promptVersion.trim() ? { promptVersion: normalizeText(record.promptVersion, 80) } : {}),
  };
}

function normalizeCreatedAt(value: unknown, fallback: Date): string {
  if (typeof value !== 'string') return fallback.toISOString();
  const trimmed = normalizeText(value, 32);
  if (!trimmed) return fallback.toISOString();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return fallback.toISOString();
  return parsed.toISOString();
}

function normalizeCardSource(value: unknown): EchoCardSource | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const label = normalizeText(record.label, 220);
  const sessions = normalizeCardSourceSessions(record.sessions);
  return sessions.length > 0
    ? {
      label,
      sessions,
    }
    : null;
}

function normalizeCardSourceSessions(value: unknown): EchoCardSourceSession[] {
  if (!Array.isArray(value)) return [];
  const sessions = value
    .map((item) => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id) return null;
      const title = normalizeText(record.title, 120);
      const runtime = normalizeText(record.runtime, 80);
      const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : undefined;
      const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : undefined;
      const messageRefs = normalizeSourceMessageRefs(record.messageRefs);
      return {
        id,
        ...(title ? { title } : {}),
        ...(runtime ? { runtime } : {}),
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(messageRefs.length > 0 ? { messageRefs } : {}),
      };
    })
    .filter((item): item is EchoCardSourceSession => item !== null);

  const byId = new Map<string, EchoCardSourceSession>();
  for (const session of sessions) {
    const previous = byId.get(session.id);
    if (!previous) {
      byId.set(session.id, session);
      continue;
    }
    byId.set(session.id, {
      ...previous,
      ...session,
      messageRefs: uniqueMessageRefs([
        ...(previous.messageRefs ?? []),
        ...(session.messageRefs ?? []),
      ]),
    });
  }
  return [...byId.values()];
}

function normalizeSourceMessageRefs(value: unknown): EchoCardSourceMessageRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const role = typeof record.role === 'string' ? record.role.trim() : '';
      const quote = normalizeText(record.quote, 600);
      const messageIndex = typeof record.messageIndex === 'number' && Number.isFinite(record.messageIndex)
        ? Math.max(0, Math.floor(record.messageIndex))
        : -1;
      if (!role || !quote || messageIndex < 0) return null;
      return { messageIndex, role, quote };
    })
    .filter((item): item is EchoCardSourceMessageRef => item !== null);
}

function selectSourceSessions(sessions: unknown[], sinceIso: string, untilIso: string): EchoCardSourceSessionInput[] {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  return sessions
    .map(normalizeSession)
    .filter((session): session is EchoCardSourceSessionInput => Boolean(session))
    .filter((session) => {
      const updatedAt = session.updatedAt ?? session.createdAt ?? 0;
      return updatedAt > since && updatedAt <= until && session.messages.length > 0;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 8);
}

function normalizeSession(value: unknown): EchoCardSourceSessionInput | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (typeof record.id !== 'string' || !Array.isArray(record.messages)) return null;
  const messages = record.messages
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const item = message as Record<string, unknown>;
      if (typeof item.role !== 'string' || typeof item.content !== 'string') return null;
      const content = item.content.trim();
      if (!content) return null;
      return { role: item.role, content };
    })
    .filter((message): message is { role: string; content: string } => Boolean(message));
  return {
    id: record.id,
    ...(typeof record.title === 'string' && record.title.trim() ? { title: record.title.trim() } : {}),
    ...(typeof record.createdAt === 'number' ? { createdAt: record.createdAt } : {}),
    ...(typeof record.updatedAt === 'number' ? { updatedAt: record.updatedAt } : {}),
    messages,
    ...(sessionRuntimeLabel(record) ? { runtime: sessionRuntimeLabel(record) } : {}),
  };
}

function buildCardsFromSessions(
  sessions: EchoCardSourceSessionInput[],
  segment: EchoCardSegment,
  trigger: EchoGenerationTrigger,
  now: Date,
  locale: EchoOutputLocale,
): EchoCard[] {
  if (sessions.length === 0) return [];
  return sessions.slice(0, MAX_ACTIVE_CARDS).map((session) => buildSessionCard(session, segment, trigger, now, locale));
}

async function buildCardsWithAi({
  aiTaskRunner,
  segment,
  trigger,
  sessions,
  locale,
  now,
  sourceWindow,
  signal,
}: {
  aiTaskRunner: AiTaskRunnerLike;
  segment: EchoCardSegment;
  trigger: EchoGenerationTrigger;
  sessions: EchoCardSourceSessionInput[];
  locale: EchoOutputLocale;
  now: Date;
  sourceWindow: EchoCardGenerationResult['sourceWindow'];
  signal?: AbortSignal;
}): Promise<{
  cards: EchoCard[];
  extraction: EchoCardGenerationResult['extraction'];
} | null> {
  if (sessions.length === 0) return null;

  try {
    const result = await aiTaskRunner.run(echoCardExtractionTask, {
      segment,
      allowedKinds: SEGMENT_KIND[segment],
      window: {
        since: sourceWindow.since,
        until: sourceWindow.until,
      },
      locale,
      sessions,
      maxCards: MAX_ACTIVE_CARDS,
    }, {
      signal,
    });
    return {
      cards: cardsFromLmCandidates(result.output.cards, sessions, segment, trigger, now, locale, result.promptVersion),
      extraction: {
        mode: 'lm',
        taskId: result.taskId,
        promptVersion: result.promptVersion,
      },
    };
  } catch (error) {
    return {
      cards: buildCardsFromSessions(sessions, segment, trigger, now, locale),
      extraction: {
        mode: 'deterministic',
        taskId: echoCardExtractionTask.id,
        promptVersion: echoCardExtractionTask.promptVersion,
        error: normalizeText(error instanceof Error ? error.message : String(error), 260),
      },
    };
  }
}

function cardsFromLmCandidates(
  candidates: EchoCardExtractionCandidate[],
  sessions: EchoCardSourceSessionInput[],
  segment: EchoCardSegment,
  trigger: EchoGenerationTrigger,
  now: Date,
  locale: EchoOutputLocale,
  promptVersion: string,
): EchoCard[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  return candidates
    .map((candidate) => {
      const sourceSessions = verifiedCandidateSourceSessions(candidate.source.sessions, sessionById);
      if (sourceSessions.length === 0) return null;
      return createCard({
        idSeed: lmCandidateIdSeed(candidate),
        segment,
        kind: candidate.kind,
        title: candidate.title,
        content: candidate.content,
        createdAt: latestSourceSessionDate(sourceSessions, now).toISOString(),
        source: {
          label: sourceLabel(sourceSessions, locale),
          sessions: sourceSessions,
        },
        confidence: candidate.confidence,
        generation: {
          method: 'lm',
          trigger,
          locale,
          taskId: echoCardExtractionTask.id,
          promptVersion,
        },
        now,
      });
    })
    .filter((card): card is EchoCard => card !== null)
    .slice(0, MAX_ACTIVE_CARDS);
}

function verifiedCandidateSourceSessions(
  sources: EchoCardSourceSessionRef[],
  sessionById: Map<string, EchoCardSourceSessionInput>,
): EchoCardSourceSession[] {
  return sources
    .map((source) => {
      const session = sessionById.get(source.sessionId);
      if (!session) return null;
      const messageRefs = uniqueMessageRefs(source.messageRefs.filter((ref) => {
        const message = session.messages[ref.messageIndex];
        return Boolean(message && message.role === ref.role);
      }));
      if (messageRefs.length === 0) return null;
      return sourceSessionFromSession(session, messageRefs);
    })
    .filter((session): session is EchoCardSourceSession => session !== null);
}

function buildSessionCard(
  session: EchoCardSourceSessionInput,
  segment: EchoCardSegment,
  trigger: EchoGenerationTrigger,
  now: Date,
  locale: EchoOutputLocale,
): EchoCard {
  const firstUser = firstMessage(session, 'user')?.content;
  const lastUser = lastMessage(session, 'user')?.content;
  const lastAssistant = lastMessage(session, 'assistant')?.content;
  const sourceMessage = lastMessage(session, 'assistant') ?? lastMessage(session, 'user') ?? firstMessage(session, 'user');
  const copy = ECHO_COPY[locale];
  const title = sessionTitle(session, locale);
  const contentSeed = lastAssistant || lastUser || firstUser || title;
  return createCard({
    idSeed: `${segment}:${session.id}:echo-card`,
    segment,
    kind: DEFAULT_KIND[segment],
    title,
    content: normalizeText(contentSeed, MAX_CONTENT_CHARS),
    createdAt: new Date(session.updatedAt ?? session.createdAt ?? now.getTime()).toISOString(),
    source: {
      label: session.runtime ? `${session.runtime} ${copy.sessionLabel} · ${title}` : `${copy.sessionLabel} · ${title}`,
      sessions: [
        sourceSessionFromSession(
          session,
          sourceMessage
            ? [{
              messageIndex: sourceMessage.index,
              role: sourceMessage.message.role,
              quote: normalizeText(sourceMessage.message.content, 600),
            }]
            : [],
        ),
      ],
    },
    confidence: 0.72,
    generation: {
      method: 'deterministic',
      trigger,
      locale,
    },
    now,
  });
}

function createCard(input: {
  idSeed: string;
  segment: EchoCardSegment;
  kind: EchoCardKind;
  title: string;
  content: string;
  createdAt: string;
  source: EchoCardSource;
  confidence: number;
  generation: EchoCard['generation'];
  now: Date;
}): EchoCard {
  const timestamp = input.now.toISOString();
  const copy = ECHO_COPY[input.generation.locale];
  return {
    id: `echo-card-${stableHash(input.idSeed).slice(0, 12)}`,
    segment: input.segment,
    kind: input.kind,
    title: normalizeText(input.title, 120) || copy.untitledCard,
    content: normalizeText(input.content, MAX_CONTENT_CHARS),
    createdAt: input.createdAt,
    updatedAt: timestamp,
    source: {
      label: normalizeText(input.source.label, 220),
      sessions: input.source.sessions,
    },
    confidence: input.confidence,
    status: 'active',
    generatedAt: timestamp,
    generation: input.generation,
  };
}

function mergeGeneratedCards(
  existing: EchoCard[],
  segment: EchoCardSegment,
  generated: EchoCard[],
  generation: {
    trigger: EchoGenerationTrigger;
    locale: EchoOutputLocale;
    extraction: EchoCardGenerationResult['extraction'];
  },
): EchoCard[] {
  const byId = new Map(existing.map((card) => [card.id, card]));
  for (const card of generated) {
    const previous = byId.get(card.id);
    if (previous?.status === 'deleted') continue;
    const nextGeneration: EchoCard['generation'] = {
      ...card.generation,
      trigger: generation.trigger,
      locale: generation.locale,
      method: generation.extraction.mode,
      ...(generation.extraction.taskId ? { taskId: generation.extraction.taskId } : {}),
      ...(generation.extraction.promptVersion ? { promptVersion: generation.extraction.promptVersion } : {}),
    };
    byId.set(card.id, previous?.userEdited
      ? {
        ...card,
        title: previous.title,
        content: previous.content,
        status: previous.status,
        generatedAt: previous.generatedAt,
        updatedAt: previous.updatedAt,
        generation: nextGeneration,
        userEdited: true,
      }
      : { ...previous, ...card, status: 'active', generation: nextGeneration });
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_STORED_CARDS)
    .filter((card) => card.segment !== segment || SEGMENT_KIND[segment].includes(card.kind));
}

function sessionTitle(session: EchoCardSourceSessionInput, locale: EchoOutputLocale): string {
  if (session.title?.trim()) return normalizeText(session.title, 120);
  const firstUser = firstMessage(session, 'user')?.content;
  return normalizeText(firstUser || ECHO_COPY[locale].untitledSession, 80);
}

function latestSourceSessionDate(sessions: EchoCardSourceSession[], fallback: Date): Date {
  const latest = Math.max(
    ...sessions.map((session) => session.updatedAt ?? session.createdAt ?? 0),
    0,
  );
  return latest > 0 ? new Date(latest) : fallback;
}

function sourceLabel(sessions: EchoCardSourceSession[], locale: EchoOutputLocale): string {
  const copy = ECHO_COPY[locale];
  const titles = sessions.map((session) => session.title || session.id).slice(0, 2);
  const messageRefs = sessions
    .flatMap((session) => session.messageRefs ?? [])
    .map((ref) => `#${ref.messageIndex + 1}`)
    .slice(0, 4)
    .join(', ');
  const sessionPart = titles.length > 0 ? titles.join(' / ') : copy.sessionWindowLabel(sessions.length);
  return messageRefs ? `${sessionPart} · ${copy.messagesLabel} ${messageRefs}` : sessionPart;
}

function lmCandidateIdSeed(candidate: EchoCardExtractionCandidate): string {
  const refs = candidate.source.sessions
    .flatMap((session) => session.messageRefs.map((ref) => `${session.sessionId}:${ref.messageIndex}:${ref.role}`))
    .sort()
    .join('|');
  const sessionIds = candidate.source.sessions.map((session) => session.sessionId).sort().join('|');
  return `${refs || sessionIds}:${candidate.kind}:${candidate.title}`;
}

function uniqueMessageRefs(refs: EchoCardSourceMessageRef[]): EchoCardSourceMessageRef[] {
  const seen = new Set<string>();
  const result: EchoCardSourceMessageRef[] = [];
  for (const ref of refs) {
    const key = `${ref.messageIndex}:${ref.role}:${ref.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function sourceSessionFromSession(
  session: EchoCardSourceSessionInput,
  messageRefs: EchoCardSourceMessageRef[] = [],
): EchoCardSourceSession {
  const title = normalizeText(session.title, 120);
  const runtime = normalizeText(session.runtime, 80);
  return {
    id: session.id,
    ...(title ? { title } : {}),
    ...(runtime ? { runtime } : {}),
    ...(typeof session.createdAt === 'number' ? { createdAt: session.createdAt } : {}),
    ...(typeof session.updatedAt === 'number' ? { updatedAt: session.updatedAt } : {}),
    ...(messageRefs.length > 0 ? { messageRefs: uniqueMessageRefs(messageRefs) } : {}),
  };
}

function firstMessage(session: EchoCardSourceSessionInput, role: string): {
  index: number;
  message: { role: string; content: string };
  content: string;
} | undefined {
  const index = session.messages.findIndex((message) => message.role === role);
  if (index < 0) return undefined;
  const message = session.messages[index];
  return { index, message, content: message.content };
}

function lastMessage(session: EchoCardSourceSessionInput, role: string): {
  index: number;
  message: { role: string; content: string };
  content: string;
} | undefined {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role === role) return { index, message, content: message.content };
  }
  return undefined;
}

function sessionRuntimeLabel(record: Record<string, unknown>): string | undefined {
  const runtime = objectField(record.defaultAgentRuntime)?.name
    ?? objectField(record.runtimeSessionBinding)?.runtime
    ?? objectField(record.externalAgentBinding)?.runtime
    ?? objectField(record.defaultAcpAgent)?.name;
  return typeof runtime === 'string' && runtime.trim() ? runtime.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
