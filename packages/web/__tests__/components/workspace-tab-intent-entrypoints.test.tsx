// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import FileTree from '@/components/FileTree';
import Panel from '@/components/Panel';
import { getTabs, initWorkspaceTabs, resetWorkspaceTabsForTests } from '@/lib/workspace-tabs';

const h = vi.hoisted(() => ({
  pathname: { current: '/' },
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => h.pathname.current,
  useRouter: () => ({
    push: h.push,
    replace: vi.fn(),
    refresh: h.refresh,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@/lib/actions', () => ({
  createFileAction: vi.fn(),
  deleteFileAction: vi.fn(),
  renameFileAction: vi.fn(),
  renameSpaceAction: vi.fn(),
  deleteSpaceAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  undoDeleteAction: vi.fn(),
  listTrashAction: vi.fn(async () => []),
}));

vi.mock('@/lib/inbox-client', () => ({
  fetchInboxFiles: vi.fn(async () => []),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function doubleClick(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  h.pathname.current = '/';
  h.push.mockClear();
  h.refresh.mockClear();
  resetWorkspaceTabsForTests();
  initWorkspaceTabs('default');
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  resetWorkspaceTabsForTests();
  vi.clearAllMocks();
});

describe('workspace tab work-intent entrypoints', () => {
  it('keeps a file tab when a file tree item is double-clicked', () => {
    render(
      <FileTree
        nodes={[
          { type: 'file', name: 'note.md', path: 'Notes/note.md', extension: '.md' } as never,
        ]}
      />,
    );

    const fileButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('note.md'));
    expect(fileButton).toBeTruthy();

    doubleClick(fileButton!);

    expect(getTabs()).toEqual([
      { id: 'doc:Notes/note.md', kind: 'doc', key: 'Notes/note.md', title: 'note.md' },
    ]);
    expect(h.push).toHaveBeenCalledWith('/view/Notes/note.md');
  });

  it('keeps the Untitled tab when creating a new file from the files panel', async () => {
    render(
      <Panel
        activePanel="files"
        fileTree={[]}
        mindSystemSlots={[]}
        onOpenSyncSettings={vi.fn()}
      />,
    );

    const newButton = document.querySelector<HTMLButtonElement>('button[aria-label="New"]');
    expect(newButton).toBeTruthy();
    await click(newButton!);

    const newFileButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.toLowerCase().includes('file'));
    expect(newFileButton).toBeTruthy();
    await click(newFileButton!);

    expect(getTabs()).toEqual([
      { id: 'doc:Untitled.md', kind: 'doc', key: 'Untitled.md', title: 'Untitled.md' },
    ]);
    expect(h.push).toHaveBeenCalledWith('/view/Untitled.md');
  });
});
