// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useVisiblePolling } from '@/lib/use-visible-polling';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function setDocumentVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

interface HarnessProps {
  callback: () => void;
  intervalMs: number;
  enabled?: boolean;
  immediate?: boolean;
}

function Harness({ callback, intervalMs, enabled, immediate }: HarnessProps) {
  useVisiblePolling(callback, intervalMs, {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(immediate !== undefined ? { immediate } : {}),
  });
  return null;
}

describe('useVisiblePolling', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    container.remove();
    vi.useRealTimers();
  });

  function mount(props: HarnessProps) {
    act(() => {
      root = createRoot(container);
      root.render(<Harness {...props} />);
    });
  }

  it('runs immediately and then on each interval while visible', () => {
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000 });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(3000); });
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it('pauses while the document is hidden', () => {
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000 });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => { setDocumentVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('resumes with a catch-up run when the document becomes visible again', () => {
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000 });
    act(() => { setDocumentVisibility('hidden'); });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => { setDocumentVisibility('visible'); });
    expect(callback).toHaveBeenCalledTimes(2); // catch-up tick
    act(() => { vi.advanceTimersByTime(2000); });
    expect(callback).toHaveBeenCalledTimes(4); // interval restarted
  });

  it('does nothing while disabled', () => {
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000, enabled: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).not.toHaveBeenCalled();
  });

  it('skips the immediate run when immediate is false but still polls', () => {
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000, immediate: false });
    expect(callback).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not start an interval when mounted hidden, then starts on visible', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000, immediate: false });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).not.toHaveBeenCalled();

    act(() => { setDocumentVisibility('visible'); });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('stops polling after unmount', () => {
    const callback = vi.fn();
    mount({ callback, intervalMs: 1000 });
    act(() => { root!.unmount(); });
    root = null;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(callback).toHaveBeenCalledTimes(1); // only the initial immediate run
  });

  it('always invokes the latest callback (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    mount({ callback: first, intervalMs: 1000 });
    act(() => {
      root!.render(<Harness callback={second} intervalMs={1000} />);
    });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
