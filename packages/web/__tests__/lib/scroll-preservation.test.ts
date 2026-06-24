// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshPreservingDocumentScroll } from '@/lib/scroll-preservation';

describe('refreshPreservingDocumentScroll', () => {
  let scrollX = 0;
  let scrollY = 0;
  let originalScrollTo: typeof window.scrollTo;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollX = 0;
    scrollY = 0;
    originalScrollTo = window.scrollTo;
    originalRequestAnimationFrame = window.requestAnimationFrame;

    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      get: () => scrollX,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    });
    window.scrollTo = vi.fn((x: number | ScrollToOptions, y?: number) => {
      if (typeof x === 'object') {
        scrollX = x.left ?? scrollX;
        scrollY = x.top ?? scrollY;
        return;
      }
      scrollX = x;
      scrollY = y ?? scrollY;
    }) as typeof window.scrollTo;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      window.setTimeout(() => callback(performance.now()), 0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    vi.useRealTimers();
  });

  it('restores the document scroll after a same-route refresh resets it', async () => {
    scrollY = 720;

    refreshPreservingDocumentScroll(() => {
      scrollY = 0;
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 720);
    expect(scrollY).toBe(720);
  });

  it('does not restore scroll after navigation changes the href', async () => {
    scrollY = 480;

    refreshPreservingDocumentScroll(() => {
      scrollY = 0;
      window.history.pushState({}, '', '/view/other.md');
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(scrollY).toBe(0);
  });
});
