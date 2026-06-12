// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileNode } from '@/lib/types';

// ─── Mutable navigation state ────────────────────────────────────────────────

const nav = vi.hoisted(() => ({ pathname: '/' }));
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// ─── Icon render counters (probe for row re-renders) ────────────────────────
// Each row component renders exactly one type icon per render: file rows render
// FileText (.md), directory space rows render Layers. Counting icon function
// invocations therefore counts row renders.

const iconCounts = vi.hoisted(() => ({ map: new Map<string, number>() }));

vi.mock('lucide-react', () => {
  const make = (name: string) =>
    function Icon() {
      iconCounts.map.set(name, (iconCounts.map.get(name) ?? 0) + 1);
      return <svg data-icon={name} />;
    };
  const names = [
    'ChevronDown', 'FileText', 'Table', 'Folder', 'FolderOpen', 'Plus', 'Loader2',
    'Trash2', 'Pencil', 'Layers', 'Copy', 'MoreHorizontal', 'Star', 'Inbox',
  ];
  return Object.fromEntries(names.map(n => [n, make(n)]));
});

vi.mock('@/lib/actions', () => ({
  createFileAction: vi.fn(),
  deleteFileAction: vi.fn(),
  renameFileAction: vi.fn(),
  renameSpaceAction: vi.fn(),
  deleteSpaceAction: vi.fn(),
  deleteFolderAction: vi.fn(),
  undoDeleteAction: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  toast: { undo: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/agents/AgentsPrimitives', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/lib/hooks/usePinnedFiles', () => ({
  usePinnedFiles: () => ({ isPinned: () => false, togglePin: vi.fn() }),
}));

vi.mock('@/lib/stores/hidden-files', () => ({
  useShowHiddenFiles: () => false,
  setShowHiddenFiles: vi.fn(),
  filterHiddenNodes: (nodes: FileNode[]) => nodes,
}));

vi.mock('@/components/file-tree/FileTreeContextMenus', () => ({
  ContextMenuShell: () => null,
  SpaceContextMenu: () => null,
  FolderContextMenu: () => null,
  MENU_ITEM: '',
  MENU_DANGER: '',
  MENU_DIVIDER: '',
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
        enterFileName: 'Enter a file name',
        failed: 'Failed',
        create: 'Create',
        delete: 'Delete',
        deleteSpace: 'Delete Space',
        deleteFolder: 'Delete Folder',
        confirmDelete: (n: string) => `Delete ${n}?`,
        confirmDeleteSpace: (n: string) => `Delete space ${n}?`,
        confirmDeleteFolder: (n: string) => `Delete folder ${n}?`,
        copyPath: 'Copy Path',
        rename: 'Rename',
        pinToFavorites: 'Pin to Favorites',
        removeFromFavorites: 'Remove from Favorites',
      },
      view: { cancel: 'Cancel' },
      trash: { movedToTrash: 'Deleted', undo: 'Undo' },
    },
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FILE_COUNT = 30;

function buildSpaceTree(): FileNode[] {
  const files: FileNode[] = Array.from({ length: FILE_COUNT }, (_, i) => ({
    type: 'file',
    name: `f${i}.md`,
    path: `S/f${i}.md`,
    extension: '.md',
  }));
  return [{ type: 'directory', name: 'S', path: 'S', isSpace: true, children: files }];
}

function count(name: string): number {
  return iconCounts.map.get(name) ?? 0;
}

let host: HTMLDivElement;
let root: Root | null = null;

async function render(ui: React.ReactElement) {
  if (!root) root = createRoot(host);
  await act(async () => { root!.render(ui); });
}

describe('FileTree navigation re-render scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    iconCounts.map.clear();
    nav.pathname = '/view/S/f0.md';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(async () => {
    if (root) { const r = root; root = null; await act(async () => { r.unmount(); }); }
    host.remove();
  });

  it('re-renders only the previously active and newly active file rows on navigation', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    const tree = buildSpaceTree();

    await render(<FileTree nodes={tree} />);
    expect(count('FileText')).toBe(FILE_COUNT); // initial mount renders every row

    const before = count('FileText');
    nav.pathname = '/view/S/f1.md';
    await render(<FileTree nodes={tree} />);

    // Only f0 (deactivated) and f1 (activated) rows may re-render.
    expect(count('FileText') - before).toBe(2);
  });

  it('moves the active row highlight to the newly selected file', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    const tree = buildSpaceTree();

    await render(<FileTree nodes={tree} />);
    nav.pathname = '/view/S/f1.md';
    await render(<FileTree nodes={tree} />);

    const f0 = host.querySelector('[data-filepath="S/f0.md"]');
    const f1 = host.querySelector('[data-filepath="S/f1.md"]');
    expect(f0?.getAttribute('data-hit-active')).toBeNull();
    expect(f1?.getAttribute('data-hit-active')).toBe('true');
  });

  it('does not re-render directory rows when navigating between files inside them', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    const tree = buildSpaceTree();

    await render(<FileTree nodes={tree} />);
    const before = count('Layers');
    expect(before).toBeGreaterThan(0);

    nav.pathname = '/view/S/f2.md';
    await render(<FileTree nodes={tree} />);

    expect(count('Layers')).toBe(before);
  });

  it('re-renders directory rows whose active-path containment changes', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    const tree: FileNode[] = [
      ...buildSpaceTree(),
      {
        type: 'directory', name: 'T', path: 'T', isSpace: true,
        children: [{ type: 'file', name: 'g.md', path: 'T/g.md', extension: '.md' }],
      },
    ];

    await render(<FileTree nodes={tree} />);
    nav.pathname = '/view/T/g.md';
    await render(<FileTree nodes={tree} />);

    const sRow = [...host.querySelectorAll('button')].find(b => b.textContent === 'S');
    const tRow = [...host.querySelectorAll('button')].find(b => b.textContent === 'T');
    expect(sRow?.getAttribute('data-hit-active')).toBeNull();
    expect(tRow?.getAttribute('data-hit-active')).toBe('true');
  });

  it('marks rows with content-visibility containment so offscreen rows skip rendering work', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    await render(<FileTree nodes={buildSpaceTree()} />);

    const fileRow = host.querySelector('[data-filepath="S/f0.md"]');
    expect(fileRow?.className).toContain('content-visibility:auto');
    expect(fileRow?.className).toContain('contain-intrinsic-block-size');
  });
});

