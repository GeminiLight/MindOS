// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SearchModal from '@/components/SearchModal';

const apiFetchMock = vi.fn();

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
  useRouter: () => ({
    push: vi.fn(),
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
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('mindos:files-changed'));
    });

    await act(async () => {
      root.render(<SearchModal open={false} onClose={() => {}} />);
    });

    await act(async () => {
      root.render(<SearchModal open={true} onClose={() => {}} />);
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});
