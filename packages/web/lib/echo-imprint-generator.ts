import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveSafe } from './core/security';
import type { AiTaskRunnerLike } from './ai/ai-task-runner';
import {
  echoImprintExtractionTask,
  type ImprintExtractionCardCandidate,
  type ImprintExtractionMessageRef,
} from './ai/tasks/echo-imprint-extract';

export type ImprintGenerationTrigger = 'auto' | 'manual';
export type ImprintScheduleMode = 'manual' | 'daily' | 'interval';

export type ImprintSchedule = {
  mode: ImprintScheduleMode;
  dailyTime: string;
  intervalHours: number;
};

export type ImprintScheduleStatus = ImprintSchedule & {
  due: boolean;
  nextRunAt?: string;
};

export type ImprintSourceMessage = {
  role: string;
  content: string;
};

export type ImprintSourceSession = {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  messages: ImprintSourceMessage[];
  runtime?: string;
};

export type ImprintCardKind = 'digest' | 'moment';

export type ImprintCardSource = {
  label: string;
  sessionIds: string[];
  messageRefs?: ImprintExtractionMessageRef[];
};

export type ImprintEvidence = {
  label: string;
};

export type ImprintCard = {
  id: string;
  kind: ImprintCardKind;
  title: string;
  content: string;
  createdAt: string;
  source: ImprintCardSource;
  evidence: ImprintEvidence;
  confidence: number;
  status: 'active' | 'deleted';
  generatedAt: string;
  updatedAt: string;
  generationMethod?: 'deterministic' | 'lm';
  promptVersion?: string;
  userEdited?: boolean;
};

export type ImprintGenerationState = {
  schemaVersion: 1;
  checkpointAt?: string;
  lastGeneratedAt?: string;
  lastTrigger?: ImprintGenerationTrigger;
  lastGenerationMode?: 'deterministic' | 'lm';
  lastGenerationError?: string;
  schedule: ImprintSchedule;
  runCount: number;
  windowMinutes: number;
  cards: ImprintCard[];
};

export type ImprintGenerationResult = {
  state: ImprintGenerationState;
  cards: ImprintCard[];
  sourceWindow: {
    since: string;
    until: string;
    sessionCount: number;
  };
  extraction: {
    mode: 'deterministic' | 'lm';
    taskId?: string;
    promptVersion?: string;
    error?: string;
  };
  schedule: ImprintScheduleStatus;
};

export type GenerateImprintsInput = {
  mindRoot: string;
  sessions: unknown[];
  trigger?: ImprintGenerationTrigger;
  now?: Date;
  windowMinutes?: number;
};

export type GenerateImprintsWithAiInput = GenerateImprintsInput & {
  aiTaskRunner?: AiTaskRunnerLike;
  signal?: AbortSignal;
};

const IMPRINT_STATE_PATH = '.mindos/echo/imprints/state.json';
const DEFAULT_IMPRINT_SCHEDULE: ImprintSchedule = {
  mode: 'daily',
  dailyTime: '20:00',
  intervalHours: 24,
};
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_INTERVAL_HOURS = 1;
const MAX_INTERVAL_HOURS = 24;
const MAX_ACTIVE_CARDS = 5;
const MAX_CONTENT_CHARS = 280;

export function readImprintGenerationState(mindRoot: string): ImprintGenerationState {
  try {
    const abs = resolveSafe(mindRoot, IMPRINT_STATE_PATH);
    if (!fs.existsSync(abs)) return emptyState();
    return normalizeState(JSON.parse(fs.readFileSync(abs, 'utf-8')));
  } catch {
    return emptyState();
  }
}