describe('countContentFiles caching', () => {
  beforeEach(() => {
    nav.pathname = '/';
  });

  it('returns the cached count for the same node identity without re-walking children', async () => {
    const { countContentFiles } = await import('@/components/FileTree');
    let childrenAccesses = 0;
    const inner: FileNode[] = [
      { type: 'file', name: 'a.md', path: 'S/a.md', extension: '.md' },
      { type: 'file', name: 'README.md', path: 'S/README.md', extension: '.md' }, // system file
    ];
    const node = {
      type: 'directory' as const,
      name: 'S',
      path: 'S',
      get children() { childrenAccesses += 1; return inner; },
    };

    expect(countContentFiles(node)).toBe(1); // README.md excluded
    const accessesAfterFirst = childrenAccesses;
    expect(accessesAfterFirst).toBeGreaterThan(0);

    expect(countContentFiles(node)).toBe(1);
    expect(childrenAccesses).toBe(accessesAfterFirst); // cache hit: no re-walk
  });

  it('recomputes for a new node identity', async () => {
    const { countContentFiles } = await import('@/components/FileTree');
    const make = (n: number): FileNode => ({
      type: 'directory',
      name: 'S',
      path: 'S',
      children: Array.from({ length: n }, (_, i) => ({
        type: 'file' as const, name: `f${i}.md`, path: `S/f${i}.md`, extension: '.md',
      })),
    });
    expect(countContentFiles(make(3))).toBe(3);
    expect(countContentFiles(make(5))).toBe(5);
  });

  it('shows the cached content count badge on a collapsed space', async () => {
    const { default: FileTree } = await import('@/components/FileTree');
    host = document.createElement('div');
    document.body.appendChild(host);
    const tree = buildSpaceTree();
    const localRoot = createRoot(host);
    await act(async () => {
      localRoot.render(<FileTree nodes={tree} maxOpenDepth={-1} />);
    });
    expect(host.textContent).toContain(String(FILE_COUNT));
    await act(async () => { localRoot.unmount(); });
    host.remove();
  });
});
