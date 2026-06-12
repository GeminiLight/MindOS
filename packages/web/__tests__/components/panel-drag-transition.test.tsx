// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Panel from '@/components/Panel';

vi.mock('next/navigation', () => ({
  usePathname: () => '/wiki',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/actions', () => ({
  listTrashAction: vi.fn(async () => []),
}));

vi.mock('@/lib/inbox-client', () => ({
  fetchInboxFiles: vi.fn(async () => []),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TRANSITION_CLASS = 'transition-[transform,left,width]';

describe('Panel resize drag transition', () => {
  let host: HTMLDivElement;
  let root: Root | null = null;
  const onWidthChange = vi.fn();
  const onWidthCommit = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Panel
          activePanel="files"
          fileTree={[]}
          mindSystemSlots={[]}
          onOpenSyncSettings={() => {}}
          panelWidth={300}
          onWidthChange={onWidthChange}
          onWidthCommit={onWidthCommit}
        />,
      );
    });
  });

  afterEach(async () => {
    // Finish any in-flight drag so document-level listeners from one test
    // cannot leak into the next.
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    if (root) { const r = root; root = null; await act(async () => { r.unmount(); }); }
    host.remove();
  });

  function aside(): HTMLElement {
    const el = host.querySelector('aside');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  function handle(): HTMLElement {
    const el = host.querySelector('.cursor-col-resize');
    expect(el).toBeTruthy();
    return el as HTMLElement;
  }

  it('animates width changes while not dragging', () => {
    expect(aside().className).toContain(TRANSITION_CLASS);
  });

  it('disables the width transition during drag so the panel tracks the cursor', async () => {
    await act(async () => {
      handle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 348 }));
    });
    expect(aside().className).not.toContain(TRANSITION_CLASS);
  });

  it('reports live widths during drag and restores the transition after mouseup', async () => {
    await act(async () => {
      handle().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 348 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 368 }));
    });
    expect(onWidthChange).toHaveBeenCalledWith(320);

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(onWidthCommit).toHaveBeenCalledTimes(1);
    expect(aside().className).toContain(TRANSITION_CLASS);
  });
});
