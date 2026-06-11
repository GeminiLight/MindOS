'use client';

/**
 * ask-run-store — module-level store for concurrent chat sessions
 * (wiki/specs/spec-chat-session-concurrency.md, PR1).
 *
 * Single in-memory source of truth for per-session messages, active runs,
 * unread marks, and the persistence channel. Lives outside React so background
 * runs and debounced persistence survive component unmounts (the right Ask
 * panel closing must not kill an in-flight stream).
 *
 * Listener pattern precedent: hooks/useAskModal.ts. Subscriptions are
 * per-session so a streaming chunk only re-renders subscribers of that
 * session; the history list / future tab strip subscribe to a lightweight
 * run summary instead.
 */

import { useSyncExternalStore } from 'react';
import type { AgentRuntimeIdentity, ChatSession, Message, RuntimeSessionBinding } from '@/lib/types';
import type { AgentRunContextMetadata } from '@/lib/agent/stream-consumer';

export type AskRunPhase = 'connecting' | 'thinking' | 'streaming' | 'reconnecting';

export interface AskRun {
  sessionId: string;
  controller: AbortController;
  phase: AskRunPhase;
  reconnectAttempt: number;
  reconnectMax: number;
  agentRunContext: AgentRunContextMetadata | null;
  /** stop-retract state, per-run (replaces the old singleton refs) */
  pendingUserMessage: Message | null;
  retracted: boolean;
  /** Snapshot taken at submit time; the run closure never re-reads component refs. */
  runtimeSnapshot: AgentRuntimeIdentity | null;
  startedAt: number;
}

export interface AskRunInit {
  controller: AbortController;
  runtimeSnapshot: AgentRuntimeIdentity | null;
  reconnectMax: number;
  pendingUserMessage?: Message | null;
}

export interface RunSummary {
  /** Sessions with an in-flight run. */
  running: ReadonlySet<string>;
  /** Sessions whose run finished while they were not active. */
  unread: ReadonlySet<string>;
}

/**
 * Frontend-global concurrency cap. The backend additionally enforces
 * MAX_SESSIONS_PER_AGENT=3 / MAX_TOTAL_SESSIONS=10; those errors surface
 * through the stream as readable text and are not re-implemented here.
 */
export const MAX_CONCURRENT_RUNS = 3;

const PERSIST_DEBOUNCE_MS = 600;
const SUBMIT_COOLDOWN_MS = 300;
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_SUMMARY: RunSummary = { running: new Set(), unread: new Set() };

type MetaResolver = (sessionId: string) => ChatSession | null;
type SessionsUpdater = (session: ChatSession) => void;
type RuntimeBindingWriter = (
  sessionId: string,
  runtime: AgentRuntimeIdentity,
  binding?: {
    externalSessionId?: string;
    cwd?: string;
    status?: RuntimeSessionBinding['status'];
    updatedAt?: number;
  },
) => void;

const messagesBySession = new Map<string, Message[]>();
/** Last local write time per session — initSessions uses it for newer-wins vs server updatedAt. */
const messageWriteAt = new Map<string, number>();
const runs = new Map<string, AskRun>();
const unread = new Set<string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cooldownUntil = new Map<string, number>();
let activeSessionId: string | null = null;

const sessionListeners = new Map<string, Set<() => void>>();
const summaryListeners = new Set<() => void>();
let summarySnapshot: RunSummary = EMPTY_SUMMARY;

// Registered by useAskSession; kept across unmounts so background persistence
// still has metadata. Single slot — last registration wins (PR3 removes this).
let metaResolver: MetaResolver | null = null;
let sessionsUpdater: SessionsUpdater | null = null;
let runtimeBindingWriter: RuntimeBindingWriter | null = null;

function emitSession(sessionId: string) {
  sessionListeners.get(sessionId)?.forEach((fn) => fn());
}

function emitSummary() {
  summarySnapshot = { running: new Set(runs.keys()), unread: new Set(unread) };
  summaryListeners.forEach((fn) => fn());
}

function subscribeSession(sessionId: string, fn: () => void): () => void {
  let set = sessionListeners.get(sessionId);
  if (!set) {
    set = new Set();
    sessionListeners.set(sessionId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) sessionListeners.delete(sessionId);
  };
}

// ---------------------------------------------------------------------------
// Messages

export function getMessages(sessionId: string): Message[] {
  return messagesBySession.get(sessionId) ?? EMPTY_MESSAGES;
}

export function hasMessages(sessionId: string): boolean {
  return messagesBySession.has(sessionId);
}

export function getMessageWriteAt(sessionId: string): number {
  return messageWriteAt.get(sessionId) ?? 0;
}

interface WriteOpts {
  /** Drop the write when the session has no live run (late-chunk guard for run closures). */
  requireRun?: boolean;
  /** Skip the automatic schedulePersist (used by initSessions backfill). */
  skipPersist?: boolean;
}

