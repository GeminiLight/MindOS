// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  PENDING_ACTIONS_EVENT_DEBOUNCE_MS,
  PENDING_ACTIONS_FALLBACK_POLL_MS,
  PENDING_ACTIONS_URL,
  requestPendingAgentActionsRefresh,
  usePendingAgentActions,
} from '@/hooks/usePendingAgentActions';
import { resetServerEventsForTests } from '@/lib/server-events';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';

/**
 * Transport contract of the Web pending-actions hook
 * (spec-cross-process-run-events H): event-driven with one shared debounce,
 * polling ONLY while the stream is disconnected, and a 404-on-resolve means
 * "resolved elsewhere" — remove, no error, refetch once.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof usePendingAgentActions> | null = null;

function Harness(props: { pollIntervalMs?: number }) {
  latest = usePendingAgentActions(props);
  return null;
}

function permissionAction(requestId = 'req-1') {
  const now = Date.now();
  return {
    kind: 'runtime-permission',
    runId: 'run-1',
    requestId,
    runtime: 'codex',
    toolCallId: 'tool-1',
    toolName: 'Bash',
    action: 'command',
    options: [{ id: 'allow-once', label: 'Allow once', intent: 'allow', scope: 'once' }],
    risk: { level: 'medium', summary: 'Runs a command.' },
    createdAt: now,
    expiresAt: now + 600_000,
  };
}

function pendingRunEvent(id: number) {
  return {
    type: 'agent-run.event',
    runId: 'run-1',
    event: { id: `evt-${id}`, runId: 'run-1', type: 'permission_requested', category: 'permission', status: 'running', ts: id },
  };
}

describe('usePendingAgentActions transport', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;
  let payload: unknown;
  let postStatus: number;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    latest = null;
    payload = { permissions: [permissionAction()], questions: [], automationApprovals: [] };
    postStatus = 200;
    container = document.createElement('div');
    document.body.appendChild(container);
    setDocumentVisibility('visible');
    fetchMock = vi.fn(async (input: unknown) => {
      const url = String(typeof input === 'string' ? input : (input as { url?: string })?.url ?? input);
      if (url.startsWith(PENDING_ACTIONS_URL)) {
        return { ok: true, status: 200, json: async () => payload };
      }
      return {
        ok: postStatus < 400,
        status: postStatus,
        json: async () => (postStatus === 404 ? { error: 'Permission request is no longer pending.' } : { ok: true }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    latest = null;
    container.remove();
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mount(props: { pollIntervalMs?: number } = {}) {
    act(() => {
      root = createRoot(container);
      root.render(<Harness {...props} />);
    });
    await act(async () => { vi.advanceTimersByTime(0); });
  }

  function getRequests(): number {
    return fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(PENDING_ACTIONS_URL)).length;
  }

  function postRequests(): Array<{ url: string; body: unknown }> {
    return fetchMock.mock.calls
      .filter((call) => !String(call[0]).startsWith(PENDING_ACTIONS_URL))
      .map((call) => ({ url: String(call[0]), body: JSON.parse(String((call[1] as { body?: string })?.body ?? '{}')) }));
  }

  it('fetches one initial snapshot and exposes normalized actions with stable keys', async () => {
    await mount();
    expect(getRequests()).toBe(1);
    expect(latest?.actions.map((action) => action.key)).toEqual(['runtime-permission:run-1:req-1']);
    expect(latest?.pendingCount).toBe(1);
    expect(latest?.loading).toBe(false);
    expect(latest?.error).toBe('');
  });

  it('coalesces a burst of pending-changed and run events into one debounced refetch', async () => {
    await mount();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });

    act(() => {
      source.emit('run.pending-actions.changed', { type: 'run.pending-actions.changed' }, 2);
      source.emit('run.pending-actions.changed', { type: 'run.pending-actions.changed' }, 3);
      source.emit('agent-run.event', pendingRunEvent(4), 4);
    });
    expect(getRequests()).toBe(1);
    act(() => { vi.advanceTimersByTime(PENDING_ACTIONS_EVENT_DEBOUNCE_MS - 1); });
    expect(getRequests()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(getRequests()).toBe(2);
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_EVENT_DEBOUNCE_MS * 3); });
    expect(getRequests()).toBe(2);
  });

  it('ignores agent-run events that cannot change the pending list', async () => {
    await mount();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });
    act(() => {
      source.emit('agent-run.event', {
        type: 'agent-run.event',
        runId: 'run-1',
        event: { id: 'evt-x', runId: 'run-1', type: 'tool_started', category: 'tool', status: 'running', ts: 1 },
      }, 2);
      source.emit('tree.changed', { type: 'tree.changed', version: 3 }, 3);
    });
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_EVENT_DEBOUNCE_MS * 2); });
    expect(getRequests()).toBe(1);
  });

  it('does not poll while the stream is connected', async () => {
    await mount({ pollIntervalMs: 1000 });
    MockEventSource.last().ready({ lastEventId: 1 });
    await act(async () => { vi.advanceTimersByTime(35_000); });
    expect(getRequests()).toBe(1);
  });

  it('falls back to a 10s poll only while the stream is not connected', async () => {
    await mount();
    // EventSource exists but never opened: state stays `connecting`.
    expect(getRequests()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_FALLBACK_POLL_MS - 1); });
    expect(getRequests()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(getRequests()).toBe(2);
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_FALLBACK_POLL_MS); });
    expect(getRequests()).toBe(3);

    // Once connected, the polling stops again.
    MockEventSource.last().ready({ lastEventId: 1 });
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_FALLBACK_POLL_MS * 3); });
    expect(getRequests()).toBe(3);
  });

  it('refreshes on ready.resync after a replay gap', async () => {
    await mount();
    MockEventSource.last().ready({ lastEventId: 1, resync: true });
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_EVENT_DEBOUNCE_MS); });
    expect(getRequests()).toBe(2);
  });

  it('lets requestPendingAgentActionsRefresh trigger a debounced refetch', async () => {
    await mount();
    act(() => { requestPendingAgentActionsRefresh(); });
    await act(async () => { vi.advanceTimersByTime(PENDING_ACTIONS_EVENT_DEBOUNCE_MS); });
    expect(getRequests()).toBe(2);
  });

  it('resolves a permission through the existing POST endpoint', async () => {
    await mount();
    const action = latest!.permissions[0]!;
    let ok: boolean | null = null;
    await act(async () => {
      ok = await latest!.resolvePermission(action, 'allow-once');
    });
    expect(ok).toBe(true);
    expect(postRequests()).toEqual([{
      url: '/api/agent/runtime-permission',
      body: { runId: 'run-1', requestId: 'req-1', decision: 'allow-once' },
    }]);
  });

  it('treats a 404-on-resolve as resolved elsewhere: removed, no error, one refetch', async () => {
    await mount();
    expect(latest!.actions).toHaveLength(1);
    postStatus = 404;
    // After the decision, the server no longer lists the prompt.
    payload = { permissions: [], questions: [], automationApprovals: [] };
    const action = latest!.permissions[0]!;
    let ok: boolean | null = null;
    await act(async () => {
      ok = await latest!.resolvePermission(action, 'allow-once');
    });
    expect(ok).toBe(false);
    expect(latest!.error).toBe('');
    expect(latest!.actions).toEqual([]);
    expect(latest!.resolvingKey).toBeNull();
    // Exactly one refetch followed the decision.
    expect(getRequests()).toBe(2);
  });

  it('surfaces a 500-on-resolve as a compact error and refetches', async () => {
    await mount();
    postStatus = 500;
    const action = latest!.permissions[0]!;
    let ok: boolean | null = null;
    await act(async () => {
      ok = await latest!.resolvePermission(action, 'allow-once');
    });
    expect(ok).toBe(false);
    expect(latest!.error).toBe('Could not resolve this request.');
    expect(latest!.actions).toHaveLength(1);
    expect(getRequests()).toBe(2);
  });

  it('compacts a no-longer-pending error message from a 400 response', async () => {
    await mount();
    postStatus = 400;
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith(PENDING_ACTIONS_URL)) {
        return { ok: true, status: 200, json: async () => payload };
      }
      return { ok: false, status: 400, json: async () => ({ error: 'Question is no longer pending.' }) };
    });
    const action = latest!.permissions[0]!;
    await act(async () => {
      await latest!.resolvePermission(action, 'allow-once');
    });
    expect(latest!.error).toBe('This request was already resolved or expired.');
  });
});
