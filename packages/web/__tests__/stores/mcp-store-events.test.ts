// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

import { MCP_STORE_POLL_INTERVAL_MS, resetMcpStoreForTests, useMcpStore } from '@/lib/stores/mcp-store';
import { resetServerEventsForTests } from '@/lib/server-events';
import { MockEventSource, setDocumentVisibility } from '../fixtures/mock-event-source';

describe('mcp-store server event refreshes', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    resetServerEventsForTests();
    resetMcpStoreForTests();
    vi.stubGlobal('EventSource', MockEventSource);
    setDocumentVisibility('visible');
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/mcp/status')) return { running: true };
      if (url.startsWith('/api/mcp/agents')) return { agents: [] };
      if (url.startsWith('/api/skills')) return { skills: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    resetServerEventsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function flush(ms = 0) {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it('re-fetches status, agents and skills when the server reports mcp.changed or skills.changed', async () => {
    cleanup = useMcpStore.getState()._init();
    await flush();
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    expect(MockEventSource.instances).toHaveLength(1);
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });

    source.emit('mcp.changed', { type: 'mcp.changed' }, 2);
    await flush(499);
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    await flush(1);
    expect(apiFetchMock).toHaveBeenCalledTimes(6);

    source.emit('skills.changed', { type: 'skills.changed' }, 3);
    await flush(500);
    expect(apiFetchMock).toHaveBeenCalledTimes(9);
  });

  it('refreshes after a reconnect that could not replay the gap', async () => {
    cleanup = useMcpStore.getState()._init();
    await flush();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });
    await flush(3_000);
    expect(apiFetchMock).toHaveBeenCalledTimes(3);

    source.emit('ready', { type: 'ready', lastEventId: 50, resync: true }, 50);
    await flush(500);
    expect(apiFetchMock).toHaveBeenCalledTimes(6);
  });

  it('keeps only a five minute safety poll and stays quiet for 35 idle seconds', async () => {
    expect(MCP_STORE_POLL_INTERVAL_MS).toBe(5 * 60_000);
    cleanup = useMcpStore.getState()._init();
    await flush();
    MockEventSource.last().ready({ lastEventId: 1 });
    expect(apiFetchMock).toHaveBeenCalledTimes(3);

    await flush(35_000);
    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    await flush(MCP_STORE_POLL_INTERVAL_MS - 35_000);
    expect(apiFetchMock).toHaveBeenCalledTimes(6);
  });

  it('closes the shared stream when the store is torn down and nobody else listens', async () => {
    cleanup = useMcpStore.getState()._init();
    await flush();
    const source = MockEventSource.last();
    cleanup();
    cleanup = null;
    expect(source.closed).toBe(true);
  });
});
