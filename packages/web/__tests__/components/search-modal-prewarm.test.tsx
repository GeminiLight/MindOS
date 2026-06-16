// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SearchModal from '@/components/SearchModal';

const apiFetchMock = vi.fn();

function prewarmCallCount(): number {
  return apiFetchMock.mock.calls.filter((call) => call[0] === '/api/search/prewarm').length;
}

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

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      search: {
        placeholder: 'Search files...',
        noResults: 'No results found',
        noResultsHint: 'Try different keywords',
        preparing: 'Preparing search...',
        fallbackWarmHint: 'Search will prepare on first query.',
        prompt: 'Type to search',
        navigate: 'navigate',
        open: 'open',
        tabSearch: 'Search',
        tabActions: 'Actions',
        close: 'close',
        clear: 'Clear search',
        openSettings: 'Settings',
        restartWalkthrough: 'Restart',
        toggleDarkMode: 'Dark mode',
        goToAgents: 'Agents',
        goToDiscover: 'Discover',
        goToHelp: 'Help',
        walkthroughRestarted: 'Walkthrough restarted',
      },
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/wiki',
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SearchModal prewarm', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/search/prewarm') {
        return { warmed: true, cacheState: 'built', documentCount: 42 };
      }
      return [];
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(host);
    vi.useRealTimers();
  });

  it('prewarms search when the modal opens', async () => {
    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
    });

    expect(apiFetchMock).toHaveBeenCalledWith('/api/search/prewarm');
  });

  it('shows warming hint before prewarm resolves', async () => {
    let resolvePrewarm: ((value: unknown) => void) | null = null;
    apiFetchMock.mockImplementation((url: string) => {
      if (url === '/api/search/prewarm') {
        return new Promise((resolve) => {
          resolvePrewarm = resolve;
        });
      }
      return Promise.resolve([]);
    });

    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
    });

    expect(host.textContent).toContain('Preparing search...');

    await act(async () => {
      resolvePrewarm?.({ warmed: true, cacheState: 'built', documentCount: 42 });
    });
  });

  it('shows fallback hint when prewarm fails', async () => {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/search/prewarm') {
        throw new Error('prewarm failed');
      }
      return [];
    });

    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Search will prepare on first query.');
  });

  it('retries prewarm after files change and reopening', async () => {
    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
    });
    expect(prewarmCallCount()).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event('mindos:files-changed'));
    });

    // The files-changed listener coalesces bursts (~300ms) before resetting
    // the warm state — wait out the window before reopening.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    await act(async () => {
      root.render(<SearchModal open={false} onClose={() => {}} />);
    });

    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
    });

    expect(prewarmCallCount()).toBe(2);
  });

  it('aborts stale search requests and keeps the latest query results', async () => {
    vi.useFakeTimers();
    let firstSearchSignal: AbortSignal | undefined;
    let firstSearchResolve: ((value: Array<{ path: string; snippet: string; score: number }>) => void) | undefined;

    apiFetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/search/prewarm') {
        return Promise.resolve({ warmed: true, cacheState: 'built', documentCount: 42 });
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
      return Promise.resolve({ ok: true, surfaces: [] });
    });

    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
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
    expect(apiFetchMock).toHaveBeenCalledWith('/api/search?q=beta', expect.objectContaining({ cache: 'no-store' }));
  });

  it('aborts stale search requests when the clear button is clicked', async () => {
    vi.useFakeTimers();
    let firstSearchSignal: AbortSignal | undefined;
    let firstSearchResolve: ((value: Array<{ path: string; snippet: string; score: number }>) => void) | undefined;

    apiFetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/search/prewarm') {
        return Promise.resolve({ warmed: true, cacheState: 'built', documentCount: 42 });
      }
      if (url === '/api/search?q=alpha') {
        firstSearchSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Array<{ path: string; snippet: string; score: number }>>((resolve) => {
          firstSearchResolve = resolve;
        });
      }
      return Promise.resolve({ ok: true, surfaces: [] });
    });

    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
      await Promise.resolve();
    });

    const input = host.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'alpha');
    });
    await advance(300);
    expect(firstSearchSignal?.aborted).toBe(false);

    const clearButton = host.querySelector('button[aria-label="Clear search"]') as HTMLButtonElement;
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
