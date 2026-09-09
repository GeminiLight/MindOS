// @vitest-environment jsdom
import React, { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WikiHomeContent from '@/components/WikiHomeContent';
import { resetHydratedNowForTests } from '@/hooks/useHydratedNow';
import type { BuiltInMindSystemSpaceRecord } from '@/lib/space-records';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mindSystemSpaces: BuiltInMindSystemSpaceRecord[] = [];

function props(now: number) {
  return {
    spaces: [
      { name: 'Projects', path: 'Projects', fileCount: 3, description: 'Project notes' },
    ],
    recent: [
      { path: 'Projects/roadmap.md', mtime: now - 5 * 60_000 },
      { path: 'Inbox/older.md', mtime: now - 3 * 86_400_000 },
    ],
    mindSystemSpaces,
  };
}

describe('WikiHomeContent hydration', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    resetHydratedNowForTests();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ files: [] }) })));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = null;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetHydratedNowForTests();
  });

  it('renders the same server HTML regardless of the server clock', () => {
    const base = new Date('2026-09-10T10:00:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(base);
    const first = renderToString(<WikiHomeContent {...props(base)} />);
    // Same data, a different wall clock on the server (e.g. a later request or a skewed host).
    vi.setSystemTime(base + 47 * 60_000);
    const second = renderToString(<WikiHomeContent {...props(base)} />);
    expect(first).toBe(second);
    expect(first).not.toMatch(/\d+m ago|just now|\d+d ago/);
    // The Space card keeps its file count without a dangling separator.
    expect(first).toContain('3 files');
    expect(first).not.toContain('3 files · ');
  });

  it('hydrates the server HTML without a mismatch and then shows relative times', async () => {
    const now = Date.now();
    const errors: unknown[] = [];
    host.innerHTML = renderToString(<WikiHomeContent {...props(now)} />);
    await act(async () => {
      root = hydrateRoot(host, <WikiHomeContent {...props(now)} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(host.textContent).toContain('5m ago');
    expect(host.textContent).toContain('3d ago');
    expect(host.textContent).toContain('3 files · 5m ago');
  });
});
