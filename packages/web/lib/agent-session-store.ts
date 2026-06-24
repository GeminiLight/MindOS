'use client';

/**
 * agent-session-store — component-independent session **metadata** store
 * (wiki/specs/spec-chat-session-concurrency.md, PR3 展开设计 v3).
 *
 * Owns the session list (id/title/pinned/currentFile/bindings/updatedAt) and
 * the createSession factory, shared by every ChatContent instance (home,
 * right panel, future /chat route). Messages, runs, unread marks and the
 * persistence channel stay in agent-run-store; the dependency is strictly
 * one-way (this module imports agent-run-store, never the reverse).
 *
 * The run store's metaResolver / sessionsUpdater / runtimeBindingWriter
 * injection points are wired here exactly once at module load — they used to
 * be registered per component instance ("last registration wins"), which was
 * unreliable with multiple mounted instances. wireRunStoreBridges() is
 * idempotent and re-run by resetAgentSessionStoreForTests() because the run
 * store's own test reset nulls the slots.
 */

import { useSyncExternalStore } from 'react';
import type {
  AgentIdentity,
  AgentRuntimeIdentity,
  ChatSession,
  RuntimeSessionBinding,
  SessionContextSelection,
  SessionModelSelection,
  SessionWorkDir,
} from '@/lib/types';
import {
  bindSessionAgent,
  bindSessionAgentRuntime,
  getMatchingRuntimeSessionBinding,
  isSessionInRuntimeLane,
} from '@/lib/ask-agent';
import {
  canEditSessionWorkDir as canEditSessionWorkDirValue,
  defaultSessionContextSelection,
  defaultSessionWorkDir,
  getEffectiveSessionContextSelection,
  getEffectiveSessionWorkDir,
  normalizeSessionContextSelectionForClient,
  normalizeSessionWorkDirForClient,
} from '@/lib/session-context';
import {
  normalizeSessionModelSelectionForClient,
} from '@/lib/session-model-selection';
import {
  clearUnread,
  getMessageWriteAt,
  getMessages as storeGetMessages,
  getRun,
  hasMessages as storeHasMessages,
  getActiveSession as runStoreGetActiveSession,
  registerMetaResolver,
  registerRuntimeBindingWriter,
  registerSessionsUpdater,
  removeSession as runStoreRemoveSession,
  schedulePersist,
  setActiveSession as runStoreSetActiveSession,
  setMessages as storeSetMessages,
} from '@/lib/agent-run-store';
import {
  findStudioProject,
  getStudioProjectSessionDefaults,
  readStudioProjects,
} from '@/lib/studio-projects';

export const MAX_SESSIONS = 30;

export interface SessionLaneContext {
  currentFile?: string;
  projectId?: string;
  /** undefined = no lane filter; null = mindos lane; identity = that runtime's lane. */
  runtime?: AgentRuntimeIdentity | null;
}

const EMPTY_SESSIONS: ChatSession[] = [];

let sessions: ChatSession[] = EMPTY_SESSIONS;
const sessionsListeners = new Set<() => void>();
const activeListeners = new Set<() => void>();

function emitSessions(next: ChatSession[]) {
  sessions = next;
  sessionsListeners.forEach((fn) => fn());
}

function emitActive() {
  activeListeners.forEach((fn) => fn());
}

function getProjectSessionDefaults(projectId: string | undefined, updatedAt: number): {
  workDir: SessionWorkDir;
  contextSelection: SessionContextSelection;
} {
  const trimmedProjectId = projectId?.trim();
  if (!trimmedProjectId) {
    return {
      workDir: defaultSessionWorkDir(updatedAt),
      contextSelection: defaultSessionContextSelection(updatedAt),
    };
  }
  const project = findStudioProject(readStudioProjects(), trimmedProjectId);
  return project
    ? getStudioProjectSessionDefaults(project, updatedAt)
    : {
      workDir: defaultSessionWorkDir(updatedAt),
      contextSelection: defaultSessionContextSelection(updatedAt),
    };
}

