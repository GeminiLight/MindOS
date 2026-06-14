// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';
import {
  getTabs,
  initWorkspaceTabs,
  openTab,
  resetWorkspaceTabsForTests,
} from '@/lib/workspace-tabs';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      view: {
        copyPath: 'Copy Path',
        delete: 'Delete',
        emptyNote: 'Empty note',
        more: 'More',
        rename: 'Rename',
      },
      home: { rootLevel: 'Root' },
      fileTree: {
        export: 'Export',
        pinToFavorites: 'Pin',
        removeFromFavorites: 'Unpin',
      },
      trash: {
        movedToTrash: 'Deleted',
        undo: 'Undo',
      },
    },
  }),
}));

vi.mock('@/lib/renderers/useRendererState', () => ({
  useRendererState: () => [false, vi.fn()],
}));

vi.mock('@/lib/renderers/registry', () => ({
  resolveRenderer: () => undefined,
  isRendererEnabled: () => false,
}));

vi.mock('@/components/MarkdownView', () => ({ default: () => <div /> }));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/MarkdownEditor', () => ({ default: () => <textarea aria-label="Editor" /> }));
vi.mock('@/components/EditorWrapper', () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="Plain editor" defaultValue={value} />,
}));
vi.mock('@/components/TableOfContents', () => ({ default: () => <div /> }));
vi.mock('@/components/FindInPage', () => ({ default: () => <div /> }));
vi.mock('@/components/DirPicker', () => ({ default: () => <div /> }));
vi.mock('@/components/ExportModal', () => ({ default: () => null }));
vi.mock('@/components/agents/AgentsPrimitives', () => ({
  ConfirmDialog: () => null,
}));
vi.mock('@/components/changes/line-diff', () => ({
  buildLineDiff: () => [],
}));
vi.mock('@/lib/actions', () => ({
  renameFileAction: vi.fn(),
  deleteFileAction: vi.fn(),
  undoDeleteAction: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), undo: vi.fn() },
}));
vi.mock('@/lib/hooks/usePinnedFiles', () => ({
  usePinnedFiles: () => ({ isPinned: () => false, togglePin: vi.fn() }),
}));
vi.mock('@/lib/stores/editor-theme-store', () => ({
  useEditorTheme: () => 'default',
}));
vi.mock('@/lib/twemoji', () => ({
  twemojiToNative: (value: string) => value,
}));
vi.mock('@/lib/plugins/client', () => ({
  fetchPluginViewSurfacesForExtension: vi.fn().mockResolvedValue([]),
  pluginViewSurfaceHref: vi.fn(() => null),
}));

describe('ViewPageClient workspace tab lifecycle', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetWorkspaceTabsForTests();
    initWorkspaceTabs('root-view-page');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
    resetWorkspaceTabsForTests();
  });

  it('keeps the current preview tab when the user starts editing', async () => {
    openTab('doc', 'notes/plain.txt', 'plain.txt', { pinned: false });
    expect(getTabs()[0]).toMatchObject({ key: 'notes/plain.txt', pinned: false });

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="notes/plain.txt"
          content="draft content"
          extension="txt"
          saveAction={vi.fn()}
        />,
      );
    });

    const editButton = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Edit'));
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(getTabs()).toEqual([
      { id: 'doc:notes/plain.txt', kind: 'doc', key: 'notes/plain.txt', title: 'plain.txt' },
    ]);
  });
});
