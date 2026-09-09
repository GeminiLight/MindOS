// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHydratedNowForTests, useHydratedNow } from '@/hooks/useHydratedNow';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const now = useHydratedNow();
  return <span data-now={now === null ? 'null' : String(now)}>{now === null ? 'pending' : 'ready'}</span>;
}

describe('useHydratedNow', () => {
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

  it('renders a stable null on the server no matter what the clock says', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'));
    const first = renderToString(<Probe />);
    vi.setSystemTime(new Date('2026-09-11T22:30:00Z'));
    const second = renderToString(<Probe />);
    expect(first).toBe(second);
    expect(first).toContain('data-now="null"');
    expect(first).toContain('pending');
  });

  it('hydrates without a mismatch and then exposes the client clock', async () => {
    const errors: unknown[] = [];
    host.innerHTML = renderToString(<Probe />);
    await act(async () => {
      root = hydrateRoot(host, <Probe />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    const span = host.querySelector('span')!;
    expect(span.textContent).toBe('ready');
    const value = Number(span.getAttribute('data-now'));
    expect(Math.abs(value - Date.now())).toBeLessThan(5_000);
  });

  it('gives a client-only render the clock immediately and ticks once a minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T10:00:00Z'));
    await act(async () => {
      root = createRoot(host);
      root.render(<Probe />);
    });
    const span = host.querySelector('span')!;
    expect(span.getAttribute('data-now')).toBe(String(new Date('2026-09-10T10:00:00Z').getTime()));

    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(span.getAttribute('data-now')).toBe(String(new Date('2026-09-10T10:00:00Z').getTime()));

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(span.getAttribute('data-now')).toBe(String(new Date('2026-09-10T10:01:00Z').getTime()));
  });

  it('stops ticking once the last subscriber unmounts', async () => {
    vi.useFakeTimers();
    await act(async () => {
      root = createRoot(host);
      root.render(<Probe />);
    });
    await act(async () => {
      root?.unmount();
    });
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
