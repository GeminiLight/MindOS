// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';
import type { PluginSurface } from '@/lib/plugins/surfaces';

const mocks = vi.hoisted(() => ({
  fetchPluginViewSurfacesForExtension: vi.fn(),
}));

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
      view: { emptyNote: 'Empty note' },
      home: { rootLevel: 'Root' },
      fileTree: {
        pinToFavorites: 'Pin',
        removeFromFavorites: 'Unpin',
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

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginViewSurfacesForExtension: mocks.fetchPluginViewSurfacesForExtension,
  pluginViewSurfaceHref: (surface: PluginSurface, sourcePath?: string | null) => (
    surface.action?.type === 'obsidian-view'
      ? `/plugins/views?pluginId=${surface.action.pluginId}&viewType=${surface.action.viewType}${sourcePath ? `&sourcePath=${encodeURIComponent(sourcePath)}` : ''}`
      : null
  ),
}));

vi.mock('@/components/MarkdownView', () => ({ default: () => <div /> }));
vi.mock('@/components/MarkdownEditor', () => ({ default: () => <div /> }));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/EditorWrapper', () => ({ default: () => <div /> }));
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

const kanbanSurface: PluginSurface = {
  id: 'obsidian:view:kanban:kanban-board',
  source: 'obsidian',
  kind: 'view',
  location: 'plugin-views',
  availability: 'available',
  pluginId: 'kanban',
  pluginName: 'Kanban',
  title: 'kanban-board',
  host: {
    state: 'mounted',
    label: 'Plugin View host',
    description: 'Openable through a stable MindOS Plugin View host.',
  },
  action: {
    type: 'obsidian-view',
    pluginId: 'kanban',
    viewType: 'kanban-board',
  },
  metadata: {
    viewType: 'kanban-board',
    fileExtensions: ['kanban'],
  },
};

describe('ViewPageClient plugin extension entry', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(host);
  });

  it('shows a contextual plugin view entry for a registered file extension', async () => {
    mocks.fetchPluginViewSurfacesForExtension.mockResolvedValueOnce([kanbanSurface]);

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="projects/roadmap.kanban"
          content="- Todo"
          extension="kanban"
          saveAction={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetchPluginViewSurfacesForExtension).toHaveBeenCalledWith('kanban');
    expect(host.querySelector('[data-testid="plugin-view-extension-entry"]')).not.toBeNull();
    expect(host.textContent).toContain('Plugin view available');
    expect(host.textContent).toContain('.kanban can open through an Obsidian-compatible view.');

    const link = host.querySelector('[data-testid="plugin-view-extension-link"]') as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Kanban');
    expect(link?.getAttribute('href')).toBe('/plugins/views?pluginId=kanban&viewType=kanban-board&sourcePath=projects%2Froadmap.kanban');
  });

  it('keeps the file page clean when no plugin view matches the extension', async () => {
    mocks.fetchPluginViewSurfacesForExtension.mockResolvedValueOnce([]);

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="notes/plain.txt"
          content="plain text"
          extension="txt"
          saveAction={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.fetchPluginViewSurfacesForExtension).toHaveBeenCalledWith('txt');
    expect(host.querySelector('[data-testid="plugin-view-extension-entry"]')).toBeNull();
    expect(host.textContent).not.toContain('Plugin view available');
  });
});
