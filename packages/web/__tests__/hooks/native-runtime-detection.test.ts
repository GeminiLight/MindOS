/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useNativeRuntimeDetection } from '@/hooks/useNativeRuntimeDetection';

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
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
});
