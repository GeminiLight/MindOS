import { AsyncLocalStorage } from 'node:async_hooks';
import { AGENT_TURN_DEADLINE_REGISTRY_KEY, getProcessGlobal } from '../global-state.js';

/**
 * Turn-deadline suspension (spec-runtime-lane-contract item 3).
 *
 * Permission / question bridge waits are human waits: the runtime asks, the
 * turn clock keeps running, and the default bridge timeout (10 min) can fully
 * consume the default turn timeout (10 min) so the turn dies while the prompt
 * is still on screen. A `TurnDeadline` is the turn's pausable clock: while a
 * bridge request is pending for the run the deadline is paused (frozen), and
 * on resume the turn budget continues where it left off.
 *
 * The pause is bounded: `maxTotalPauseMs` caps how much wall time a single
 * turn may spend suspended, so a stuck bridge (or an endless stream of
 * prompts) cannot pin a turn forever. When the cap is reached mid-pause the
 * clock resumes by itself and further pauses are refused.
 *
 * Two lookup paths exist because producers and consumers meet in different
 * async contexts:
 * - timeout helpers (`runMindosWithTimeout`, `withNativeRuntimeTimeout`, the
 *   ACP attempt budget) find the deadline through the AsyncLocalStorage set
 *   by the lane caller around the whole turn;
 * - bridges pause/resume through the process-global runId registry, because
 *   out-of-band resolvers (the Claude MCP shim's HTTP route calling
 *   `requestRuntimePermissionForRun`) run outside the lane's ALS context.
 */

export const DEFAULT_TURN_DEADLINE_MAX_PAUSE_MS = 30 * 60 * 1000;

/**
 * Resolve the per-turn pause cap. Invalid or non-positive values fall back to
 * the default; `0` is treated as "no pausing" (the deadline never freezes).
 */
export function resolveTurnDeadlineMaxPauseMs(
  raw: string | undefined = process.env.MINDOS_AGENT_TURN_BRIDGE_PAUSE_MAX_MS,
  defaultMs = DEFAULT_TURN_DEADLINE_MAX_PAUSE_MS,
): number {
  if (raw === undefined || raw.trim() === '') return defaultMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultMs;
}

export type TurnDeadlineListener = () => void;

export interface TurnDeadline {
  /** The original (unpaused) turn budget. */
  readonly timeoutMs: number;
  /** Active-time remaining: frozen while paused, extended by pauses on resume. */
  remainingMs(): number;
  isPaused(): boolean;
  /** Depth-counted: concurrent bridge waits pause once and resume together. */
  pause(): void;
  resume(): void;
  /** Pause wall time credited to the deadline so far (capped at maxTotalPauseMs). */
  totalPausedMs(): number;
  /** totalPausedMs plus the in-progress pause, for active-clock computations. */
  pausedMsSoFar(): number;
  /** Notified on every pause/resume transition (including cap expiry). */
  subscribe(listener: TurnDeadlineListener): () => void;
}