function writeMessages(sessionId: string, next: Message[], opts?: WriteOpts) {
  if (opts?.requireRun && !runs.has(sessionId)) return;
  messagesBySession.set(sessionId, next);
  messageWriteAt.set(sessionId, Date.now());
  emitSession(sessionId);
  if (!opts?.skipPersist) schedulePersist(sessionId);
}

export function setMessages(
  sessionId: string,
  next: Message[] | ((prev: Message[]) => Message[]),
  opts?: WriteOpts,
) {
  if (opts?.requireRun && !runs.has(sessionId)) return;
  const resolved = typeof next === 'function' ? next(getMessages(sessionId)) : next;
  writeMessages(sessionId, resolved, opts);
}

export function appendMessages(sessionId: string, msgs: Message[], opts?: WriteOpts) {
  if (opts?.requireRun && !runs.has(sessionId)) return;
  writeMessages(sessionId, [...getMessages(sessionId), ...msgs], opts);
}

export function replaceLastMessage(sessionId: string, msg: Message, opts?: WriteOpts) {
  if (opts?.requireRun && !runs.has(sessionId)) return;
  const prev = getMessages(sessionId);
  if (prev.length === 0) {
    writeMessages(sessionId, [msg], opts);
    return;
  }
  const next = [...prev];
  next[next.length - 1] = msg;
  writeMessages(sessionId, next, opts);
}

// ---------------------------------------------------------------------------
// Runs

export function startRun(sessionId: string, init: AskRunInit): AskRun {
  const run: AskRun = {
    sessionId,
    controller: init.controller,
    phase: 'connecting',
    reconnectAttempt: 0,
    reconnectMax: init.reconnectMax,
    agentRunContext: null,
    pendingUserMessage: init.pendingUserMessage ?? null,
    retracted: false,
    runtimeSnapshot: init.runtimeSnapshot,
    startedAt: Date.now(),
  };
  runs.set(sessionId, run);
  emitSession(sessionId);
  emitSummary();
  return run;
}

export function getRun(sessionId: string | null): AskRun | null {
  if (!sessionId) return null;
  return runs.get(sessionId) ?? null;
}

export function getRunCount(): number {
  return runs.size;
}

/** Immutable update so useSyncExternalStore subscribers see a new snapshot. */
export function updateRun(sessionId: string, patch: Partial<Omit<AskRun, 'sessionId' | 'controller'>>): AskRun | null {
  const run = runs.get(sessionId);
  if (!run) return null;
  const next = { ...run, ...patch };
  runs.set(sessionId, next);
  emitSession(sessionId);
  return next;
}

export function abortRun(sessionId: string) {
  runs.get(sessionId)?.controller.abort();
}

/**
 * Remove the run, flush pending persistence, and mark unread when the session
 * finished in the background. Applies to failed runs too — the unread mark is
 * how a backgrounded error becomes visible.
 */
export function endRun(sessionId: string) {
  const existed = runs.delete(sessionId);
  if (!existed) return;
  flushPersist(sessionId);
  if (sessionId !== activeSessionId) {
    unread.add(sessionId);
  }
  emitSession(sessionId);
  emitSummary();
}

// ---------------------------------------------------------------------------
// Active session / unread

export function setActiveSession(sessionId: string | null) {
  activeSessionId = sessionId;
}

export function getActiveSession(): string | null {
  return activeSessionId;
}

export function markUnread(sessionId: string) {
  if (unread.has(sessionId)) return;
  unread.add(sessionId);
  emitSession(sessionId);
  emitSummary();
}

export function clearUnread(sessionId: string) {
  if (!unread.delete(sessionId)) return;
  emitSession(sessionId);
  emitSummary();
}

export function getUnread(): ReadonlySet<string> {
  return unread;
}

// ---------------------------------------------------------------------------
// Submit cooldown (per-session; outlives the run, so it cannot live on AskRun)

export function startSubmitCooldown(sessionId: string) {
  cooldownUntil.set(sessionId, Date.now() + SUBMIT_COOLDOWN_MS);
}

export function isInSubmitCooldown(sessionId: string): boolean {
  const until = cooldownUntil.get(sessionId);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(sessionId);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Persistence channel (component-independent; rules moved from AskContent's
// persist effect and useAskSession.persistSession/upsertSession)

export function registerMetaResolver(fn: MetaResolver) {
  metaResolver = fn;
}

/** Called with each persisted payload so useAskSession can refresh its metadata list. */
export function registerSessionsUpdater(fn: SessionsUpdater) {
  sessionsUpdater = fn;
}

/** Component-independent path for onRuntimeBinding writes from run closures. */
export function registerRuntimeBindingWriter(fn: RuntimeBindingWriter) {
  runtimeBindingWriter = fn;
}

export function writeRuntimeBinding(
  sessionId: string,
  runtime: AgentRuntimeIdentity,
  binding?: Parameters<RuntimeBindingWriter>[2],
) {
  runtimeBindingWriter?.(sessionId, runtime, binding);
}

function hasDurableRuntimeBinding(session: ChatSession): boolean {
  return Boolean(
    session.runtimeSessionBinding?.externalSessionId?.trim()
    || session.externalAgentBinding?.externalSessionId?.trim(),
  );
}

function stripImageData(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (!m.images || m.images.length === 0) return m;
    // Base64 image data is session-only; never persisted.
    return { ...m, images: m.images.map((img) => ({ ...img, data: '' })) };
  });
}

