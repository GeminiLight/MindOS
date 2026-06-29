// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChangesContentPage from '@/components/changes/ChangesContentPage';

const apiFetchMock = vi.fn();
const buildLineDiffMock = vi.fn(() => [
  { type: 'delete', text: 'before' },
  { type: 'insert', text: 'after' },
]);

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/lib/stores/locale-store', async () => {
  const { en } = await import('@/lib/i18n/messages-en');
  return { useLocale: () => ({ t: en, locale: 'en' }) };
});

vi.mock('@/components/changes/line-diff', () => ({
  buildLineDiff: (...args: unknown[]) => buildLineDiffMock(...args),
  collapseDiffContext: (rows: unknown[]) => rows,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agentEvent = {
  id: 'agent-change-1',
  ts: '2026-06-22T00:01:00.000Z',
  op: 'update_lines',
  path: 'Research/notes.md',
  source: 'agent',
  agentName: 'codex',
  summary: 'Updated lines 1-2',
  before: 'before',
  after: 'after',
};

const facetsPayload = {
  spaces: [{ value: 'Research', count: 1 }],
  agents: [{ value: 'codex', count: 1 }],
  operations: [{ value: 'update_lines', count: 1 }],
  sources: [{ value: 'agent', count: 1 }],
};

describe('ChangesContentPage', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.clearAllMocks();
    buildLineDiffMock.mockClear();
    window.history.replaceState({}, '', '/changelog');
    root = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/changes?op=summary') {
        return { unreadCount: 1, totalCount: 1, lastSeenAt: '2026-06-22T00:00:00.000Z' };
      }
      if (url === '/api/changes?op=facets') {
        return facetsPayload;
      }
      if (url.startsWith('/api/changes?')) {
        return { events: [agentEvent] };
      }
      return {};
    });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  async function renderPage(element: React.ReactElement) {
    root = createRoot(host);
    await act(async () => {
      root!.render(element);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('opens agent review links directly in the Needs review view', async () => {
    await renderPage(<ChangesContentPage initialSource="agent" />);

    const listUrl = apiFetchMock.mock.calls
      .map(([url]) => String(url))
      .find(url => url.startsWith('/api/changes?op=list'));

    expect(listUrl).toContain('source=agent');
    expect(host.querySelector('[data-content-page-shell="changes"]')).not.toBeNull();
    expect(host.textContent).toContain('Needs review');
    expect(host.textContent).toContain('1 pending review');
    expect(host.textContent).toContain('Updated lines 1-2');
    expect(host.querySelector('[role="tab"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('keeps file links outside row toggle buttons and computes diff only after expansion', async () => {
    await renderPage(<ChangesContentPage initialSource="agent" />);

    expect(host.querySelector('button a')).toBeNull();
    expect(host.querySelector('a button')).toBeNull();
    expect(buildLineDiffMock).not.toHaveBeenCalled();

    const expandButton = host.querySelector<HTMLButtonElement>('button[aria-label="Expand change details"]');
    expect(expandButton).not.toBeNull();

    await act(async () => {
      expandButton!.click();
      await Promise.resolve();
    });

    expect(buildLineDiffMock).toHaveBeenCalledWith('before', 'after');
    expect(host.textContent).toContain('Diff preview');
    expect(host.querySelector<HTMLAnchorElement>('a[href="/view/Research/notes.md"]')).not.toBeNull();
  });

  it('disables the review action when no agent edits need review', async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/changes?op=summary') {
        return { unreadCount: 2, totalCount: 2, lastSeenAt: '2026-06-22T00:02:00.000Z' };
      }
      if (url === '/api/changes?op=facets') {
        return facetsPayload;
      }
      if (url.startsWith('/api/changes?')) {
        return { events: [agentEvent] };
      }
      return {};
    });

    await renderPage(<ChangesContentPage initialSource="agent" />);

    const reviewAction = host.querySelector<HTMLButtonElement>('button[title="Mark reviewed"]');
    expect(reviewAction).not.toBeNull();
    expect(reviewAction?.disabled).toBe(true);
    expect(host.textContent).toContain('All reviewed');
  });

  it('adds space and concrete agent filters to the changes request', async () => {
    await renderPage(<ChangesContentPage />);

    const clickButtonContaining = async (label: string) => {
      const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
        .find((node) => node.textContent?.includes(label));
      expect(button, `button containing "${label}"`).toBeTruthy();
      await act(async () => {
        button!.click();
        await Promise.resolve();
      });
    };

    await clickButtonContaining('All spaces');
    await clickButtonContaining('Research · 1');
    await clickButtonContaining('All agents');
    await clickButtonContaining('codex · 1');

    const listUrl = apiFetchMock.mock.calls
      .map(([url]) => String(url))
      .filter(url => url.startsWith('/api/changes?op=list'))
      .at(-1);
    expect(listUrl).toBeTruthy();

    const params = new URL(`http://localhost${listUrl}`).searchParams;
    expect(params.get('space')).toBe('Research');
    expect(params.get('agent')).toBe('codex');
    expect(params.get('source')).toBe('agent');

    const pageParams = new URLSearchParams(window.location.search);
    expect(pageParams.get('space')).toBe('Research');
    expect(pageParams.get('agent')).toBe('codex');
    expect(pageParams.get('source')).toBe('agent');
  });
});