export function writeImprintGenerationState(mindRoot: string, state: ImprintGenerationState): void {
  const abs = resolveSafe(mindRoot, IMPRINT_STATE_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf-8');
}

export function generateImprints({
  mindRoot,
  sessions,
  trigger = 'auto',
  now = new Date(),
  windowMinutes,
}: GenerateImprintsInput): ImprintGenerationResult {
  const source = prepareGenerationSource({ mindRoot, sessions, now, windowMinutes });
  const generatedCards = buildCardsFromSessions(source.sourceSessions, now);
  return completeGeneration({
    mindRoot,
    previous: source.previous,
    trigger,
    now,
    windowMinutes: source.windowMinutes,
    generatedCards,
    sourceWindow: source.sourceWindow,
    extraction: { mode: 'deterministic' },
  });
}

export async function generateImprintsWithAi({
  mindRoot,
  sessions,
  trigger = 'auto',
  now = new Date(),
  windowMinutes,
  aiTaskRunner,
  signal,
}: GenerateImprintsWithAiInput): Promise<ImprintGenerationResult> {
  const source = prepareGenerationSource({ mindRoot, sessions, now, windowMinutes });
  const lmAttempt = aiTaskRunner
    ? await buildCardsWithAi({
      aiTaskRunner,
      sessions: source.sourceSessions,
      now,
      sourceWindow: source.sourceWindow,
      signal,
    })
    : null;
  const extraction = lmAttempt?.extraction ?? { mode: 'deterministic' as const };
  const generatedCards = lmAttempt?.cards ?? buildCardsFromSessions(source.sourceSessions, now);

  return completeGeneration({
    mindRoot,
    previous: source.previous,
    trigger,
    now,
    windowMinutes: source.windowMinutes,
    generatedCards,
    sourceWindow: source.sourceWindow,
    extraction,
  });
}

function prepareGenerationSource({
  mindRoot,
  sessions,
  now,
  windowMinutes,
}: Pick<GenerateImprintsInput, 'mindRoot' | 'sessions' | 'now' | 'windowMinutes'> & {
  now: Date;
  windowMinutes?: number;
}) {
  const previous = readImprintGenerationState(mindRoot);
  const effectiveWindowMinutes = normalizeWindowMinutes(windowMinutes, previous.schedule);
  const until = now.toISOString();
  const since = previous.checkpointAt && isValidDate(previous.checkpointAt)
    ? previous.checkpointAt
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

function completeGeneration({
  mindRoot,
  previous,
  trigger,
  now,
  windowMinutes,
  generatedCards,
  sourceWindow,
  extraction,
}: {
  mindRoot: string;
  previous: ImprintGenerationState;
  trigger: ImprintGenerationTrigger;
  now: Date;
  windowMinutes: number;
  generatedCards: ImprintCard[];
  sourceWindow: ImprintGenerationResult['sourceWindow'];
  extraction: ImprintGenerationResult['extraction'];
}): ImprintGenerationResult {
  const until = now.toISOString();
  const nextState = normalizeState({
    ...previous,
    checkpointAt: until,
    lastGeneratedAt: until,
    lastTrigger: trigger,
    lastGenerationMode: extraction.mode,
    ...(extraction.error ? { lastGenerationError: extraction.error } : { lastGenerationError: undefined }),
    runCount: previous.runCount + 1,
    windowMinutes,
    cards: mergeGeneratedCards(previous.cards, generatedCards),
  });
  writeImprintGenerationState(mindRoot, nextState);

  return {
    state: nextState,
    cards: activeCards(nextState),
    sourceWindow,
    extraction,
    schedule: getImprintScheduleStatus(nextState, now),
  };
}

export function updateImprintSchedule(
  mindRoot: string,
  patch: unknown,
): ImprintGenerationState {
  const state = readImprintGenerationState(mindRoot);
  const schedule = normalizeSchedule(patch, state.schedule);
  const next = normalizeState({
    ...state,
    schedule,
    windowMinutes: defaultWindowMinutesForSchedule(schedule),
  });
  writeImprintGenerationState(mindRoot, next);
  return next;
}

export function getImprintScheduleStatus(
  state: Pick<ImprintGenerationState, 'schedule' | 'lastGeneratedAt'>,
  now = new Date(),
): ImprintScheduleStatus {
  const schedule = normalizeSchedule(state.schedule);
  if (schedule.mode === 'manual') {
    return { ...schedule, due: false };
  }

  const lastGeneratedAt = typeof state.lastGeneratedAt === 'string' && isValidDate(state.lastGeneratedAt)
    ? Date.parse(state.lastGeneratedAt)
    : null;
  if (lastGeneratedAt === null) {
    return { ...schedule, due: true, nextRunAt: now.toISOString() };
  }

  if (schedule.mode === 'interval') {
    const nextRun = new Date(lastGeneratedAt + schedule.intervalHours * 60 * 60_000);
    const due = now.getTime() >= nextRun.getTime();
    return {
      ...schedule,
      due,
      nextRunAt: (due ? now : nextRun).toISOString(),
    };
  }

  const scheduledToday = dailyScheduleDate(now, schedule.dailyTime);
  const due = now.getTime() >= scheduledToday.getTime() && lastGeneratedAt < scheduledToday.getTime();
  const nextRunAt = due
    ? now
    : now.getTime() < scheduledToday.getTime()
      ? scheduledToday
      : addDays(scheduledToday, 1);
  return {
    ...schedule,
    due,
    nextRunAt: nextRunAt.toISOString(),
  };
}

export function updateImprintCard(
  mindRoot: string,
  cardId: string,
  patch: { title?: unknown; content?: unknown },
  now = new Date(),
): ImprintCard | null {
  const state = readImprintGenerationState(mindRoot);
  const index = state.cards.findIndex((card) => card.id === cardId);
  if (index < 0) return null;

  const current = state.cards[index];
  const title = typeof patch.title === 'string' ? normalizeText(patch.title, 120) : current.title;
  const content = typeof patch.content === 'string' ? normalizeText(patch.content, MAX_CONTENT_CHARS) : current.content;
  const next: ImprintCard = {
    ...current,
    title: title || current.title,
    content: content || current.content,
    updatedAt: now.toISOString(),
    userEdited: true,
  };
  state.cards[index] = next;
  writeImprintGenerationState(mindRoot, state);
  return next;
}

export function deleteImprintCard(mindRoot: string, cardId: string, now = new Date()): ImprintCard | null {
  const state = readImprintGenerationState(mindRoot);
  const index = state.cards.findIndex((card) => card.id === cardId);
  if (index < 0) return null;
  const next: ImprintCard = {
    ...state.cards[index],
    status: 'deleted',
    updatedAt: now.toISOString(),
  };
  state.cards[index] = next;
  writeImprintGenerationState(mindRoot, state);
  return next;
}

export function activeCards(state: ImprintGenerationState): ImprintCard[] {
  return state.cards
    .filter((card) => card.status === 'active')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_ACTIVE_CARDS);
}

function emptyState(): ImprintGenerationState {
  return {
    schemaVersion: 1,
    runCount: 0,
    schedule: { ...DEFAULT_IMPRINT_SCHEDULE },
    windowMinutes: defaultWindowMinutesForSchedule(DEFAULT_IMPRINT_SCHEDULE),
    cards: [],
  };
}

function normalizeState(value: unknown): ImprintGenerationState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const cards = Array.isArray(record.cards) ? record.cards.map(normalizeCard).filter(Boolean) as ImprintCard[] : [];
  const schedule = normalizeSchedule(record.schedule);
  return {
    schemaVersion: 1,
    ...(typeof record.checkpointAt === 'string' && isValidDate(record.checkpointAt) ? { checkpointAt: record.checkpointAt } : {}),
    ...(typeof record.lastGeneratedAt === 'string' && isValidDate(record.lastGeneratedAt) ? { lastGeneratedAt: record.lastGeneratedAt } : {}),
    ...(record.lastTrigger === 'manual' || record.lastTrigger === 'auto' ? { lastTrigger: record.lastTrigger } : {}),
    ...(record.lastGenerationMode === 'lm' || record.lastGenerationMode === 'deterministic' ? { lastGenerationMode: record.lastGenerationMode } : {}),
    ...(typeof record.lastGenerationError === 'string' && record.lastGenerationError.trim() ? { lastGenerationError: normalizeText(record.lastGenerationError, 260) } : {}),
    schedule,
    runCount: typeof record.runCount === 'number' && Number.isFinite(record.runCount) ? Math.max(0, Math.floor(record.runCount)) : 0,
    windowMinutes: typeof record.windowMinutes === 'number' && Number.isFinite(record.windowMinutes)
      ? Math.max(1, Math.floor(record.windowMinutes))
      : defaultWindowMinutesForSchedule(schedule),
    cards,
  };
}