// ---------------------------------------------------------------------------
// Factory (moved from useAskSession's module-private createSession)

export function createSessionEntry(
  currentFile?: string,
  runtime?: AgentRuntimeIdentity | null,
  projectId?: string,
): ChatSession {
  const ts = Date.now();
  const trimmedProjectId = projectId?.trim();
  const defaults = getProjectSessionDefaults(trimmedProjectId, ts);
  const session: ChatSession = {
    id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
    source: trimmedProjectId ? 'project' : 'quick',
    projectId: trimmedProjectId || undefined,
    currentFile,
    createdAt: ts,
    updatedAt: ts,
    messages: [],
    workDir: defaults.workDir,
    contextSelection: defaults.contextSelection,
  };

  if (!runtime || runtime.kind === 'mindos') return session;
  if (runtime.kind === 'acp') return bindSessionAgent(session, { id: runtime.id, name: runtime.name });
  return bindSessionAgentRuntime(session, runtime, { updatedAt: ts });
}

// ---------------------------------------------------------------------------
// Helpers (ported verbatim from useAskSession)

function hasDurableRuntimeBinding(session: Pick<ChatSession, 'runtimeSessionBinding' | 'externalAgentBinding'>): boolean {
  return Boolean(
    session.runtimeSessionBinding?.externalSessionId?.trim()
    || session.externalAgentBinding?.externalSessionId?.trim(),
  );
}

function shouldPersistSession(session: Pick<ChatSession, 'messages' | 'runtimeSessionBinding' | 'externalAgentBinding'>): boolean {
  return session.messages.length > 0 || hasDurableRuntimeBinding(session);
}

function isSessionInProjectLane(session: Pick<ChatSession, 'projectId'>, projectId?: string): boolean {
  const expected = projectId?.trim() || undefined;
  return (session.projectId || undefined) === expected;
}

