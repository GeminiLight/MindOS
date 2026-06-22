// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileNode } from '@/lib/types';
import { ASK_ADD_CONTEXT_EVENT } from '@/lib/ask-context-events';
import { useAskPanel } from '@/hooks/useAskPanel';

const nav = vi.hoisted(() => ({ pathname: '/view/Research/notes.md' }));
const mockPush = vi.fn();
const mockTogglePin = vi.fn();
const mockToastSuccess = vi.fn();
const apiFetchMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@/lib/actions', () => ({
  createFileAction: vi.fn(),
  deleteFileAction: vi.fn(),
  renameFileAction: vi.fn(),
  renameSpaceAction: vi.fn(),
  deleteSpaceAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  undoDeleteAction: vi.fn(),
  convertToSpaceAction: vi.fn(),
}));

vi.mock('@/lib/space-ai-init', () => ({
  checkAiAvailable: vi.fn(),
  triggerSpaceAiInit: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    undo: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/agents/AgentsPrimitives', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/lib/hooks/usePinnedFiles', () => ({
  usePinnedFiles: () => ({ isPinned: () => false, togglePin: mockTogglePin }),
}));

vi.mock('@/lib/stores/hidden-files', () => ({
  useShowHiddenFiles: () => false,
  setShowHiddenFiles: vi.fn(),
  filterHiddenNodes: (nodes: FileNode[]) => nodes,
}));

vi.mock('@/lib/hooks/useDirectoryDragDrop', () => ({
  useDirectoryDragDrop: () => ({
    isDragTarget: false,
    handleRowDragOver: () => {},
    handleRowDragEnter: () => {},
    handleRowDragLeave: () => {},
    handleRowDrop: () => {},
  }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      fileTree: {
        newFile: 'New File',
        viewRules: 'View Rules',
        importFile: 'Import File',
        addAsContext: 'Add as Context',
        addedAsContext: 'Added to context',
        removeFromFavorites: 'Remove from Favorites',
        pinToFavorites: 'Pin to Favorites',
        convertToSpace: 'Convert to Space',
        convertToSpaceAiRequired: 'Configure AI before converting this folder into a Space.',
        copyPath: 'Copy Path',
        rename: 'Rename',
        renameSpace: 'Rename Space',
        delete: 'Delete',
        deleteFolder: 'Delete Folder',
        deleteSpace: 'Delete Space',
        enterFileName: 'Enter a file name',
        create: 'Create',
        failed: 'Failed',
        confirmDelete: (n: string) => `Delete ${n}?`,
        confirmDeleteFolder: (n: string) => `Delete folder ${n}?`,
        confirmDeleteSpace: (n: string) => `Delete space ${n}?`,
      },
      view: { cancel: 'Cancel' },
      trash: { movedToTrash: 'Deleted', undo: 'Undo' },
    },
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buttonLabels(root: ParentNode = document.body): string[] {
  return [...root.querySelectorAll('button')]
    .map(button => button.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean);
}

function captureNextContextEvent() {
  let detail: unknown = null;
  const handler = (event: Event) => {
    detail = (event as CustomEvent).detail;
  };
  window.addEventListener(ASK_ADD_CONTEXT_EVENT, handler, { once: true });
  return () => detail;
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

describe('File tree Add as Context menu actions', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    nav.pathname = '/view/Research/notes.md';
    localStorage.clear();
    apiFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/changes?op=summary') {
        return { unreadCount: 1, totalCount: 1, lastSeenAt: '2026-06-22T00:00:00.000Z' };
      }
      if (url.startsWith('/api/changes?') && url.includes('source=agent')) {
        return {
          events: [{
            id: 'agent-1',
            ts: '2026-06-22T00:01:00.000Z',
            op: 'update_lines',
            path: 'Research/notes.md',
            source: 'agent',
            summary: 'Updated lines 1-2',
          }],
        };
      }
      return {};
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('places Add as Context first in file menus and dispatches a file context event', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    const nodes: FileNode[] = [{ type: 'file', name: 'notes.md', path: 'Research/notes.md', extension: '.md' }];

    await act(async () => {
      root.render(<FileTree nodes={nodes} />);
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="More"]')?.click();
    });

    expect(buttonLabels()[1]).toBe('Add as Context');

    const getDetail = captureNextContextEvent();
    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find(button => button.textContent?.includes('Add as Context'))
        ?.click();
    });

    expect(getDetail()).toEqual({ path: 'Research/notes.md', type: 'file', label: 'notes.md' });
    expect(mockToastSuccess).toHaveBeenCalledWith('Added to context', 1600);
  });

  it('marks files with pending agent changes and opens scoped review from the menu', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    const nodes: FileNode[] = [{ type: 'file', name: 'notes.md', path: 'Research/notes.md', extension: '.md' }];

    await act(async () => {
      root.render(<FileTree nodes={nodes} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-agent-review-dot]')).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="More"]')?.click();
    });

    const reviewButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Review changes'));
    expect(reviewButton).toBeTruthy();

    await act(async () => {
      reviewButton?.click();
    });
    await act(async () => {
      await waitForAnimationFrame();
    });

    expect(mockPush).toHaveBeenCalledWith('/changelog?source=agent&path=Research%2Fnotes.md');
  });

  it('places Add as Context before favorites in folder and space menus', async () => {
    const { FolderContextMenu, SpaceContextMenu } = await import('@/components/file-tree/FileTreeContextMenus');
    const folder: FileNode = { type: 'directory', name: 'Research', path: 'Research', children: [] };
    const space: FileNode = { ...folder, isSpace: true };

    await act(async () => {
      root.render(
        <>
          <FolderContextMenu
            x={20}
            y={20}
            node={folder}
            onClose={vi.fn()}
            onRename={vi.fn()}
            onNewFile={vi.fn()}
            onDelete={vi.fn()}
          />
          <SpaceContextMenu
            x={260}
            y={20}
            node={space}
            onClose={vi.fn()}
            onRename={vi.fn()}
            onNewFile={vi.fn()}
            onImport={vi.fn()}
            onDelete={vi.fn()}
          />
        </>,
      );
    });

    const labels = buttonLabels();
    expect(labels.slice(0, 4)).toEqual(['New File', 'Add as Context', 'Pin to Favorites', 'Convert to Space']);
    expect(labels.slice(7, 12)).toEqual(['New File', 'View Rules', 'Import File', 'Add as Context', 'Pin to Favorites']);
  });

  it('lets the mounted ask panel state receive file tree context requests', async () => {
    function Probe() {
      const state = useAskPanel();
      return (
        <div
          data-open={state.askPanelOpen ? 'true' : 'false'}
          data-path={state.askContextRequest?.path ?? ''}
          data-type={state.askContextRequest?.type ?? ''}
        />
      );
    }

    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(ASK_ADD_CONTEXT_EVENT, {
        detail: { path: 'Research', type: 'directory', label: 'Research' },
      }));
    });

    const probe = host.querySelector('div');
    expect(probe?.dataset.open).toBe('true');
    expect(probe?.dataset.path).toBe('Research/');
    expect(probe?.dataset.type).toBe('directory');
  });
});