function buildPersistPayload(sessionId: string): ChatSession | null {
  const meta = metaResolver?.(sessionId) ?? null;
  const messages = messagesBySession.get(sessionId) ?? meta?.messages ?? [];
  const now = Date.now();
  const base: ChatSession = meta ?? { id: sessionId, createdAt: now, updatedAt: now, messages: [] };
  const payload: ChatSession = { ...base, updatedAt: now, messages };
  if (payload.messages.length === 0 && !hasDurableRuntimeBinding(payload)) return null;
  return { ...payload, messages: stripImageData(payload.messages) };
}

export function schedulePersist(sessionId: string) {
  const existing = persistTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    sessionId,
    setTimeout(() => {
      persistTimers.delete(sessionId);
      flushPersist(sessionId);
    }, PERSIST_DEBOUNCE_MS),
  );
}

export function cancelPersist(sessionId: string) {
  const timer = persistTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(sessionId);
  }
}

export function flushPersist(sessionId: string) {
  cancelPersist(sessionId);

  // While a run is still streaming into an empty assistant placeholder there
  // is nothing worth persisting yet (rule moved from AskContent's effect).
  const msgs = messagesBySession.get(sessionId);
  if (runs.has(sessionId) && msgs && msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    if (last.role === 'assistant' && !last.content && (!last.parts || last.parts.length === 0)) return;
  }

  const payload = buildPersistPayload(sessionId);
  if (!payload) return;

  sessionsUpdater?.(payload);
  void fetch('/api/ask-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: payload }),
  }).catch(() => {
    // ignore persistence errors (same policy as the old upsertSession)
  });
}

// ---------------------------------------------------------------------------
// Removal

/** Full cleanup for deleteSession: abort run, kill timers, drop every entry. */
export function removeSession(sessionId: string) {
  runs.get(sessionId)?.controller.abort();
  runs.delete(sessionId);
  cancelPersist(sessionId);
  messagesBySession.delete(sessionId);
  messageWriteAt.delete(sessionId);
  cooldownUntil.delete(sessionId);
  const hadUnread = unread.delete(sessionId);
  emitSession(sessionId);
  if (hadUnread || summarySnapshot.running.has(sessionId)) emitSummary();
}

// ---------------------------------------------------------------------------
// React subscriptions

export function useSessionMessages(sessionId: string | null): Message[] {
  return useSyncExternalStore(
    (fn) => (sessionId ? subscribeSession(sessionId, fn) : () => {}),
    () => (sessionId ? getMessages(sessionId) : EMPTY_MESSAGES),
    () => EMPTY_MESSAGES,
  );
}

export function useSessionRun(sessionId: string | null): AskRun | null {
  return useSyncExternalStore(
    (fn) => (sessionId ? subscribeSession(sessionId, fn) : () => {}),
    () => getRun(sessionId),
    () => null,
  );
}

/** Lightweight runs/unread summary — streaming chunks do not invalidate it. */
export function useRunSummary(): RunSummary {
  return useSyncExternalStore(
    (fn) => {
      summaryListeners.add(fn);
      return () => summaryListeners.delete(fn);
    },
    () => summarySnapshot,
    () => EMPTY_SUMMARY,
  );
}

// ---------------------------------------------------------------------------

// Refreshing or closing the page kills every in-flight run's fetch — the server
// finishes the prompt but the remaining output is lost (spec edge case 6). Warn
// while any run is live; the browser shows its own generic dialog text.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (runs.size === 0) return;
    event.preventDefault();
    // Chrome still requires returnValue to be set for the prompt to appear.
    event.returnValue = '';
  });
}

export function resetAskRunStoreForTests() {
  runs.forEach((run) => run.controller.abort());
  runs.clear();
  persistTimers.forEach((timer) => clearTimeout(timer));
  persistTimers.clear();
  messagesBySession.clear();
  messageWriteAt.clear();
  unread.clear();
  cooldownUntil.clear();
  activeSessionId = null;
  metaResolver = null;
  sessionsUpdater = null;
  runtimeBindingWriter = null;
  sessionListeners.clear();
  summaryListeners.clear();
  summarySnapshot = EMPTY_SUMMARY;
}