function runtimeBindingUpdatedAt(value?: number | string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** Messages live in agent-run-store; metadata entries may carry a stale snapshot. */
function withStoreMessages(session: ChatSession): ChatSession {
  return storeHasMessages(session.id)
    ? { ...session, messages: storeGetMessages(session.id) }
    : session;
}

function normalizeSessionContextMetadata(session: ChatSession): ChatSession {
  const modelSelection = normalizeSessionModelSelectionForClient(session.modelSelection);
  const normalized: ChatSession = {
    ...session,
    workDir: getEffectiveSessionWorkDir(session),
    contextSelection: getEffectiveSessionContextSelection(session),
  };
  if (modelSelection) {
    return { ...normalized, modelSelection };
  }
  const { modelSelection: _discardedModelSelection, ...withoutModelSelection } = normalized;
  return withoutModelSelection;
}

function sortAndCap(list: ChatSession[]): ChatSession[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
}

// ---------------------------------------------------------------------------
// Server I/O (ported from useAskSession's module helpers)

async function fetchSessions(): Promise<ChatSession[] | null> {
  try {
    const res = await fetch('/api/agent/sessions', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as ChatSession[];
    if (!Array.isArray(data)) return null;
    return data.slice(0, MAX_SESSIONS).map(normalizeSessionContextMetadata);
  } catch {
    return null;
  }
}

async function upsertSession(session: ChatSession): Promise<void> {
  try {
    // Strip base64 image data before persisting (images are session-only)
    const stripped: ChatSession = {
      ...session,
      messages: session.messages.map((m) => {
        if (!m.images || m.images.length === 0) return m;
        return { ...m, images: m.images.map((img) => ({ ...img, data: '' })) };
      }),
    };
    await fetch('/api/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: stripped }),
    });
  } catch {
    // ignore persistence errors
  }
}

async function removeSessionRemote(id: string): Promise<void> {
  try {
    await fetch('/api/agent/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch {
    // ignore persistence errors
  }
}

async function removeSessionsRemote(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await fetch('/api/agent/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // ignore persistence errors
  }
}

// ---------------------------------------------------------------------------
// Run-store bridges (module-wired once; no component registration anywhere)

function resolvePersistMeta(sessionId: string): ChatSession | null {
  const session = sessions.find((s) => s.id === sessionId) ?? null;
  return session ? normalizeSessionContextMetadata(session) : null;
}

/** Persistence flush feeds the payload back so ordering / message snapshot stay fresh. */
function applyPersistedSession(session: ChatSession) {
  emitSessions(sortAndCap([normalizeSessionContextMetadata(session), ...sessions.filter((s) => s.id !== session.id)]));
}

/** Component-independent binding write path for run closures (explicit session id). */
export function writeBindingForSession(
  sessionId: string,
  runtime: AgentRuntimeIdentity,
  binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
) {
  const current = sessions.find((s) => s.id === sessionId);
  if (!current) return;
  const bound = bindSessionAgentRuntime({ ...current, updatedAt: Date.now() }, runtime, binding);
  const updated = binding?.cwd?.trim()
    ? {
      ...bound,
      workDir: {
        source: 'runtime-binding' as const,
        path: binding.cwd.trim(),
        label: binding.cwd.trim().split(/[\\/]/).filter(Boolean).pop() ?? binding.cwd.trim(),
        updatedAt: binding.updatedAt ?? Date.now(),
      },
    }
    : normalizeSessionContextMetadata(bound);
  emitSessions(sortAndCap([updated, ...sessions.filter((s) => s.id !== sessionId)]));
  schedulePersist(sessionId);
}

export function wireRunStoreBridges() {
  registerMetaResolver(resolvePersistMeta);
  registerSessionsUpdater(applyPersistedSession);
  registerRuntimeBindingWriter(writeBindingForSession);
}

wireRunStoreBridges();

// ---------------------------------------------------------------------------
// Active session — variable lives in agent-run-store (endRun judges unread
// there); this setter is the single write entry and adds change notification.

export function setActiveSessionId(sessionId: string | null) {
  runStoreSetActiveSession(sessionId);
  emitActive();
}

export function getActiveSessionId(): string | null {
  return runStoreGetActiveSession();
}

// ---------------------------------------------------------------------------
// Reads

export function getSessions(): ChatSession[] {
  return sessions;
}

export function getSessionWorkDir(sessionId: string): SessionWorkDir {
  const session = sessions.find((s) => s.id === sessionId);
  return session ? getEffectiveSessionWorkDir(session) : defaultSessionWorkDir();
}

export function getSessionContextSelection(sessionId: string): SessionContextSelection {
  const session = sessions.find((s) => s.id === sessionId);
  return session ? getEffectiveSessionContextSelection(session) : defaultSessionContextSelection();
}

export function getSessionModelSelection(sessionId: string): SessionModelSelection | undefined {
  const session = sessions.find((s) => s.id === sessionId);
  return normalizeSessionModelSelectionForClient(session?.modelSelection);
}

export function getSessionSubmitContextSnapshot(sessionId: string): {
  workDir: SessionWorkDir;
  contextSelection: SessionContextSelection;
} {
  return {
    workDir: getSessionWorkDir(sessionId),
    contextSelection: getSessionContextSelection(sessionId),
  };
}

export function canEditSessionWorkDir(sessionId: string): boolean {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return true;
  return canEditSessionWorkDirValue(withStoreMessages(session), { hasLiveRun: Boolean(getRun(sessionId)) });
}

export function setSessionWorkDir(sessionId: string, workDir: unknown): boolean {
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return false;
  const current = withStoreMessages(sessions[idx]);
  if (!canEditSessionWorkDirValue(current, { hasLiveRun: Boolean(getRun(sessionId)) })) return false;
  const now = Date.now();
  const updated: ChatSession = {
    ...sessions[idx],
    workDir: normalizeSessionWorkDirForClient(workDir, now),
    updatedAt: now,
  };
  const next = [...sessions];
  next[idx] = updated;
  emitSessions(next);
  if (shouldPersistSession(withStoreMessages(updated))) schedulePersist(sessionId);
  return true;
}

export function setSessionContextSelection(sessionId: string, selection: unknown): boolean {
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return false;
  const now = Date.now();
  const updated: ChatSession = {
    ...sessions[idx],
    contextSelection: normalizeSessionContextSelectionForClient(selection, now),
    updatedAt: now,
  };
  const next = [...sessions];
  next[idx] = updated;
  emitSessions(next);
  if (shouldPersistSession(withStoreMessages(updated))) schedulePersist(sessionId);
  return true;
}

export function setSessionModelSelection(sessionId: string, selection: unknown): boolean {
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return false;
  const now = Date.now();
  const modelSelection = normalizeSessionModelSelectionForClient(selection, now);
  const updated: ChatSession = {
    ...sessions[idx],
    updatedAt: now,
    ...(modelSelection ? { modelSelection } : {}),
  };
  if (!modelSelection) {
    delete updated.modelSelection;
  }
  const next = [...sessions];
  next[idx] = updated;
  emitSessions(next);
  if (shouldPersistSession(withStoreMessages(updated))) schedulePersist(sessionId);
  return true;
}

export function patchSessionContextSelection(
  sessionId: string,
  patch: Partial<Pick<SessionContextSelection, 'spaces' | 'assistants'>>,
): boolean {
  const current = getSessionContextSelection(sessionId);
  return setSessionContextSelection(sessionId, {
    ...current,
    ...patch,
    version: 1,
  });
}

/**
 * Record which file the active conversation is anchored to. Replaces the old
 * metaResolver currentFile overlay: written straight into metadata, but never
 * bumps updatedAt / reorders / schedules persistence — like the overlay, it
 * only becomes durable with the next persisted change.
 */
export function noteCurrentFile(sessionId: string, currentFile: string | undefined) {
  if (currentFile === undefined) return;
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0 || sessions[idx].currentFile === currentFile) return;
  const next = [...sessions];
  next[idx] = { ...next[idx], currentFile };
  emitSessions(next);
}

// ---------------------------------------------------------------------------
// initSessions — fetch + merge is single-flight (concurrent instance inits
// share one server round-trip); the selection phase runs per caller with its
// own currentFile / runtime lane, last caller wins (same "whoever is visible
// decides" semantics as the per-instance era).

let pendingFetchMerge: Promise<ChatSession[]> | null = null;
/** True once at least one server fetch+merge completed this page lifetime —
 * consumers like the workspace-tab reconcile must not treat the pre-fetch
 * empty list as "the server has no sessions". */
let sessionsLoaded = false;

async function fetchAndMergeSessions(): Promise<ChatSession[]> {
  const fetched = await fetchSessions();
  // Transient failure (network down, 5xx, bad payload): keep the local list
  // untouched and stay "not loaded" — an empty failure result must never be
  // merged as truth, or the tab-strip reconcile would close every chat tab.
  if (fetched === null) return sessions;
  const all = sortAndCap(fetched);

  // Prune abandoned empty sessions from older versions, but keep metadata-only
  // sessions that intentionally bind MindOS to a native runtime session.
  const emptyIds = all
    .filter((s) => s.messages.length === 0 && !hasDurableRuntimeBinding(s) && !getRun(s.id))
    .map((s) => s.id);
  const sorted = emptyIds.length > 0 ? all.filter((s) => !emptyIds.includes(s.id)) : all;
  if (emptyIds.length > 0) void removeSessionsRemote(emptyIds);

  // Idempotent backfill: the run store is the in-memory source of truth, the
  // server snapshot must never clobber newer local state.
  for (const s of sorted) {
    if (getRun(s.id)) continue; // running: in-memory messages are always newer
    if (storeHasMessages(s.id) && getMessageWriteAt(s.id) >= s.updatedAt) continue; // local copy newer
    storeSetMessages(s.id, s.messages, { skipPersist: true });
  }

  // Keep local sessions the server doesn't know yet: ones with live runs, and
  // the active session itself (brand-new sessions are only persisted after
  // their first flush — a concurrent refresh from another consumer, e.g. the
  // titlebar tab strip, must not wipe a chat the user just created).
  const activeId = getActiveSessionId();
  const localOnly = sessions.filter((p) => (
    !sorted.some((s) => s.id === p.id)
    && (getRun(p.id) || p.id === activeId || storeHasMessages(p.id) || hasDurableRuntimeBinding(p))
  ));
  emitSessions([...localOnly, ...sorted].slice(0, MAX_SESSIONS));
  sessionsLoaded = true;
  return sorted;
}

/**
 * Fetch + merge without the selection phase: refreshes the shared list for
 * read-only consumers (titlebar tab strip, future inspectors) that must not
 * move the active session. Shares the single-flight slot with initSessions.
 */
export async function refreshSessions(): Promise<void> {
  if (!pendingFetchMerge) {
    pendingFetchMerge = fetchAndMergeSessions().finally(() => {
      pendingFetchMerge = null;
    });
  }
  await pendingFetchMerge;
}

export function getSessionsLoaded(): boolean {
  return sessionsLoaded;
}

/** Load sessions from the server, pick the matching one or create/reuse a fresh empty. */
export async function initSessions(ctx: SessionLaneContext = {}): Promise<void> {
  if (!pendingFetchMerge) {
    pendingFetchMerge = fetchAndMergeSessions().finally(() => {
      pendingFetchMerge = null;
    });
  }
  const sorted = await pendingFetchMerge;

  const candidates = (ctx.runtime === undefined
    ? sorted
    : sorted.filter((sess) => isSessionInRuntimeLane(sess, ctx.runtime)))
    .filter((sess) => isSessionInProjectLane(sess, ctx.projectId));
  const matched = ctx.currentFile
    ? candidates.find((sess) => sess.currentFile === ctx.currentFile) ?? candidates[0]
    : candidates[0];

  if (matched) {
    setActiveSessionId(matched.id);
    return;
  }

  // Reuse an in-memory empty session in the same lane before creating another
  // one — two instances initializing back to back must not stack empties.
  const reusable = sessions.find((s) => (
    !getRun(s.id)
    && withStoreMessages(s).messages.length === 0
    && !hasDurableRuntimeBinding(s)
    && isSessionInRuntimeLane(s, ctx.runtime ?? null)
    && isSessionInProjectLane(s, ctx.projectId)
  ));
  if (reusable) {
    setActiveSessionId(reusable.id);
    return;
  }

  const fresh = createSessionEntry(ctx.currentFile, ctx.runtime, ctx.projectId);
  setActiveSessionId(fresh.id);
  // Empty session lives only in memory — never persisted until first message.
  emitSessions([fresh, ...sessions].slice(0, MAX_SESSIONS));
}

// ---------------------------------------------------------------------------
// Lifecycle operations (ported from useAskSession; refs replaced by store state)

/** Create a brand-new session (memory only). If the active one is already empty, reuse it. */
export function resetSession(ctx: SessionLaneContext = {}) {
  const active = sessions.find((s) => s.id === getActiveSessionId());
  const activeMessages = active ? withStoreMessages(active).messages : [];
  // Already on an empty session in this runtime lane — just keep it, unless it
  // is bound to an external session and New Chat should create a fresh
  // unlinked runtime session.
  if (
    active
    && activeMessages.length === 0
    && isSessionInRuntimeLane(active, ctx.runtime)
    && isSessionInProjectLane(active, ctx.projectId)
    && !hasDurableRuntimeBinding(active)
  ) return;

  const fresh = createSessionEntry(ctx.currentFile, ctx.runtime, ctx.projectId);
  setActiveSessionId(fresh.id);
  emitSessions(sortAndCap([fresh, ...sessions]));
}

/** Switch to an existing session. Auto-drops the abandoned empty session left behind. */
export function loadSession(id: string) {
  const target = sessions.find((s) => s.id === id);
  if (!target) return;

  const activeId = getActiveSessionId();
  const leaving = activeId ? sessions.find((s) => s.id === activeId) : null;
  if (
    leaving
    && leaving.id !== id
    && !getRun(leaving.id)
    && withStoreMessages(leaving).messages.length === 0
    && !hasDurableRuntimeBinding(leaving)
  ) {
    emitSessions(sessions.filter((s) => s.id !== leaving.id));
  }

  setActiveSessionId(target.id);
  clearUnread(target.id);
}

/** Delete a session. If it's the active one, create fresh (memory only). */
export function deleteSession(id: string, ctx: SessionLaneContext = {}) {
  const target = sessions.find((s) => s.id === id);
  const persisted = target ? shouldPersistSession(withStoreMessages(target)) : false;

  // Abort any live run and clear run-store entries (messages, timers, unread)
  // before touching metadata, so late chunks and zombie persists are impossible.
  runStoreRemoveSession(id);

  // Only remove the local MindOS record. This never deletes the runtime-owned
  // session referenced by runtimeSessionBinding.
  if (persisted) void removeSessionRemote(id);

  const remaining = sessions.filter((s) => s.id !== id);
  if (getActiveSessionId() === id) {
    const fresh = createSessionEntry(ctx.currentFile, ctx.runtime, ctx.projectId);
    setActiveSessionId(fresh.id);
    emitSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
  } else {
    emitSessions(remaining);
  }
}

export function renameSession(id: string, newTitle: string) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const trimmed = newTitle.trim();
  const updated = { ...sessions[idx], title: trimmed || undefined };
  const next = [...sessions];
  next[idx] = updated;
  emitSessions(next);
  void upsertSession(withStoreMessages(updated));
}

