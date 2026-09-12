// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchModal from '@/components/SearchModal';
import SearchPanel from '@/components/panels/SearchPanel';

const mocks = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: mocks.api }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/wiki',
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));
vi.mock('@/lib/stores/locale-store', async () => {
  const { en } = await import('@/lib/i18n/messages-en');
  return { useLocale: () => ({ locale: 'en', t: en }) };
});
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ totalCount, itemContent }: { totalCount: number; itemContent: (i: number) => React.ReactNode }) => (
    <>{Array.from({ length: totalCount }, (_, i) => <div key={i}>{itemContent(i)}</div>)}</>
  ),
}));

describe.each(['modal', 'panel'] as const)('%s search recovery', (surface) => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let search: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    search = vi.fn().mockResolvedValue([]);
    mocks.api.mockReset().mockImplementation((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/search?q=')) return search(url, options);
      if (url === '/api/search/prewarm') return Promise.resolve({ warmed: true });
      return Promise.resolve({ surfaces: [], projections: [], content: '' });
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(surface === 'modal'
      ? <SearchModal open onClose={() => {}} />
      : <SearchPanel active />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function query(value: string) {
    const input = host.querySelector('input[type="text"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    return input;
  }

  it('distinguishes a failed request from no matches and retries the same query', async () => {
    search.mockRejectedValueOnce(new Error('service unavailable')).mockResolvedValueOnce([
      { path: 'Recovered.md', snippet: 'Recovered note', score: 1 },
    ]);
    const input = await query('体验');
    expect(host.textContent).toContain('Search failed');
    expect(host.textContent).not.toContain('No matching files');
    expect((input as HTMLInputElement).value).toBe('体验');
    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Try again');
    expect(retry).toBeDefined();
    retry!.focus();
    await act(async () => retry!.click());
    expect(document.activeElement).toBe(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(search.mock.calls[1][0]).toBe(search.mock.calls[0][0]);
    expect(host.textContent).toContain('Recovered.md');
    expect(host.textContent).not.toContain('Search failed');
  });

  it('keeps failed modal keyboard focus inside the dialog', async () => {
    if (surface !== 'modal') return;
    search.mockRejectedValue(new Error('offline'));
    await query('missing');
    const dialog = host.querySelector('[role=dialog]')!;
    const buttons = dialog.querySelectorAll<HTMLElement>('button, input, [href]');
    const last = buttons[buttons.length - 1];
    last.focus();
    await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('shows no matches only after a successful empty response', async () => {
    await query('missing');
    expect(host.textContent).toContain('No matching files');
    expect(host.textContent).not.toContain('Search failed');
  });

  it('clears failure when the query is cleared without issuing an empty search', async () => {
    search.mockRejectedValue(new Error('offline'));
    await query('missing');
    expect(host.textContent).toContain('Search failed');
    await query('');
    expect(host.textContent).not.toContain('Search failed');
    expect(host.textContent).not.toContain('No matching files');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('ignores an obsolete failure after a newer query succeeds', async () => {
    let rejectOld!: (error: Error) => void;
    search.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce([{ path: 'Latest.md', snippet: 'Current result', score: 1 }]);
    await query('old');
    await query('new');
    await act(async () => rejectOld(new Error('late failure')));
    expect(host.textContent).toContain('Latest.md');
    expect(host.textContent).not.toContain('Search failed');
  });
});
