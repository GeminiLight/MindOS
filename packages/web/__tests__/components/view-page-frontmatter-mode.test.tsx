// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';

const mocks = vi.hoisted(() => ({
  twemojiToNative: vi.fn((value: string) => value),
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
  registerRenderer: vi.fn(),
  resolveRenderer: () => undefined,
  isRendererEnabled: () => false,
}));

vi.mock('@/components/MarkdownView', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown-view">{content}</div>,
}));
vi.mock('@/components/MarkdownEditor', () => ({
  default: ({ value, viewMode }: { value: string; viewMode: string }) => (
    <div data-testid="markdown-editor" data-mode={viewMode}>{value}</div>
  ),
}));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/EditorWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
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
  twemojiToNative: mocks.twemojiToNative,
}));
vi.mock('@/lib/plugins/client', () => ({
  fetchPluginViewSurfacesForExtension: vi.fn().mockResolvedValue([]),
  pluginViewSurfaceHref: vi.fn(() => null),
}));

describe('ViewPageClient frontmatter markdown mode', () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('md-view-mode', 'wysiwyg');
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

  it('opens markdown with frontmatter in view mode without mounting the editor pane', async () => {
    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="note.md"
          content={'---\ntype: sop\nstatus: active\n---\n\n# Body'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    expect(host.querySelector('[data-file-body-warmup]')).not.toBeNull();
    expect(mocks.twemojiToNative).not.toHaveBeenCalled();

    await flushDeferredFileBody();

    const editor = host.querySelector('[data-testid="markdown-editor"]');
    const view = host.querySelector('[data-testid="markdown-view"]');

    expect(view).not.toBeNull();
    expect(editor).toBeNull();
  });

  it('opens normal markdown in edit mode without mounting the preview pane', async () => {
    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="note.md"
          content={'# Body'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    expect(host.querySelector('[data-file-body-warmup]')).not.toBeNull();
    expect(mocks.twemojiToNative).not.toHaveBeenCalled();

    await flushDeferredFileBody();

    const editor = host.querySelector('[data-testid="markdown-editor"]');
    const view = host.querySelector('[data-testid="markdown-view"]');

    expect(editor).not.toBeNull();
    expect(view).toBeNull();
  });
});