/** Toggle pin/unpin a session. Pinned sessions sort to top (in the hook's memo). */
export function togglePinSession(id: string) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const updated = { ...sessions[idx], pinned: !sessions[idx].pinned };
  const next = [...sessions];
  next[idx] = updated;
  emitSessions(next);
  const full = withStoreMessages(updated);
  if (shouldPersistSession(full)) void upsertSession(full);
}

/** Update the session-level ACP agent binding for the currently active session. */
export function setSessionDefaultAcpAgent(agent: AgentIdentity | null, currentFile?: string) {
  const sessionId = getActiveSessionId();
  if (!sessionId) return;
  const current = sessions.find((s) => s.id === sessionId);
  if (!current) return;

  const updated = normalizeSessionContextMetadata(bindSessionAgent({
    ...current,
    currentFile: current.currentFile ?? currentFile,
    updatedAt: Date.now(),
  }, agent));
  emitSessions(sortAndCap([updated, ...sessions.filter((s) => s.id !== sessionId)]));

  // Debounced via the run store's per-session channel; flush itself decides
  // whether the session is persistable (has messages or durable binding).
  schedulePersist(sessionId);
}

/** Update the session-level runtime binding for the currently active session. */
export function setSessionAgentRuntimeBinding(
  runtime: AgentRuntimeIdentity,
  binding?: { externalSessionId?: string; cwd?: string; status?: RuntimeSessionBinding['status']; updatedAt?: number },
) {
  const sessionId = getActiveSessionId();
  if (!sessionId) return;
  writeBindingForSession(sessionId, runtime, binding);
}

