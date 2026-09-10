/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useNativeRuntimeDetection } from '@/hooks/useNativeRuntimeDetection';
import { resetServerEventsForTests } from '@/lib/server-events';
import { MockEventSource } from '../fixtures/mock-event-source';

const TEST_RUNTIME_LIFECYCLE = {
  schemaVersion: 1,
  stages: {},
  remote: { supported: true, mode: 'server-runnable', unattended: 'limited', summary: 'test' },
  coordination: {
    role: 'external-worker',
    supportsSharedContext: true,
    supportsMailbox: false,
    supportsTaskBoard: false,
    summary: 'test',
  },
};
const TEST_RUNTIME_COMPATIBILITY = {
  schemaVersion: 1,
  summary: 'test',
  scenarios: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useNativeRuntimeDetection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    MockEventSource.reset();
    resetServerEventsForTests();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    resetServerEventsForTests();
    vi.unstubAllGlobals();
  });

  function cachedDescriptor(kind: 'codex' | 'claude') {
    return JSON.stringify({
      ts: Date.now(),
      runtime: {
        id: kind,
        name: kind === 'codex' ? 'Codex' : 'Claude Code',
        kind,
        status: 'available',
        capabilities: {},
        lifecycle: TEST_RUNTIME_LIFECYCLE,
        compatibility: TEST_RUNTIME_COMPATIBILITY,
      },
    });
  }

  function descriptorResponse(kind: string, status = 'available') {
    return new Response(JSON.stringify({
      runtime: {
        id: kind,
        name: kind === 'codex' ? 'Codex' : 'Claude Code',
        kind,
        status,
        capabilities: {},
        lifecycle: TEST_RUNTIME_LIFECYCLE,
        compatibility: TEST_RUNTIME_COMPATIBILITY,
      },
    }), { status: 200 });
  }

  it('updates each native runtime independently as its request finishes', async () => {
    const codex = deferred<Response>();
    const claude = deferred<Response>();
    const states: Array<ReturnType<typeof useNativeRuntimeDetection>> = [];
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('runtime=codex')) return codex.promise;
      if (url.includes('runtime=claude')) return claude.promise;
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    function Probe() {
      states.push(useNativeRuntimeDetection());
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes?runtime=codex', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes?runtime=claude', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(states.at(-1)?.loadingByKind).toEqual({ codex: true, claude: true });

    await act(async () => {
      claude.resolve(new Response(JSON.stringify({
        runtime: {
          id: 'claude',
          name: 'Claude Code',
          kind: 'claude',
          status: 'available',
          capabilities: {},
          lifecycle: TEST_RUNTIME_LIFECYCLE,
          compatibility: TEST_RUNTIME_COMPATIBILITY,
        },
      }), { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(states.at(-1)?.runtimes).toEqual([
      expect.objectContaining({ id: 'claude', status: 'available' }),
    ]);
    expect(states.at(-1)?.loadingByKind).toEqual({ codex: true, claude: false });

    await act(async () => {
      codex.resolve(new Response(JSON.stringify({
        runtime: {
          id: 'codex',
          name: 'Codex',
          kind: 'codex',
          status: 'signed-out',
          capabilities: {},
          lifecycle: TEST_RUNTIME_LIFECYCLE,
          compatibility: TEST_RUNTIME_COMPATIBILITY,
          availability: { checkedAt: '2026-06-09T00:00:00.000Z', sources: ['native-health'], reason: 'STAFF_KEY missing.' },
        },
      }), { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(states.at(-1)?.runtimes).toEqual([
      expect.objectContaining({ id: 'codex', status: 'signed-out' }),
      expect.objectContaining({ id: 'claude', status: 'available' }),
    ]);
    expect(states.at(-1)?.loadingByKind).toEqual({ codex: false, claude: false });

    await act(async () => {
      root.unmount();
    });
  });

  it('trusts a fresh sessionStorage copy on mount and only fetches the kinds without one', async () => {
    sessionStorage.setItem('mindos:native-runtime-detection:v3:codex', cachedDescriptor('codex'));
    const fetchMock = vi.fn((url: string) => Promise.resolve(descriptorResponse(url.includes('runtime=codex') ? 'codex' : 'claude')));
    vi.stubGlobal('fetch', fetchMock);

    const states: Array<ReturnType<typeof useNativeRuntimeDetection>> = [];
    function Probe() {
      states.push(useNativeRuntimeDetection());
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes?runtime=claude', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(states[0]?.loadingByKind).toEqual({ claude: true });
    expect(states[0]?.runtimes).toEqual([expect.objectContaining({ id: 'codex', status: 'available' })]);

    await act(async () => {
      root.unmount();
    });
  });

  it('re-fetches only the runtime named by runtime.changed and both on settings.changed', async () => {
    sessionStorage.setItem('mindos:native-runtime-detection:v3:codex', cachedDescriptor('codex'));
    sessionStorage.setItem('mindos:native-runtime-detection:v3:claude', cachedDescriptor('claude'));
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = vi.fn((url: string) => Promise.resolve(descriptorResponse(url.includes('runtime=codex') ? 'codex' : 'claude', 'signed-out')));
    vi.stubGlobal('fetch', fetchMock);

    const states: Array<ReturnType<typeof useNativeRuntimeDetection>> = [];
    function Probe() {
      states.push(useNativeRuntimeDetection());
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });

    await act(async () => {
      source.emit('runtime.changed', { type: 'runtime.changed', runtimes: ['claude'] }, 2);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/agent-runtimes?runtime=claude', expect.any(Object));
    expect(states.at(-1)?.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude', status: 'signed-out' }),
      expect.objectContaining({ id: 'codex', status: 'available' }),
    ]));

    await act(async () => {
      source.emit('settings.changed', { type: 'settings.changed' }, 3);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/agent-runtimes?runtime=claude',
      '/api/agent-runtimes?runtime=claude',
      '/api/agent-runtimes?runtime=codex',
    ]);

    await act(async () => {
      root.unmount();
    });
  });

  it('marks cached available runtime state as unavailable when an event-driven re-check fails', async () => {
    sessionStorage.setItem('mindos:native-runtime-detection:v3:claude', cachedDescriptor('claude'));
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('runtime=claude')) return Promise.reject(new Error('Detection failed'));
      return Promise.resolve(descriptorResponse('codex', 'missing'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const states: Array<ReturnType<typeof useNativeRuntimeDetection>> = [];

    function Probe() {
      states.push(useNativeRuntimeDetection());
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(Probe));
      await Promise.resolve();
      await Promise.resolve();
    });
    // Codex has no cached copy and is fetched on mount; Claude waits for an event.
    expect(states[0]?.loadingByKind).toEqual({ codex: true });
    const source = MockEventSource.last();
    source.ready({ lastEventId: 1 });

    await act(async () => {
      source.emit('runtime.changed', { type: 'runtime.changed', runtimes: ['claude'] }, 2);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(states.at(-1)?.errorByKind.claude).toBe('Detection failed');
    expect(states.at(-1)?.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'claude',
        status: 'error',
        availability: expect.objectContaining({
          reason: 'Detection failed',
          sources: ['native-health'],
        }),
      }),
    ]));
    expect(sessionStorage.getItem('mindos:native-runtime-detection:v3:claude')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
