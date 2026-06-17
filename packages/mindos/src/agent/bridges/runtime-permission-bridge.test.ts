/**
 * Behavior tests for the runtime permission bridge. Migrated from
 * packages/web/__tests__/agent/runtime-permission-bridge.test.ts
 * (spec-agent-core-consolidation Wave 2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPendingRuntimePermissionCount,
  requestRuntimePermissionForRun,
  resolveRuntimePermission,
  runWithRuntimePermissionBridge,
} from './runtime-permission-bridge.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('runtime permission bridge', () => {
  it('lets an external runtime request wait on the current Chat Panel run', async () => {
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'run-claude', send }, async () => {
      const requestPromise = requestRuntimePermissionForRun('run-claude', {
        runtime: 'claude',
        toolCallId: 'toolu-1',
        toolName: 'Bash',
        input: { command: 'mindos file delete "Profile.md"' },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
        reason: 'Delete a note',
      });

      expect(getPendingRuntimePermissionCount()).toBe(1);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'runtime_permission_request',
        runId: 'run-claude',
        runtime: 'claude',
        toolCallId: 'toolu-1',
        toolName: 'Bash',
        action: 'command',
        resource: 'mindos file delete "Profile.md"',
        risk: expect.objectContaining({
          level: 'high',
          summary: 'Deletes or removes local files.',
        }),
      }));
      const requestEvent = send.mock.calls.find(([event]) => event.type === 'runtime_permission_request')?.[0];
      expect(requestEvent?.requestId).toBeTruthy();

      expect(resolveRuntimePermission({
        runId: 'run-claude',
        requestId: requestEvent.requestId,
        decision: 'accept',
      })).toEqual({ ok: true });

      return requestPromise;
    });

    await expect(promise).resolves.toEqual({
      decision: 'accept',
      cancelled: false,
      decisionLabel: 'Allow once',
      decisionIntent: 'allow',
    });
    expect(getPendingRuntimePermissionCount()).toBe(0);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'runtime_permission_resolved',
      decision: 'accept',
      cancelled: false,
      decisionLabel: 'Allow once',
      decisionIntent: 'allow',
    }));
  });

  it('cancels external runtime requests when no Chat Panel run is active', async () => {
    await expect(requestRuntimePermissionForRun('missing-run', {
      runtime: 'claude',
      toolCallId: 'toolu-missing',
      toolName: 'Bash',
      input: {},
      options: [],
    })).resolves.toMatchObject({ decision: 'cancel', cancelled: true });
  });

  it('cancels unresolved permission requests when the Chat Panel run finishes', async () => {
    const send = vi.fn();
    let requestPromise: Promise<unknown> | undefined;

    const runPromise = runWithRuntimePermissionBridge({ runId: 'run-finished', send }, async () => {
      requestPromise = requestRuntimePermissionForRun('run-finished', {
        runtime: 'codex',
        toolCallId: 'codex-approval-1',
        toolName: 'Bash',
        input: { command: 'rm note.md' },
        options: [],
      });
      expect(getPendingRuntimePermissionCount()).toBe(1);
      return 'finished';
    });

    await expect(runPromise).resolves.toBe('finished');
    await expect(requestPromise).resolves.toMatchObject({ decision: 'cancel', cancelled: true });
    expect(getPendingRuntimePermissionCount()).toBe(0);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'runtime_permission_resolved',
      decision: 'cancel',
      cancelled: true,
    }));
  });

  it('aborts a pending runtime permission request without leaking pending state', async () => {
    const send = vi.fn();
    const controller = new AbortController();
    const promise = runWithRuntimePermissionBridge({ runId: 'run-abort', send }, () => {
      const requestPromise = requestRuntimePermissionForRun('run-abort', {
        runtime: 'claude',
        toolCallId: 'toolu-abort',
        toolName: 'Bash',
        input: { command: 'mindos file delete note.md' },
        options: [],
      }, { signal: controller.signal });
      expect(getPendingRuntimePermissionCount()).toBe(1);
      controller.abort();
      return requestPromise;
    });

    await expect(promise).resolves.toMatchObject({ decision: 'cancel', cancelled: true });
    expect(getPendingRuntimePermissionCount()).toBe(0);
    expect(send.mock.calls.filter(([event]) => event.type === 'runtime_permission_resolved')).toHaveLength(1);
  });

  it('times out a pending runtime permission request and closes the UI state', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'run-timeout', send, timeoutMs: 5 }, () => (
      requestRuntimePermissionForRun('run-timeout', {
        runtime: 'claude',
        toolCallId: 'toolu-timeout',
        toolName: 'Bash',
        input: { command: 'mindos file delete note.md' },
        options: [],
      })
    ));

    expect(getPendingRuntimePermissionCount()).toBe(1);
    vi.advanceTimersByTime(5);

    await expect(promise).resolves.toMatchObject({ decision: 'cancel', cancelled: true });
    expect(getPendingRuntimePermissionCount()).toBe(0);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'runtime_permission_resolved',
      decision: 'cancel',
      cancelled: true,
    }));
  });

  it('returns 404 for stale permission decisions', () => {
    expect(resolveRuntimePermission({
      runId: 'missing-run',
      requestId: 'missing-request',
      decision: 'accept',
    })).toEqual({
      ok: false,
      status: 404,
      error: 'Permission request is no longer pending.',
    });
  });

  it('rejects decisions that were not offered by the pending request', async () => {
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'run-invalid-decision', send }, async () => {
      const requestPromise = requestRuntimePermissionForRun('run-invalid-decision', {
        runtime: 'codex',
        toolCallId: 'codex-approval-invalid',
        toolName: 'Bash',
        input: { command: 'rm note.md' },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      });
      const requestEvent = send.mock.calls.find(([event]) => event.type === 'runtime_permission_request')?.[0];

      expect(resolveRuntimePermission({
        runId: 'run-invalid-decision',
        requestId: requestEvent.requestId,
        decision: 'acceptForSession',
      })).toEqual({
        ok: false,
        status: 400,
        error: 'Permission decision is not valid for this request.',
      });
      expect(getPendingRuntimePermissionCount()).toBe(1);

      expect(resolveRuntimePermission({
        runId: 'run-invalid-decision',
        requestId: requestEvent.requestId,
        decision: 'decline',
      })).toEqual({ ok: true });
      return requestPromise;
    });

    await expect(promise).resolves.toEqual({
      decision: 'decline',
      cancelled: false,
      decisionLabel: 'Deny',
      decisionIntent: 'deny',
    });
    expect(getPendingRuntimePermissionCount()).toBe(0);
  });

  it('keeps selected option scope in the resolved event and runtime result', async () => {
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'run-session-allow', send }, async () => {
      const requestPromise = requestRuntimePermissionForRun('run-session-allow', {
        runtime: 'codex',
        toolCallId: 'toolu-session',
        toolName: 'Bash',
        input: { command: 'npm test' },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow', scope: 'once' },
          { id: 'acceptForSession', label: 'Allow this session', intent: 'allow', scope: 'session' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      });
      const requestEvent = send.mock.calls.find(([event]) => event.type === 'runtime_permission_request')?.[0];
      expect(resolveRuntimePermission({
        runId: 'run-session-allow',
        requestId: requestEvent.requestId,
        decision: 'acceptForSession',
      })).toEqual({ ok: true });
      return requestPromise;
    });

    await expect(promise).resolves.toEqual({
      decision: 'acceptForSession',
      cancelled: false,
      decisionLabel: 'Allow this session',
      decisionIntent: 'allow',
      decisionScope: 'session',
    });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'runtime_permission_resolved',
      decision: 'acceptForSession',
      decisionLabel: 'Allow this session',
      decisionIntent: 'allow',
      decisionScope: 'session',
    }));
  });

  it('honors explicit file action and risk summaries from runtime adapters', async () => {
    const send = vi.fn();
    const promise = runWithRuntimePermissionBridge({ runId: 'run-explicit-risk', send }, async () => {
      const requestPromise = requestRuntimePermissionForRun('run-explicit-risk', {
        runtime: 'codex',
        toolCallId: 'file-change-1',
        toolName: 'file_change_approval',
        input: { path: 'README.md' },
        action: 'file-change',
        resource: 'README.md',
        risk: {
          level: 'medium',
          summary: 'Updates a tracked file.',
          reasons: ['file write'],
        },
        options: [
          { id: 'accept', label: 'Allow once', intent: 'allow' },
          { id: 'decline', label: 'Deny', intent: 'deny' },
        ],
      });
      const requestEvent = send.mock.calls.find(([event]) => event.type === 'runtime_permission_request')?.[0];
      expect(requestEvent).toMatchObject({
        action: 'file-change',
        resource: 'README.md',
        risk: {
          level: 'medium',
          summary: 'Updates a tracked file.',
          reasons: ['file write'],
        },
      });
      expect(resolveRuntimePermission({
        runId: 'run-explicit-risk',
        requestId: requestEvent.requestId,
        decision: 'decline',
      })).toEqual({ ok: true });
      return requestPromise;
    });

    await expect(promise).resolves.toMatchObject({
      decision: 'decline',
      cancelled: false,
      decisionIntent: 'deny',
    });
  });
});