/**
 * Attach an external runtime session (Codex thread / Claude session).
 * Returns false when refused — e.g. the matched local session is running.
 */
export function attachRuntimeSession(
  runtime: AgentRuntimeIdentity,
  binding: {
    externalSessionId: string;
    cwd?: string;
    status?: RuntimeSessionBinding['status'];
    updatedAt?: number | string;
  },
  metadata?: { title?: string },
  currentFile?: string,
  projectId?: string,
): boolean {
  if (runtime.kind !== 'codex' && runtime.kind !== 'claude') return false;
  const externalSessionId = binding.externalSessionId.trim();
  if (!externalSessionId) return false;

  const now = Date.now();
  const bindingUpdatedAt = runtimeBindingUpdatedAt(binding.updatedAt);
  const trimmedProjectId = projectId?.trim() || undefined;

  const existing = sessions.find((item) => (
    getMatchingRuntimeSessionBinding(item, runtime)?.externalSessionId === externalSessionId
  ));
  // A running session keeps its binding — rebinding mid-run would desync
  // the UI from the run's submit-time snapshot. Browsing it is still fine.
  if (existing && getRun(existing.id)) return false;

  const base = existing ?? createSessionEntry(currentFile, runtime, trimmedProjectId);
  const bound = bindSessionAgentRuntime({
    ...base,
    source: base.projectId || trimmedProjectId ? 'project' : base.source,
    projectId: base.projectId ?? trimmedProjectId,
    currentFile: base.currentFile ?? currentFile,
    title: metadata?.title?.trim() || base.title,
    updatedAt: now,
  }, runtime, {
    externalSessionId,
    cwd: binding.cwd,
    status: binding.status ?? 'active',
    updatedAt: bindingUpdatedAt,
  });
  const updated = binding.cwd?.trim()
    ? {
      ...bound,
      workDir: {
        source: 'runtime-binding' as const,
        path: binding.cwd.trim(),
        label: binding.cwd.trim().split(/[\\/]/).filter(Boolean).pop() ?? binding.cwd.trim(),
        updatedAt: bindingUpdatedAt,
      },
      contextSelection: getEffectiveSessionContextSelection(bound),
    }
    : normalizeSessionContextMetadata(bound);

  if (!storeHasMessages(updated.id)) {
    storeSetMessages(updated.id, updated.messages, { skipPersist: true });
  }
  setActiveSessionId(updated.id);
  clearUnread(updated.id);

  emitSessions(sortAndCap([updated, ...sessions.filter((item) => item.id !== updated.id)]));
  void upsertSession(withStoreMessages(updated));
  return true;
}

