import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMindRootResolverForTests } from '../../foundation/mind-root/index.js';
import {
  createTurnDeadline,
  getCurrentTurnDeadline,
  pauseTurnDeadlineForRun,
  registerTurnDeadlineForRun,
  resetTurnDeadlineRegistryForTest,
  resumeTurnDeadlineForRun,
  runWithTurnDeadline,
} from './turn-deadline.js';
import { runMindosWithTimeout } from './retry.js';
import {
  requestRuntimePermissionViaBridge,
  resolveRuntimePermission,
  runWithRuntimePermissionBridge,
} from '../bridges/runtime-permission-bridge.js';
import type { MindOSSSEvent } from './index.js';

describe('turn deadline suspension', () => {
  // The bridge integration cases persist pending prompts through the shared
  // store; point it at a temp root so tests never touch the real mind root.
  let mindRoot = '';

  beforeEach(() => {
    mindRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-turn-deadline-'));
    setMindRootResolverForTests(() => mindRoot);
    vi.useFakeTimers();
    resetTurnDeadlineRegistryForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTurnDeadlineRegistryForTest();
    setMindRootResolverForTests(null);
    fs.rmSync(mindRoot, { recursive: true, force: true });
  });

  describe('createTurnDeadline', () => {
    it('tracks the remaining budget without pauses', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      expect(deadline.remainingMs()).toBe(1_000);
      vi.advanceTimersByTime(400);
      expect(deadline.remainingMs()).toBe(600);
      expect(deadline.isPaused()).toBe(false);
    });

    it('freezes the remaining budget while paused and extends the deadline on resume', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      vi.advanceTimersByTime(300);
      deadline.pause();
      expect(deadline.isPaused()).toBe(true);
      vi.advanceTimersByTime(5_000);
      expect(deadline.remainingMs()).toBe(700);
      deadline.resume();
      expect(deadline.isPaused()).toBe(false);
      expect(deadline.remainingMs()).toBe(700);
      vi.advanceTimersByTime(700);
      expect(deadline.remainingMs()).toBe(0);
    });

    it('counts nested pauses once (depth counting)', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      deadline.pause();
      deadline.pause();
      vi.advanceTimersByTime(500);
      deadline.resume();
      expect(deadline.isPaused()).toBe(true);
      expect(deadline.remainingMs()).toBe(1_000);
      deadline.resume();
      expect(deadline.isPaused()).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(deadline.remainingMs()).toBe(0);
    });

    it('ignores unmatched resume calls', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      deadline.resume();
      deadline.resume();
      vi.advanceTimersByTime(200);
      expect(deadline.remainingMs()).toBe(800);
    });

    it('stops extending once the total pause budget is exhausted mid-pause', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000, maxTotalPauseMs: 500 });
      deadline.pause();
      // The cap fires mid-pause: the clock resumes even though nobody called resume().
      vi.advanceTimersByTime(500);
      expect(deadline.isPaused()).toBe(false);
      expect(deadline.totalPausedMs()).toBe(500);
      vi.advanceTimersByTime(1_000);
      expect(deadline.remainingMs()).toBe(0);
      // A later resume for the still-open pause token must not extend again.
      deadline.resume();
      expect(deadline.remainingMs()).toBe(0);
    });

    it('refuses further pauses after the total pause budget is exhausted', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000, maxTotalPauseMs: 300 });
      deadline.pause();
      vi.advanceTimersByTime(200);
      deadline.resume();
      expect(deadline.totalPausedMs()).toBe(200);
      deadline.pause();
      vi.advanceTimersByTime(100);
      // Cap reached mid-pause (200 + 100 = 300): exhausted from here on.
      expect(deadline.isPaused()).toBe(false);
      deadline.pause();
      vi.advanceTimersByTime(500);
      expect(deadline.isPaused()).toBe(false);
      expect(deadline.totalPausedMs()).toBe(300);
    });

    it('reports pausedMsSoFar including an in-progress pause', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      deadline.pause();
      vi.advanceTimersByTime(250);
      expect(deadline.pausedMsSoFar()).toBe(250);
      deadline.resume();
      expect(deadline.pausedMsSoFar()).toBe(250);
    });
  });

  describe('registry', () => {
    it('pauses and resumes a registered deadline by run id', () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      const unregister = registerTurnDeadlineForRun('run-1', deadline);
      expect(pauseTurnDeadlineForRun('run-1')).toBe(true);
      expect(deadline.isPaused()).toBe(true);
      expect(resumeTurnDeadlineForRun('run-1')).toBe(true);
      expect(deadline.isPaused()).toBe(false);
      unregister();
      expect(pauseTurnDeadlineForRun('run-1')).toBe(false);
    });

    it('is a no-op for unknown run ids', () => {
      expect(pauseTurnDeadlineForRun('missing')).toBe(false);
      expect(resumeTurnDeadlineForRun('missing')).toBe(false);
    });
  });

  describe('runWithTurnDeadline ALS', () => {
    it('exposes the deadline to nested async calls', async () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000 });
      await runWithTurnDeadline(deadline, async () => {
        expect(getCurrentTurnDeadline()).toBe(deadline);
        await Promise.resolve();
        expect(getCurrentTurnDeadline()).toBe(deadline);
      });
      expect(getCurrentTurnDeadline()).toBeUndefined();
    });
  });

  describe('runMindosWithTimeout', () => {
    it('keeps the plain wall-clock behaviour without a deadline context', async () => {
      const promise = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 1_500));
      const race = runMindosWithTimeout(promise, 1_000, 'timed out');
      // Attach the rejection handler before flushing timers so the rejection
      // is never observed as unhandled.
      const assertion = expect(race).rejects.toMatchObject({ code: 'TIMEOUT', message: 'timed out' });
      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
    });

    it('does not fire the timeout while the deadline is paused', async () => {
      const deadline = createTurnDeadline({ timeoutMs: 10_000 });
      let resolveWork: (() => void) | undefined;
      const work = new Promise<void>((resolve) => { resolveWork = resolve; });
      const race = runWithTurnDeadline(deadline, () => runMindosWithTimeout(work, 1_000, 'timed out'));

      await vi.advanceTimersByTimeAsync(600);
      deadline.pause();
      // A bridge wait longer than the whole turn budget must not time out.
      await vi.advanceTimersByTimeAsync(60_000);
      deadline.resume();
      await vi.advanceTimersByTimeAsync(399);
      resolveWork?.();
      await expect(race).resolves.toBeUndefined();
    });

    it('fires the timeout with the remaining budget after resume', async () => {
      const deadline = createTurnDeadline({ timeoutMs: 10_000 });
      const never = new Promise<void>(() => {});
      const race = runWithTurnDeadline(deadline, () => runMindosWithTimeout(never, 1_000, 'timed out'));
      let rejected = false;
      race.catch(() => { rejected = true; });
      const assertion = expect(race).rejects.toMatchObject({ code: 'TIMEOUT' });

      await vi.advanceTimersByTimeAsync(600);
      deadline.pause();
      await vi.advanceTimersByTimeAsync(5_000);
      deadline.resume();
      await vi.advanceTimersByTimeAsync(399);
      expect(rejected).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await assertion;
    });

    it('fires the timeout once the total pause budget is exhausted while paused', async () => {
      const deadline = createTurnDeadline({ timeoutMs: 1_000, maxTotalPauseMs: 500 });
      const never = new Promise<void>(() => {});
      const race = runWithTurnDeadline(deadline, () => runMindosWithTimeout(never, 1_000, 'timed out'));
      let rejected = false;
      race.catch(() => { rejected = true; });
      const assertion = expect(race).rejects.toMatchObject({ code: 'TIMEOUT' });

      deadline.pause();
      // 500ms of pause credit, then the turn clock runs again for its remaining 1000ms.
      await vi.advanceTimersByTimeAsync(1_499);
      expect(rejected).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await assertion;
    });
  });

  describe('bridge integration', () => {
    it('suspends the registered turn deadline while a permission request is pending', async () => {
      const deadline = createTurnDeadline({ timeoutMs: 60_000 });
      const unregister = registerTurnDeadlineForRun('bridge-run', deadline);
      const events: MindOSSSEvent[] = [];
      try {
        const pending = runWithRuntimePermissionBridge(
          { runId: 'bridge-run', send: (event) => events.push(event) },
          async () => requestRuntimePermissionViaBridge({
            runtime: 'codex',
            toolCallId: 'tool-1',
            toolName: 'Bash',
            input: { command: 'ls' },
            options: [{ id: 'accept', label: 'Allow once', intent: 'allow' }],
          }),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(deadline.isPaused()).toBe(true);

        const requestId = (events[0] as { requestId: string }).requestId;
        resolveRuntimePermission({ runId: 'bridge-run', requestId, decision: 'accept' });
        await expect(pending).resolves.toMatchObject({ decision: 'accept' });
        expect(deadline.isPaused()).toBe(false);
        expect(deadline.totalPausedMs()).toBe(0);
      } finally {
        unregister();
      }
    });

    it('resumes the deadline when a pending permission request times out or is cancelled', async () => {
      const deadline = createTurnDeadline({ timeoutMs: 60_000 });
      const unregister = registerTurnDeadlineForRun('bridge-run-2', deadline);
      try {
        const pending = runWithRuntimePermissionBridge(
          { runId: 'bridge-run-2', send: () => {}, timeoutMs: 1_000 },
          () => requestRuntimePermissionViaBridge({
            runtime: 'claude',
            toolCallId: 'tool-2',
            toolName: 'Write',
            input: {},
            options: [{ id: 'accept', label: 'Allow once', intent: 'allow' }],
          }),
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(deadline.isPaused()).toBe(true);
        // The bridge's own timeout resolves the request as cancelled and un-pauses.
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(pending).resolves.toMatchObject({ cancelled: true });
        expect(deadline.isPaused()).toBe(false);
        expect(deadline.totalPausedMs()).toBe(1_000);
      } finally {
        unregister();
      }
    });
  });
});
