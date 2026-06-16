// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  routerPush: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/view/current.md',
  useRouter: () => ({
    push: mocks.routerPush,
    refresh: mocks.routerRefresh,
  }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      sidebar: { searchTitle: 'Search' },
      search: {
        placeholder: 'Search files...',
        tabSearch: 'Search',
        clear: 'Clear',
        close: 'Close',
        emptyTitle: 'Search your knowledge base',
        emptyHint: 'Find notes, tables, and commands.',
        noResults: 'No results found',
        noResultsHint: 'Try another query.',
        navigate: 'navigate',
        open: 'open',
        dragToChat: 'to chat',
        preparing: 'Preparing search...',
        fallbackWarmHint: 'Search will prepare on first query.',
      },
    },
  }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ itemContent, totalCount }: { itemContent: (index: number) => React.ReactNode; totalCount: number }) => (
    <div data-testid="virtuoso">
      {Array.from({ length: totalCount }).map((_, index) => (
        <div key={index}>{itemContent(index)}</div>
      ))}
    </div>
  ),
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  nativeSetter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SearchPanel preview cache', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
    vi.useRealTimers();
  });

  it('aborts stale preview requests and reuses cached previews by path', async () => {
    let firstPreviewSignal: AbortSignal | undefined;
    let firstPreviewResolve: ((value: { content: string }) => void) | undefined;
    const fileCalls: string[] = [];

    mocks.apiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/search/prewarm') return Promise.resolve({ ok: true });
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return Promise.resolve({ ok: true, surfaces: [] });
      }
      if (url.startsWith('/api/search?q=')) {
        return Promise.resolve([
          { path: 'a.md', snippet: 'alpha note', score: 10 },
          { path: 'b.md', snippet: 'beta note', score: 8 },
        ]);
      }
      if (url.startsWith('/api/file?path=')) {
        fileCalls.push(url);
        const path = decodeURIComponent(url.split('path=')[1] ?? '');
        if (path === 'a.md' && fileCalls.length === 1) {
          firstPreviewSignal = init?.signal as AbortSignal | undefined;
          return new Promise<{ content: string }>((resolve) => {
            firstPreviewResolve = resolve;
          });
        }
        return Promise.resolve({ content: `${path} preview content` });
      }
      return Promise.resolve({});
    });

    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'note');
    });

    await advance(300);
    await advance(150);
    expect(fileCalls).toEqual(['/api/file?path=a.md']);
    expect(firstPreviewSignal?.aborted).toBe(false);

    const resultButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .filter((button) => button.textContent?.includes('.md'));

    await act(async () => {
      resultButtons()[1]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(firstPreviewSignal?.aborted).toBe(true);
    firstPreviewResolve?.({ content: 'stale a preview' });
    await advance(150);

    expect(fileCalls).toEqual(['/api/file?path=a.md', '/api/file?path=b.md']);
    expect(host.textContent).toContain('b.md preview content');

    await act(async () => {
      resultButtons()[0]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(150);

    expect(fileCalls).toEqual(['/api/file?path=a.md', '/api/file?path=b.md', '/api/file?path=a.md']);
    expect(host.textContent).toContain('a.md preview content');

    await act(async () => {
      resultButtons()[1]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await advance(150);

    expect(fileCalls).toEqual(['/api/file?path=a.md', '/api/file?path=b.md', '/api/file?path=a.md']);
    expect(host.textContent).toContain('b.md preview content');

    await act(async () => {
      window.dispatchEvent(new CustomEvent('mindos:files-changed', { detail: { paths: ['b.md'] } }));
      await Promise.resolve();
    });
    await advance(300);
    await advance(150);

    expect(fileCalls).toEqual([
      '/api/file?path=a.md',
      '/api/file?path=b.md',
      '/api/file?path=a.md',
      '/api/file?path=b.md',
    ]);
  });

  it('aborts stale search requests and keeps the latest query results', async () => {
    let firstSearchSignal: AbortSignal | undefined;
    let firstSearchResolve: ((value: Array<{ path: string; snippet: string; score: number }>) => void) | undefined;

    mocks.apiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/search/prewarm') return Promise.resolve({ ok: true });
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return Promise.resolve({ ok: true, surfaces: [] });
      }
      if (url === '/api/search?q=alpha') {
        firstSearchSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Array<{ path: string; snippet: string; score: number }>>((resolve) => {
          firstSearchResolve = resolve;
        });
      }
      if (url === '/api/search?q=beta') {
        return Promise.resolve([
          { path: 'beta.md', snippet: 'beta note', score: 10 },
        ]);
      }
      if (url.startsWith('/api/file?path=')) {
        return Promise.resolve({ content: 'preview' });
      }
      return Promise.resolve({});
    });

    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'alpha');
    });
    await advance(300);
    expect(firstSearchSignal?.aborted).toBe(false);

    await act(async () => {
      setInputValue(input, 'beta');
    });
    expect(firstSearchSignal?.aborted).toBe(true);
    await advance(300);

    await act(async () => {
      firstSearchResolve?.([{ path: 'alpha.md', snippet: 'alpha note', score: 10 }]);
      await Promise.resolve();
    });

    expect(host.textContent).toContain('beta.md');
    expect(host.textContent).not.toContain('alpha.md');
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/search?q=beta', expect.objectContaining({ cache: 'no-store' }));
  });

  it('aborts stale search requests when the clear button is clicked', async () => {
    let firstSearchSignal: AbortSignal | undefined;
    let firstSearchResolve: ((value: Array<{ path: string; snippet: string; score: number }>) => void) | undefined;

    mocks.apiFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/search/prewarm') return Promise.resolve({ ok: true });
      if (url === '/api/plugins/surfaces?loadEnabled=1&kind=command') {
        return Promise.resolve({ ok: true, surfaces: [] });
      }
      if (url === '/api/search?q=alpha') {
        firstSearchSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Array<{ path: string; snippet: string; score: number }>>((resolve) => {
          firstSearchResolve = resolve;
        });
      }
      return Promise.resolve({});
    });

    const { default: SearchPanel } = await import('@/components/panels/SearchPanel');

    await act(async () => {
      root.render(<SearchPanel active />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'alpha');
    });
    await advance(300);
    expect(firstSearchSignal?.aborted).toBe(false);

    const clearButton = host.querySelector('button[aria-label="Clear"]') as HTMLButtonElement;
    await act(async () => {
      clearButton.click();
      await Promise.resolve();
    });
    expect(firstSearchSignal?.aborted).toBe(true);

    await act(async () => {
      firstSearchResolve?.([{ path: 'alpha.md', snippet: 'alpha note', score: 10 }]);
      await Promise.resolve();
    });

    expect(input.value).toBe('');
    expect(host.textContent).not.toContain('alpha.md');
  });
});