function normalizeSchedule(value: unknown, base: ImprintSchedule = DEFAULT_IMPRINT_SCHEDULE): ImprintSchedule {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const mode = record.mode === 'manual' || record.mode === 'daily' || record.mode === 'interval'
    ? record.mode
    : base.mode;
  const dailyTime = typeof record.dailyTime === 'string' && TIME_RE.test(record.dailyTime)
    ? record.dailyTime
    : base.dailyTime;
  const intervalHours = typeof record.intervalHours === 'number' && Number.isFinite(record.intervalHours)
    ? clampIntervalHours(record.intervalHours)
    : base.intervalHours;
  return {
    mode,
    dailyTime,
    intervalHours,
  };
}

function clampIntervalHours(value: number): number {
  return Math.max(MIN_INTERVAL_HOURS, Math.min(MAX_INTERVAL_HOURS, Math.round(value)));
}

function normalizeWindowMinutes(value: unknown, schedule: ImprintSchedule): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return defaultWindowMinutesForSchedule(schedule);
}

function defaultWindowMinutesForSchedule(schedule: ImprintSchedule): number {
  if (schedule.mode === 'interval') return schedule.intervalHours * 60;
  return 24 * 60;
}

function dailyScheduleDate(now: Date, time: string): Date {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  return scheduled;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeCreatedAt(value: unknown, fallback: Date): string {
  if (typeof value !== 'string') return fallback.toISOString();
  const trimmed = normalizeText(value, 32);
  if (!trimmed) return fallback.toISOString();
  if (TIME_RE.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString();
}

function normalizeCard(value: unknown): ImprintCard | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const content = normalizeText(record.content, MAX_CONTENT_CHARS) || normalizeText(record.summary, MAX_CONTENT_CHARS);
  if (!content) return null;
  const source = normalizeCardSource(record.source, record);
  if (!source) return null;
  return {
    id,
    kind: record.kind === 'digest' ? 'digest' : 'moment',
    title: normalizeText(record.title, 120) || 'Untitled imprint',
    content,
    createdAt: normalizeCreatedAt(record.createdAt, nowDate),
    source,
    evidence: normalizeEvidence(record.evidence, record),
    confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : 0.5,
    status: record.status === 'deleted' ? 'deleted' : 'active',
    generatedAt: typeof record.generatedAt === 'string' && isValidDate(record.generatedAt) ? record.generatedAt : now,
    updatedAt: typeof record.updatedAt === 'string' && isValidDate(record.updatedAt) ? record.updatedAt : now,
    ...(record.generationMethod === 'lm' || record.generationMethod === 'deterministic' ? { generationMethod: record.generationMethod } : {}),
    ...(typeof record.promptVersion === 'string' && record.promptVersion.trim() ? { promptVersion: normalizeText(record.promptVersion, 80) } : {}),
    ...(record.userEdited === true ? { userEdited: true } : {}),
  };
}

function normalizeCardSource(value: unknown, legacyRecord: Record<string, unknown> = {}): ImprintCardSource | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const legacyEvidence = legacyRecord.evidence && typeof legacyRecord.evidence === 'object' && !Array.isArray(legacyRecord.evidence)
    ? legacyRecord.evidence as Record<string, unknown>
    : {};
  const sessionIdsInput = Array.isArray(record.sessionIds)
    ? record.sessionIds
    : Array.isArray(legacyRecord.sourceSessionIds)
      ? legacyRecord.sourceSessionIds
      : Array.isArray(legacyEvidence.sourceSessionIds)
        ? legacyEvidence.sourceSessionIds
        : [];
  const sessionIds = sessionIdsInput
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  const messageRefsInput = Array.isArray(record.messageRefs)
    ? record.messageRefs
    : Array.isArray(legacyRecord.sourceMessageRefs)
      ? legacyRecord.sourceMessageRefs
      : legacyEvidence.sourceMessageRefs;
  const messageRefs = normalizeSourceMessageRefs(messageRefsInput);
  const label = normalizeText(record.label, 220) || normalizeText(value, 220) || normalizeText(legacyRecord.source, 220);
  return sessionIds.length > 0
    ? {
      label,
      sessionIds,
      ...(messageRefs.length > 0 ? { messageRefs } : {}),
    }
    : null;
}

