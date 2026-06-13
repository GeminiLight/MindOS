// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Panel from '@/components/Panel';

const listTrashAction = vi.fn(async () => [] as unknown[]);
const fetchInboxFiles = vi.fn(async () => [] as unknown[]);

vi.mock('next/navigation', () => ({
  usePathname: () => '/wiki',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/actions', () => ({
  listTrashAction: (...args: unknown[]) => listTrashAction(...args as []),
}));

vi.mock('@/lib/inbox-client', () => ({
  fetchInboxFiles: (...args: unknown[]) => fetchInboxFiles(...args as [string]),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

async function renderPanel() {
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
      />,
    );
  });
}

async function dispatch(detail?: { paths?: string[] }) {
  await act(async () => {
    if (detail === undefined) {
      window.dispatchEvent(new Event('mindos:files-changed'));
    } else {
      window.dispatchEvent(new CustomEvent('mindos:files-changed', { detail }));
    }
  });
}

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

describe('Panel mindos:files-changed listener contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listTrashAction.mockClear();
    fetchInboxFiles.mockClear();
  });

  afterEach(async () => {
    if (root) { const r = root; root = null; await act(async () => { r.unmount(); }); }
    host?.remove();
    vi.useRealTimers();
  });

  it('coalesces a burst of files-changed events into a single trash refetch', async () => {
    await renderPanel();
    expect(listTrashAction).toHaveBeenCalledTimes(1); // initial mount fetch

    await dispatch();
    await dispatch();
    await dispatch();
    // Debounced: no refetch yet
    expect(listTrashAction).toHaveBeenCalledTimes(1);

    await advance(300);
    expect(listTrashAction).toHaveBeenCalledTimes(2); // exactly one coalesced refetch
  });

  it('refetches when an event has no detail (anything may have changed)', async () => {
    await renderPanel();
    await dispatch();
    await advance(300);
    expect(listTrashAction).toHaveBeenCalledTimes(2);
  });

  it('skips the refetch when every changed path is irrelevant to the trash count', async () => {
    await renderPanel();
    await dispatch({ paths: ['.mindos/change-log.json', '.mindos/agents/session.json'] });
    await advance(500);
    expect(listTrashAction).toHaveBeenCalledTimes(1); // only the mount fetch
  });

  it('refetches when content paths changed (a content change may be a deletion)', async () => {
    await renderPanel();
    await dispatch({ paths: ['SpaceA/note.md'] });
    await advance(300);
    expect(listTrashAction).toHaveBeenCalledTimes(2);
  });

  it('refetches when trash paths changed', async () => {
    await renderPanel();
    await dispatch({ paths: ['.trash/note.md'] });
    await advance(300);
    expect(listTrashAction).toHaveBeenCalledTimes(2);
  });

  it('refetches once when irrelevant and relevant events land in the same window', async () => {
    await renderPanel();
    await dispatch({ paths: ['.mindos/change-log.json'] });
    await dispatch({ paths: ['SpaceA/note.md'] });
    await dispatch();
    await advance(300);
    expect(listTrashAction).toHaveBeenCalledTimes(2);
  });

  it('stops listening after unmount', async () => {
    await renderPanel();
    const r = root!;
    root = null;
    await act(async () => { r.unmount(); });
    await dispatch();
    await advance(500);
    expect(listTrashAction).toHaveBeenCalledTimes(1);
  });
});