export function clearSessions(ids?: string[], ctx: SessionLaneContext = {}) {
  const targetIds = ids
    ? new Set(ids)
    : new Set(sessions
      .filter((session) => (
        (ctx.projectId ? isSessionInProjectLane(session, ctx.projectId) : true)
        && (ctx.runtime === undefined ? true : isSessionInRuntimeLane(session, ctx.runtime))
      ))
      .map((s) => s.id));
  const persistedIds = sessions
    .filter((s) => targetIds.has(s.id) && shouldPersistSession(withStoreMessages(s)))
    .map((s) => s.id);
  void removeSessionsRemote(persistedIds);

  // Abort runs and clear run-store entries for everything we drop.
  targetIds.forEach((id) => runStoreRemoveSession(id));

  const remaining = sessions.filter((s) => !targetIds.has(s.id));
  const fresh = createSessionEntry(ctx.currentFile, ctx.runtime, ctx.projectId);
  setActiveSessionId(fresh.id);
  emitSessions([fresh, ...remaining].slice(0, MAX_SESSIONS));
}

// ---------------------------------------------------------------------------
// React subscriptions

export function useSessions(): ChatSession[] {
  return useSyncExternalStore(
    (fn) => {
      sessionsListeners.add(fn);
      return () => sessionsListeners.delete(fn);
    },
    () => sessions,
    () => EMPTY_SESSIONS,
  );
}

export function useActiveSessionId(): string | null {
  return useSyncExternalStore(
    (fn) => {
      activeListeners.add(fn);
      return () => activeListeners.delete(fn);
    },
    () => runStoreGetActiveSession(),
    () => null,
  );
}

// ---------------------------------------------------------------------------

export function resetAgentSessionStoreForTests() {
  sessions = EMPTY_SESSIONS;
  pendingFetchMerge = null;
  sessionsLoaded = false;
  sessionsListeners.clear();
  activeListeners.clear();
  // resetAgentRunStoreForTests() nulls the bridge slots — restore them so the
  // next test (and the app after an HMR reload) keeps slot-free persistence.
  wireRunStoreBridges();
}