function normalizeEvidence(value: unknown, legacyRecord: Record<string, unknown> = {}): ImprintEvidence {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    label: normalizeText(record.label, 220)
      || normalizeText(legacyRecord.whyItMatters, 220)
      || normalizeText(legacyRecord.route, 220),
  };
}

function normalizeSourceMessageRefs(value: unknown): ImprintExtractionMessageRef[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : '';
      const role = typeof record.role === 'string' ? record.role.trim() : '';
      const quote = normalizeText(record.quote, 600);
      const messageIndex = typeof record.messageIndex === 'number' && Number.isFinite(record.messageIndex)
        ? Math.max(0, Math.floor(record.messageIndex))
        : -1;
      if (!sessionId || !role || !quote || messageIndex < 0) return null;
      return { sessionId, messageIndex, role, quote };
    })
    .filter((item): item is ImprintExtractionMessageRef => item !== null);
}

function selectSourceSessions(sessions: unknown[], sinceIso: string, untilIso: string): ImprintSourceSession[] {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  return sessions
    .map(normalizeSession)
    .filter((session): session is ImprintSourceSession => Boolean(session))
    .filter((session) => {
      const updatedAt = session.updatedAt ?? session.createdAt ?? 0;
      return updatedAt > since && updatedAt <= until && session.messages.length > 0;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 8);
}

function normalizeSession(value: unknown): ImprintSourceSession | null {
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
    .filter((message): message is ImprintSourceMessage => Boolean(message));
  return {
    id: record.id,
    ...(typeof record.title === 'string' && record.title.trim() ? { title: record.title.trim() } : {}),
    ...(typeof record.createdAt === 'number' ? { createdAt: record.createdAt } : {}),
    ...(typeof record.updatedAt === 'number' ? { updatedAt: record.updatedAt } : {}),
    messages,
    ...(sessionRuntimeLabel(record) ? { runtime: sessionRuntimeLabel(record) } : {}),
  };
}

function buildCardsFromSessions(sessions: ImprintSourceSession[], now: Date): ImprintCard[] {
  if (sessions.length === 0) return [];
  return sessions.slice(0, MAX_ACTIVE_CARDS).map((session) => buildSessionCard(session, now));
}

async function buildCardsWithAi({
  aiTaskRunner,
  sessions,
  now,
  sourceWindow,
  signal,
}: {
  aiTaskRunner: AiTaskRunnerLike;
  sessions: ImprintSourceSession[];
  now: Date;
  sourceWindow: ImprintGenerationResult['sourceWindow'];
  signal?: AbortSignal;
}): Promise<{
  cards: ImprintCard[];
  extraction: ImprintGenerationResult['extraction'];
} | null> {
  if (sessions.length === 0) {
    return null;
  }

  try {
    const result = await aiTaskRunner.run(echoImprintExtractionTask, {
      window: {
        since: sourceWindow.since,
        until: sourceWindow.until,
      },
      sessions,
      maxCards: MAX_ACTIVE_CARDS,
    }, {
      signal,
    });
    return {
      cards: cardsFromLmCandidates(result.output.cards, sessions, now, result.promptVersion),
      extraction: {
        mode: 'lm',
        taskId: result.taskId,
        promptVersion: result.promptVersion,
      },
    };
  } catch (error) {
    return {
      cards: buildCardsFromSessions(sessions, now),
      extraction: {
        mode: 'deterministic',
        taskId: echoImprintExtractionTask.id,
        promptVersion: echoImprintExtractionTask.promptVersion,
        error: normalizeText(error instanceof Error ? error.message : String(error), 260),
      },
    };
  }
}

function cardsFromLmCandidates(
  candidates: ImprintExtractionCardCandidate[],
  sessions: ImprintSourceSession[],
  now: Date,
  promptVersion: string,
): ImprintCard[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  return candidates
    .map((candidate) => {
      const requestedSessionIds = uniqueStrings([
        ...candidate.source.sessionIds,
        ...candidate.source.messageRefs.map((ref) => ref.sessionId),
      ]);
      const sourceSessions = requestedSessionIds
        .map((id) => sessionById.get(id))
        .filter((session): session is ImprintSourceSession => Boolean(session));
      if (sourceSessions.length === 0) return null;
      const messageRefs = verifiedCandidateMessageRefs(candidate.source.messageRefs, sessionById);
      const sessionIds = uniqueStrings([
        ...sourceSessions.map((session) => session.id),
        ...messageRefs.map((ref) => ref.sessionId),
      ]);
      return createCard({
        idSeed: lmCandidateIdSeed(candidate),
        kind: candidate.kind,
        title: candidate.title,
        content: candidate.content,
        createdAt: latestSessionDate(sourceSessions, now).toISOString(),
        source: {
          label: sourceLabel(sourceSessions, messageRefs),
          sessionIds,
          messageRefs,
        },
        evidence: {
          label: candidate.agencyTags.length > 0
            ? `Grounded in selected session messages · ${candidate.agencyTags.join(', ')}`
            : 'Grounded in selected session messages.',
        },
        confidence: candidate.confidence,
        generationMethod: 'lm',
        promptVersion,
        now,
      });
    })
    .filter((card): card is ImprintCard => card !== null)
    .slice(0, MAX_ACTIVE_CARDS);
}

function verifiedCandidateMessageRefs(
  refs: ImprintExtractionMessageRef[],
  sessionById: Map<string, ImprintSourceSession>,
): ImprintExtractionMessageRef[] {
  return refs.filter((ref) => {
    const session = sessionById.get(ref.sessionId);
    const message = session?.messages[ref.messageIndex];
    return Boolean(message && message.role === ref.role);
  });
}

function buildSessionCard(session: ImprintSourceSession, now: Date): ImprintCard {
  const firstUser = firstMessage(session, 'user');
  const lastUser = lastMessage(session, 'user');
  const lastAssistant = lastMessage(session, 'assistant');
  const title = sessionTitle(session);
  const contentSeed = lastAssistant || lastUser || firstUser || title;
  return createCard({
    idSeed: `${session.id}:imprint`,
    kind: 'moment',
    title,
    content: normalizeText(contentSeed, MAX_CONTENT_CHARS),
    createdAt: new Date(session.updatedAt ?? session.createdAt ?? now.getTime()).toISOString(),
    source: {
      label: session.runtime ? `${session.runtime} session · ${title}` : `Session · ${title}`,
      sessionIds: [session.id],
    },
    evidence: {
      label: 'Generated from this session window.',
    },
    confidence: 0.72,
    generationMethod: 'deterministic',
    now,
  });
}

function createCard(input: {
  idSeed: string;
  kind: ImprintCardKind;
  title: string;
  content: string;
  createdAt: string;
  source: ImprintCardSource;
  evidence: ImprintEvidence;
  confidence: number;
  generationMethod?: 'deterministic' | 'lm';
  promptVersion?: string;
  now: Date;
}): ImprintCard {
  const timestamp = input.now.toISOString();
  return {
    id: `imprint-${stableHash(input.idSeed).slice(0, 12)}`,
    kind: input.kind,
    title: normalizeText(input.title, 120) || 'Untitled imprint',
    content: normalizeText(input.content, MAX_CONTENT_CHARS),
    createdAt: input.createdAt,
    source: {
      label: normalizeText(input.source.label, 220),
      sessionIds: input.source.sessionIds,
      ...(input.source.messageRefs && input.source.messageRefs.length > 0
        ? { messageRefs: input.source.messageRefs }
        : {}),
    },
    evidence: {
      label: normalizeText(input.evidence.label, 220),
    },
    confidence: input.confidence,
    status: 'active',
    generatedAt: timestamp,
    updatedAt: timestamp,
    ...(input.generationMethod ? { generationMethod: input.generationMethod } : {}),
    ...(input.promptVersion ? { promptVersion: input.promptVersion } : {}),
  };
}

function mergeGeneratedCards(existing: ImprintCard[], generated: ImprintCard[]): ImprintCard[] {
  const byId = new Map(existing.map((card) => [card.id, card]));
  for (const card of generated) {
    const previous = byId.get(card.id);
    if (previous?.status === 'deleted') continue;
    byId.set(card.id, previous?.userEdited
      ? {
        ...card,
        title: previous.title,
        content: previous.content,
        status: previous.status,
        generatedAt: previous.generatedAt,
        updatedAt: previous.updatedAt,
        userEdited: true,
      }
      : { ...previous, ...card, status: 'active' });
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 40);
}

function sessionTitle(session: ImprintSourceSession): string {
  if (session.title?.trim()) return normalizeText(session.title, 120);
  const firstUser = firstMessage(session, 'user');
  return normalizeText(firstUser || 'Untitled session', 80);
}

function latestSessionDate(sessions: ImprintSourceSession[], fallback: Date): Date {
  const latest = Math.max(
    ...sessions.map((session) => session.updatedAt ?? session.createdAt ?? 0),
    0,
  );
  return latest > 0 ? new Date(latest) : fallback;
}

function sourceLabel(sessions: ImprintSourceSession[], refs: ImprintExtractionMessageRef[]): string {
  const titles = sessions.map(sessionTitle).slice(0, 2);
  const messageRefs = refs
    .map((ref) => `#${ref.messageIndex + 1}`)
    .slice(0, 4)
    .join(', ');
  const sessionPart = titles.length > 0 ? titles.join(' / ') : `${sessions.length} session window`;
  return messageRefs ? `${sessionPart} · messages ${messageRefs}` : sessionPart;
}

function lmCandidateIdSeed(candidate: ImprintExtractionCardCandidate): string {
  const refs = candidate.source.messageRefs
    .map((ref) => `${ref.sessionId}:${ref.messageIndex}:${ref.role}`)
    .sort()
    .join('|');
  return `${refs || candidate.source.sessionIds.sort().join('|')}:${candidate.title}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function firstMessage(session: ImprintSourceSession, role: string): string | undefined {
  return session.messages.find((message) => message.role === role)?.content;
}

function lastMessage(session: ImprintSourceSession, role: string): string | undefined {
  return [...session.messages].reverse().find((message) => message.role === role)?.content;
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
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatTime(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isValidDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
