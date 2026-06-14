// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Backlinks from '@/components/Backlinks';
import { clearBacklinksCacheForTests } from '@/lib/backlinks-client';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: mocks.apiFetch,
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      common: {
        relatedFiles: 'Related Files',
      },
    },
  }),
}));

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
  observe = vi.fn();
  disconnect = vi.fn();
  trigger(isIntersecting = true): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Backlinks lazy loading and cache', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearBacklinksCacheForTests();
    MockIntersectionObserver.instances = [];
    (globalThis as { IntersectionObserver?: typeof MockIntersectionObserver }).IntersectionObserver = MockIntersectionObserver;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it('defers the backlinks request until the section approaches the viewport', async () => {
    mocks.apiFetch.mockResolvedValueOnce([
      { filePath: 'source.md', snippets: ['See [[target]].'] },
    ]);

    await act(async () => {
      root.render(<Backlinks filePath="target.md" />);
      await flushPromises();
    });

    expect(host.querySelector('[data-backlinks-deferred]')).not.toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();

    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true);
      await flushPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/backlinks?path=target.md');
    expect(host.textContent).toContain('Related Files');
    expect(host.textContent).toContain('source.md');
  });

  it('reuses a cached backlinks response for the same path', async () => {
    mocks.apiFetch.mockResolvedValueOnce([
      { filePath: 'source.md', snippets: ['See [[target]].'] },
    ]);

    await act(async () => {
      root.render(<Backlinks filePath="target.md" />);
      await flushPromises();
    });
    await act(async () => {
      MockIntersectionObserver.instances[0]?.trigger(true);
      await flushPromises();
    });

    await act(async () => {
      root.render(<Backlinks filePath="other.md" />);
      await flushPromises();
    });
    await act(async () => {
      root.render(<Backlinks filePath="target.md" />);
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('source.md');
  });
});
