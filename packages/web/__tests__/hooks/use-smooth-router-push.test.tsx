// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldHandleSmoothNavigation, useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const rafCallbacks = new Map<number, FrameRequestCallback>();
let rafId = 0;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flushRaf() {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const callback of callbacks) callback(performance.now());
}

function Harness() {
  const smoothPush = useSmoothRouterPush();
  return (
    <div>
      <button type="button" onClick={() => smoothPush('/first')}>First</button>
      <button type="button" onClick={() => smoothPush('/second')}>Second</button>
    </div>
  );
}

describe('useSmoothRouterPush', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallbacks.clear();
    rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++rafId;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<Harness />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('lets the click frame paint before route work starts', () => {
    const first = host.querySelector('button')!;

    act(() => {
      first.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });

    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      flushRaf();
    });

    expect(mockPush).toHaveBeenCalledWith('/first');
  });

  it('coalesces rapid navigation requests to the latest target', () => {
    const [first, second] = [...host.querySelectorAll('button')];

    act(() => {
      first.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      second.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });

    act(() => {
      flushRaf();
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/second');
  });
});

describe('shouldHandleSmoothNavigation', () => {
  it('preserves modified clicks for native browser behavior', () => {
    expect(shouldHandleSmoothNavigation({
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    })).toBe(true);
    expect(shouldHandleSmoothNavigation({
      button: 0,
      defaultPrevented: false,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    })).toBe(false);
    expect(shouldHandleSmoothNavigation({
      button: 1,
      defaultPrevented: false,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
      shiftKey: false,
    })).toBe(false);
  });
});
