// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AgentsPanelSessionsTab from '@/components/agents/AgentsPanelSessionsTab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sessions = [
  { id: 's1', agentId: 'claude', state: 'active', cwd: '/tmp/a', createdAt: '2026-09-01T00:00:00Z', lastActivityAt: '2026-09-01T00:01:00Z' },
  { id: 's2', agentId: 'codex', state: 'idle', cwd: '/tmp/b', createdAt: '2026-09-01T00:00:00Z', lastActivityAt: '2026-09-01T00:02:00Z' },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('AgentsPanelSessionsTab', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the row and surfaces an error when closing a session returns a non-2xx status', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
      return { ok: true, status: 200, json: async () => ({ sessions }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => { root.render(<AgentsPanelSessionsTab />); });
    await flush();
    expect(host.textContent).toContain('Active Sessions (2)');

    const closeButton = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('title') === 'Close session' || button.textContent?.includes('Close'))!;
    expect(closeButton).toBeTruthy();
    await act(async () => { closeButton.click(); });
    await flush();

    expect(host.textContent).toContain('Active Sessions (2)');
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/close session/i);
  });

  it('does not swap the list for a skeleton while refetching with existing sessions', async () => {
    const pending = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, json: async () => ({ sessions }) };
      return pending.promise;
    }));

    await act(async () => { root.render(<AgentsPanelSessionsTab />); });
    await flush();
    expect(host.textContent).toContain('Active Sessions (2)');

    const refresh = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Refresh')!;
    await act(async () => { refresh.click(); });

    expect(host.textContent).toContain('Active Sessions (2)');
    expect(host.querySelector('.animate-pulse')).toBeNull();

    pending.resolve({ ok: true, status: 200, json: async () => ({ sessions }) });
    await flush();
  });
});
