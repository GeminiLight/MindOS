// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAgentChangeReview } from '@/hooks/useAgentChangeReview';

const mockApiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ apiFetch: mockApiFetch }));
vi.mock('@/lib/use-visible-polling', () => ({ useVisiblePolling: () => {} }));
vi.mock('@/hooks/useFilesChanged', () => ({ useFilesChanged: () => {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const events = [
  { id: 'e1', ts: '2026-09-02T10:00:00.000Z', op: 'write', path: 'Notes/a.md', source: 'agent', summary: 'wrote a' },
  { id: 'e2', ts: '2026-09-02T10:01:00.000Z', op: 'write', path: 'Notes/b.md', source: 'agent', summary: 'wrote b' },
];

function respond(url: string) {
  if (url.includes('op=summary')) return Promise.resolve({ unreadCount: 2, totalCount: 2, lastSeenAt: null });
  return Promise.resolve({ events });
}

const seenPathSets: ReadonlySet<string>[] = [];
let refreshFn: (() => Promise<void>) | null = null;

function Probe() {
  const review = useAgentChangeReview({ limit: 50 });
  refreshFn = review.refresh;
  if (!review.loading) seenPathSets.push(review.unreviewedPaths);
  return <output>{review.unreviewedPathCount}</output>;
}

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('useAgentChangeReview', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(respond);
    seenPathSets.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('reuses the previous unreviewedPaths Set when a poll returns identical paths', async () => {
    await act(async () => { root.render(<Probe />); });
    await flush();
    expect(host.textContent).toBe('2');
    const first = seenPathSets.at(-1)!;
    expect([...first].sort()).toEqual(['Notes/a.md', 'Notes/b.md']);

    await act(async () => { await refreshFn!(); });
    await flush();
    const second = seenPathSets.at(-1)!;
    expect(second).toBe(first);
  });

  it('produces a new Set when the unreviewed paths actually change', async () => {
    await act(async () => { root.render(<Probe />); });
    await flush();
    const first = seenPathSets.at(-1)!;

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('op=summary')) return Promise.resolve({ unreadCount: 1, totalCount: 3, lastSeenAt: null });
      return Promise.resolve({ events: [events[0]] });
    });
    await act(async () => { await refreshFn!(); });
    await flush();
    const second = seenPathSets.at(-1)!;
    expect(second).not.toBe(first);
    expect([...second]).toEqual(['Notes/a.md']);
  });
});
