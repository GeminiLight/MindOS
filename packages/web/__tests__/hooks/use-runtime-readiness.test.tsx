// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRuntimeReadiness, RUNTIME_READINESS_FALLBACK_POLL_MS } from '@/hooks/useRuntimeReadiness';
import { resetServerEventsForTests } from '@/lib/server-events';
import { MockEventSource } from '../fixtures/mock-event-source';
import type {
  AgentPermissionMode,
  AgentRuntimeReadinessProjection,
  AgentRuntimeReadinessPayload,
} from '@/lib/types';

function projection(
  runtimeId: string,
  runtimeKind: AgentRuntimeReadinessProjection['runtimeKind'],
): AgentRuntimeReadinessProjection {
  return {
    schemaVersion: 1,
    runtimeId,
    runtimeName: runtimeId,
    runtimeKind,
    runtimeStatus: 'available',
    overallStatus: 'limited',
    summary: `${runtimeId} readiness`,
    recommendations: [],
    useCases: [],
    gaps: [],
  };
}

function payload(permissionMode: AgentPermissionMode, projections: AgentRuntimeReadinessProjection[]): AgentRuntimeReadinessPayload {
  return {
    schemaVersion: 1,
    requestedPermissionMode: permissionMode,
    projections,
  };
}

function Probe({
  visible,
  permissionMode,
  onState,
}: {
  visible: boolean;
  permissionMode: AgentPermissionMode;
  onState: (state: ReturnType<typeof useRuntimeReadiness>) => void;
}) {
  const state = useRuntimeReadiness({ visible, permissionMode });
  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return (
    <div
      data-loading={state.loading ? 'true' : 'false'}
      data-runtimes={Object.keys(state.readinessByRuntimeId).sort().join(',')}
    />
  );
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useRuntimeReadiness', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('fetches readiness for the active permission mode and indexes by runtime id and kind', async () => {
    const onState = vi.fn();
    const fetchMock = vi.fn(async (url: string) => {
      const mode = new URL(url, 'http://mindos.local').searchParams.get('permissionMode') as AgentPermissionMode;
      return new Response(JSON.stringify(payload(mode, [projection('codex-app-server', 'codex')])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible permissionMode="ask" onState={onState} />);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/readiness?permissionMode=ask', expect.any(Object));
    const node = host.querySelector('div') as HTMLDivElement;
    expect(node.dataset.loading).toBe('false');
    expect(node.dataset.runtimes).toBe('codex,codex-app-server');

    await act(async () => {
      root.render(<Probe visible permissionMode="full" onState={onState} />);
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes/readiness?permissionMode=full', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fetch while hidden', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(<Probe visible={false} permissionMode="ask" onState={vi.fn()} />);
      await flushAsync();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const node = host.querySelector('div') as HTMLDivElement;
    expect(node.dataset.loading).toBe('false');
    expect(node.dataset.runtimes).toBe('');
  });

  describe('server event refreshes', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      MockEventSource.reset();
      resetServerEventsForTests();
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    afterEach(() => {
      resetServerEventsForTests();
      vi.useRealTimers();
    });

    function readinessResponse() {
      return new Response(JSON.stringify(payload('ask', [projection('codex-app-server', 'codex')])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    it('refreshes when the server reports mcp.changed', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      const fetchMock = vi.fn(async () => readinessResponse());
      vi.stubGlobal('fetch', fetchMock);

      await act(async () => {
        root.render(<Probe visible permissionMode="ask" onState={vi.fn()} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const source = MockEventSource.last();
      source.ready({ lastEventId: 1 });

      await act(async () => {
        source.emit('mcp.changed', { type: 'mcp.changed' }, 2);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Connected: no periodic refresh.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RUNTIME_READINESS_FALLBACK_POLL_MS * 2);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes when the server reports runtime.changed', async () => {
      vi.stubGlobal('EventSource', MockEventSource);
      const fetchMock = vi.fn(async () => readinessResponse());
      vi.stubGlobal('fetch', fetchMock);

      await act(async () => {
        root.render(<Probe visible permissionMode="ask" onState={vi.fn()} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const source = MockEventSource.last();
      source.ready({ lastEventId: 1 });

      await act(async () => {
        source.emit('runtime.changed', { type: 'runtime.changed', runtimes: ['codex'] }, 2);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('polls every 60s only while the stream is unsupported', async () => {
      vi.stubGlobal('EventSource', undefined);
      delete (globalThis as { EventSource?: unknown }).EventSource;
      const fetchMock = vi.fn(async () => readinessResponse());
      vi.stubGlobal('fetch', fetchMock);

      await act(async () => {
        root.render(<Probe visible permissionMode="ask" onState={vi.fn()} />);
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(RUNTIME_READINESS_FALLBACK_POLL_MS).toBe(60_000);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RUNTIME_READINESS_FALLBACK_POLL_MS - 1);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
