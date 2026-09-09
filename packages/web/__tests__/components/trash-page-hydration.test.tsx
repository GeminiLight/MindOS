// @vitest-environment jsdom
import React, { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrashPageClient from '@/components/TrashPageClient';
import { resetHydratedNowForTests } from '@/hooks/useHydratedNow';
import type { TrashMeta } from '@/lib/core/trash';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/actions', () => ({
  restoreFromTrashAction: vi.fn(),
  permanentlyDeleteAction: vi.fn(),
  emptyTrashAction: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/components/agents/AgentsPrimitives', () => ({
  ConfirmDialog: () => null,
}));

function items(now: number): TrashMeta[] {
  return [
    {
      id: 'trash-1',
      originalPath: 'Notes/draft.md',
      fileName: 'draft.md',
      isDirectory: false,
      deletedAt: new Date(now - 5 * 60_000).toISOString(),
      // ceil(2.04 days) = 3 → inside the "expiring" window.
      expiresAt: new Date(now + 2 * 86_400_000 + 3_600_000).toISOString(),
    },
  ];
}

describe('TrashPageClient hydration', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    resetHydratedNowForTests();
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
    resetHydratedNowForTests();
  });

  it('renders the same server HTML regardless of the server clock', () => {
    const base = new Date('2026-09-10T10:00:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(base);
    const first = renderToString(<TrashPageClient initialItems={items(base)} />);
    vi.setSystemTime(base + 2 * 86_400_000);
    const second = renderToString(<TrashPageClient initialItems={items(base)} />);
    expect(first).toBe(second);
    expect(first).not.toContain('Deleted ');
    expect(first).not.toContain('Expires in');
    // The expiry span must not be in its "expiring" state before the clock exists.
    expect(first).not.toContain('text-2xs text-error');
    expect(first).toContain('draft.md');
  });

  it('hydrates without a mismatch and then shows the deleted-ago and expiry labels', async () => {
    const now = Date.now();
    const errors: unknown[] = [];
    host.innerHTML = renderToString(<TrashPageClient initialItems={items(now)} />);
    await act(async () => {
      root = hydrateRoot(host, <TrashPageClient initialItems={items(now)} />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(host.textContent).toContain('Deleted 5m ago');
    expect(host.textContent).toContain('Expires in 3 days');
    expect(host.querySelector('span.text-2xs.text-error')).not.toBeNull();
  });
});
