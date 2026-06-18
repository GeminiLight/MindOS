// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeftPanelState } from '@/hooks/useLeftPanel';

vi.mock('@/components/Panel', () => ({
  MIN_PANEL_WIDTH: 200,
  MAX_PANEL_WIDTH_ABS: 480,
}));

vi.mock('@/components/ActivityBar', () => ({
  RAIL_WIDTH_COLLAPSED: 48,
  RAIL_WIDTH_EXPANDED: 180,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Controllable requestAnimationFrame ──────────────────────────────────────

type RafCb = FrameRequestCallback | null;
let rafQueue: RafCb[] = [];
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;

function installRaf() {
  rafQueue = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    if (id >= 1 && id <= rafQueue.length) rafQueue[id - 1] = null;
  }) as typeof cancelAnimationFrame;
}

function restoreRaf() {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
}

async function flushRaf() {
  await act(async () => {
    const cbs = rafQueue;
    rafQueue = [];
    for (const cb of cbs) cb?.(performance.now());
  });
}

// ─── Probe component ─────────────────────────────────────────────────────────

let latest: LeftPanelState | null = null;
let renderCount = 0;

describe('useLeftPanel drag width updates', () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(async () => {
    installRaf();
    localStorage.clear();
    latest = null;
    renderCount = 0;

    const { useLeftPanel } = await import('@/hooks/useLeftPanel');
    function Probe() {
      latest = useLeftPanel();
      renderCount += 1;
      return null;
    }

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Probe />); });
  });

  afterEach(async () => {
    if (root) { const r = root; root = null; await act(async () => { r.unmount(); }); }
    host.remove();
    restoreRaf();
  });

  it('coalesces per-pixel drag updates into one state commit per animation frame', async () => {
    const rendersBefore = renderCount;

    await act(async () => {
      latest!.handlePanelWidthChange(301);
      latest!.handlePanelWidthChange(302);
      latest!.handlePanelWidthChange(303);
      latest!.handlePanelWidthChange(304);
      latest!.handlePanelWidthChange(305);
    });
    // No state update until the next animation frame
    expect(latest!.panelWidth).toBeNull();
    expect(renderCount).toBe(rendersBefore);

    await flushRaf();
    expect(latest!.panelWidth).toBe(305); // latest value wins
    expect(renderCount).toBe(rendersBefore + 1); // a single re-render for the burst
  });

  it('commits the final width immediately at drag end and persists it', async () => {
    await act(async () => {
      latest!.handlePanelWidthChange(310);
      latest!.handlePanelWidthCommit(312);
    });
    expect(latest!.panelWidth).toBe(312);
    expect(localStorage.getItem('left-panel-width')).toBe('312');

    // A stale pending frame from the drag must not overwrite the committed width
    await flushRaf();
    expect(latest!.panelWidth).toBe(312);
  });

  it('persists the left sidebar expanded preference independently from the active panel', async () => {
    expect(latest!.activePanel).toBe('files');
    expect(latest!.sidebarExpanded).toBe(true);

    await act(async () => {
      latest!.handleSidebarExpandedChange(false);
    });
    expect(latest!.activePanel).toBe('files');
    expect(latest!.sidebarExpanded).toBe(false);
    expect(localStorage.getItem('mindos.sidebar.expanded')).toBe('false');

    await act(async () => {
      latest!.setActivePanel('agents');
    });
    expect(latest!.activePanel).toBe('agents');
    expect(latest!.sidebarExpanded).toBe(false);

    await act(async () => {
      latest!.handleSidebarExpandedChange(true);
    });
    expect(latest!.sidebarExpanded).toBe(true);
    expect(localStorage.getItem('mindos.sidebar.expanded')).toBe('true');
  });

  it('restores the persisted left sidebar collapsed preference on mount', async () => {
    if (root) {
      const r = root;
      root = null;
      await act(async () => { r.unmount(); });
    }
    host.remove();
    localStorage.setItem('mindos.sidebar.expanded', 'false');

    const { useLeftPanel } = await import('@/hooks/useLeftPanel');
    function Probe() {
      latest = useLeftPanel('files');
      renderCount += 1;
      return null;
    }

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Probe />); });

    expect(latest!.activePanel).toBe('files');
    expect(latest!.sidebarExpanded).toBe(false);
  });

  it('keeps applying frames across a long drag', async () => {
    await act(async () => { latest!.handlePanelWidthChange(320); });
    await flushRaf();
    expect(latest!.panelWidth).toBe(320);

    await act(async () => { latest!.handlePanelWidthChange(340); });
    await flushRaf();
    expect(latest!.panelWidth).toBe(340);
  });
});
