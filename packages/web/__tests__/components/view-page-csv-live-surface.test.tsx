// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';

const routerPush = vi.fn();
const routerRefresh = vi.fn();
const routerBack = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
    back: routerBack,
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
      changes: { agentEditedChip: 'agent edited' },
    },
  }),
}));

vi.mock('@/lib/renderers/useRendererState', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    useRendererState: <T,>(_rendererId: string, _filePath: string, defaultValue: T) => ReactActual.useState(defaultValue),
  };
});

vi.mock('@/lib/renderers/registry', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react');
  return {
    registerRenderer: vi.fn(),
    isRendererEnabled: () => true,
    resolveRenderer: (_filePath: string, extension: string) => {
      if (extension !== 'csv') return undefined;
      return {
        id: 'csv',
        name: 'CSV Views',
        description: 'CSV test renderer',
        author: 'MindOS',
        icon: 'table',
        tags: ['csv'],
        builtin: true,
        core: true,
        match: () => true,
        component: ({ content }: { content: string }) => ReactActual.createElement('div', {
          'data-testid': 'csv-renderer',
        }, content),
      };
    },
  };
});

vi.mock('@/lib/plugins/client', () => ({
  fetchPluginViewSurfacesForExtension: vi.fn().mockResolvedValue([]),
  pluginViewSurfaceHref: vi.fn(() => null),
}));

vi.mock('@/hooks/useAgentChangeReview', () => ({
  useAgentChangeReview: () => ({
    loading: false,
    unreadCount: 0,
    unreadAgentCount: 0,
    unreviewedPathCount: 0,
    unreviewedPaths: new Set<string>(),
    events: [],
    unreviewedEvents: [],
    lastSeenAt: null,
    refresh: vi.fn(),
    hasUnreviewedAgentChange: () => false,
    latestForPath: () => null,
  }),
}));

vi.mock('@/components/MarkdownView', () => ({ default: () => <div /> }));
vi.mock('@/components/MarkdownEditor', () => ({ default: () => <div /> }));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div data-testid="legacy-csv-view" /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/EditorWrapper', () => ({ default: () => <div /> }));
vi.mock('@/components/TableOfContents', () => ({
  default: () => <div />,
  parseTableOfContentsHeadings: () => [],
  readTableOfContentsCollapsed: () => false,
  subscribeTableOfContentsCollapsed: () => () => {},
}));
vi.mock('@/components/FindInPage', () => ({ default: () => <div /> }));
vi.mock('@/components/DirPicker', () => ({ default: () => <div /> }));
vi.mock('@/components/ExportModal', () => ({ default: () => null }));
vi.mock('@/components/agents/AgentsPrimitives', () => ({
  ConfirmDialog: () => null,
}));
vi.mock('@/components/changes/line-diff', () => ({
  buildLineDiff: () => ({ changedLines: [] }),
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

describe('ViewPageClient CSV live surface', () => {
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

  async function flushDeferredFileBody() {
    await act(async () => {
      await new Promise<void>((resolve) => {
        const raf = window.requestAnimationFrame
          ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0));
        raf(() => raf(() => resolve()));
      });
    });
  }

  async function renderCsvPage() {
    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="Research/products.csv"
          content={'name,status\nMindOS,Active'}
          extension="csv"
          saveAction={vi.fn()}
        />,
      );
    });
    await flushDeferredFileBody();
  }

  it('opens saved CSV files directly on the live renderer without an Edit action', async () => {
    await renderCsvPage();

    expect(host.querySelector('[data-testid="csv-renderer"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="legacy-csv-view"]')).toBeNull();
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Edit')).toBe(false);
  });

  it('uses the renderer toggle as a real CSV source view instead of another table fallback', async () => {
    await renderCsvPage();

    const sourceButton = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Source'));
    expect(sourceButton).toBeTruthy();

    await act(async () => {
      sourceButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="csv-renderer"]')).toBeNull();
    expect(host.querySelector('[data-testid="legacy-csv-view"]')).toBeNull();
    expect(host.querySelector('[data-testid="csv-raw-source"]')?.textContent).toContain('name,status');
    expect(host.querySelector('[data-testid="csv-raw-source"]')?.textContent).toContain('MindOS,Active');
  });
});
