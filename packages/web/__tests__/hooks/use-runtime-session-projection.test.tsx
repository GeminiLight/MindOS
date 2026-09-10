// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  RUNTIME_SESSION_PROJECTION_FALLBACK_POLL_MS,
  useRuntimeSessionProjection,
} from '@/hooks/useRuntimeSessionProjection';
import { resetServerEventsForTests } from '@/lib/server-events';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';
import type { AgentRuntimeIdentity } from '@/lib/types';

const ACP_RUNTIME: AgentRuntimeIdentity = { id: 'gemini', name: 'Gemini CLI', kind: 'acp' };

function Probe({ visible, runtime }: { visible: boolean; runtime: AgentRuntimeIdentity | null }) {
  const state = useRuntimeSessionProjection({ visible, runtime });
  return <div data-loading={state.loading ? 'true' : 'false'} data-count={state.projections.length} />;
}

function projectionResponse() {
  return new Response(JSON.stringify({
    schemaVersion: 1,
    projections: [{ schemaVersion: 1, runtimeId: 'gemini', runtimeKind: 'acp', status: 'idle', slashCommands: { commands: [] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function runEvent(type: string) {
  return {
    type: 'agent-run.event',
    runId: 'run-1',
    event: { id: 'evt', runId: 'run-1', type, category: 'status', status: 'completed', ts: 1 },
  };
}

describe('useRuntimeSessionProjection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    setDocumentVisibility('visible');
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function mountConnected(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => {
      root.render(<Probe visible runtime={ACP_RUNTIME} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return source;
  }

  it('fetches once on mount and stays quiet for 35 idle seconds while the stream is connected', async () => {
    const fetchMock = vi.fn(async () => projectionResponse());
    await mountConnected(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/session-projections?runtime=gemini', expect.objectContaining({ cache: 'no-store' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((host.querySelector('div') as HTMLDivElement).dataset.count).toBe('1');
  });

  it('refreshes on turn boundaries but not on intra-turn tool events', async () => {
    const fetchMock = vi.fn(async () => projectionResponse());
    const source = await mountConnected(fetchMock);

    await act(async () => {
      source.emit('agent-run.event', runEvent('tool_started'), 2);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      source.emit('agent-run.event', runEvent('run_completed'), 3);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes on runtime.changed and on a resync ready frame', async () => {
    const fetchMock = vi.fn(async () => projectionResponse());
    const source = await mountConnected(fetchMock);

    await act(async () => {
      source.emit('runtime.changed', { type: 'runtime.changed', runtimes: ['gemini'] }, 2);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      source.emit('ready', { type: 'ready', lastEventId: 9, resync: true }, 9);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('polls every 30s only while the stream is unsupported and the tab is visible', async () => {
    vi.stubGlobal('EventSource', undefined);
    delete (globalThis as { EventSource?: unknown }).EventSource;
    const fetchMock = vi.fn(async () => projectionResponse());
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible runtime={ACP_RUNTIME} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(RUNTIME_SESSION_PROJECTION_FALLBACK_POLL_MS).toBe(30_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUNTIME_SESSION_PROJECTION_FALLBACK_POLL_MS - 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    setDocumentVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RUNTIME_SESSION_PROJECTION_FALLBACK_POLL_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing for non-ACP runtimes or while hidden', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible runtime={{ id: 'codex', name: 'Codex', kind: 'codex' }} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      root.render(<Probe visible={false} runtime={ACP_RUNTIME} />);
      await vi.advanceTimersByTimeAsync(35_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