export function createTurnDeadline(input: {
  timeoutMs: number;
  maxTotalPauseMs?: number;
}): TurnDeadline {
  const maxTotalPauseMs = input.maxTotalPauseMs ?? resolveTurnDeadlineMaxPauseMs();
  let deadlineAt = Date.now() + input.timeoutMs;
  let depth = 0;
  let pausedAt: number | undefined;
  let totalPausedMs = 0;
  let exhausted = maxTotalPauseMs <= 0;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<TurnDeadlineListener>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const beginPause = () => {
    const budget = maxTotalPauseMs - totalPausedMs;
    if (budget <= 0) {
      exhausted = true;
      return;
    }
    pausedAt = Date.now();
    // Hard guard: when the credit runs out mid-pause, the turn clock resumes
    // by itself even though the bridge request is still pending.
    capTimer = setTimeout(() => {
      capTimer = undefined;
      if (pausedAt === undefined) return;
      const pausedFor = Math.max(0, Date.now() - pausedAt);
      // The cap timer fires exactly at the remaining credit, so credit is
      // bounded by the budget even if timers coalesced.
      const credit = Math.min(pausedFor, maxTotalPauseMs - totalPausedMs);
      totalPausedMs += credit;
      deadlineAt += credit;
      pausedAt = undefined;
      exhausted = true;
      emit();
    }, budget);
    capTimer.unref?.();
    emit();
  };

  const endPause = () => {
    if (capTimer !== undefined) {
      clearTimeout(capTimer);
      capTimer = undefined;
    }
    if (pausedAt === undefined) return;
    const pausedFor = Math.max(0, Date.now() - pausedAt);
    totalPausedMs += pausedFor;
    deadlineAt += pausedFor;
    pausedAt = undefined;
    emit();
  };

  return {
    timeoutMs: input.timeoutMs,
    remainingMs() {
      const effectiveNow = pausedAt ?? Date.now();
      return Math.max(0, deadlineAt - effectiveNow);
    },
    isPaused() {
      return pausedAt !== undefined;
    },
    pause() {
      depth += 1;
      if (depth === 1 && !exhausted) beginPause();
    },
    resume() {
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) endPause();
    },
    totalPausedMs() {
      return totalPausedMs;
    },
    pausedMsSoFar() {
      return totalPausedMs + (pausedAt !== undefined ? Math.max(0, Date.now() - pausedAt) : 0);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const deadlineStorage = new AsyncLocalStorage<TurnDeadline>();

export function runWithTurnDeadline<T>(deadline: TurnDeadline, fn: () => T): T {
  return deadlineStorage.run(deadline, fn);
}

export function getCurrentTurnDeadline(): TurnDeadline | undefined {
  return deadlineStorage.getStore();
}

function deadlineRegistry(): Map<string, TurnDeadline> {
  return getProcessGlobal(AGENT_TURN_DEADLINE_REGISTRY_KEY, () => new Map<string, TurnDeadline>());
}

export function registerTurnDeadlineForRun(runId: string, deadline: TurnDeadline): () => void {
  const registry = deadlineRegistry();
  registry.set(runId, deadline);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (registry.get(runId) === deadline) registry.delete(runId);
  };
}

export function getTurnDeadlineForRun(runId: string): TurnDeadline | undefined {
  return deadlineRegistry().get(runId);
}

export function pauseTurnDeadlineForRun(runId: string): boolean {
  const deadline = deadlineRegistry().get(runId);
  if (!deadline) return false;
  deadline.pause();
  return true;
}

export function resumeTurnDeadlineForRun(runId: string): boolean {
  const deadline = deadlineRegistry().get(runId);
  if (!deadline) return false;
  deadline.resume();
  return true;
}

/** Test hook: drop every registered deadline. */
export function resetTurnDeadlineRegistryForTest(): void {
  deadlineRegistry().clear();
}

/**
 * A setTimeout that respects a TurnDeadline: while the deadline is paused the
 * timer is disarmed (remaining budget frozen) and re-armed on resume. Without
 * a deadline this is a plain setTimeout. Returns the disposer.
 */
export function armPausableTurnTimer(input: {
  timeoutMs: number;
  onTimeout: () => void;
  deadline?: TurnDeadline | null;
}): () => void {
  const deadline = input.deadline ?? null;
  let remaining = input.timeoutMs;
  let armedAt: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const clear = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (armedAt !== undefined) {
      remaining = Math.max(1, remaining - (Date.now() - armedAt));
      armedAt = undefined;
    }
  };
  const arm = () => {
    if (disposed || timer !== undefined || deadline?.isPaused()) return;
    armedAt = Date.now();
    timer = setTimeout(() => {
      timer = undefined;
      armedAt = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
      if (!disposed) input.onTimeout();
    }, remaining);
    timer.unref?.();
  };

  if (deadline) {
    unsubscribe = deadline.subscribe(() => {
      clear();
      arm();
    });
  }
  arm();

  return () => {
    disposed = true;
    clear();
    unsubscribe?.();
    unsubscribe = undefined;
  };
}
