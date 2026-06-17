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

  it('opens existing frontmatter markdown in source edit mode when Edit is preferred', async () => {
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
    const modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');

    expect(editor).not.toBeNull();
    expect(editor?.getAttribute('data-mode')).toBe('source');
    expect(view).toBeNull();
    expect(modeButton?.textContent).toContain('Source');
  });

  it('opens existing normal markdown in WYSIWYG edit mode by default', async () => {
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
    const modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');

    expect(editor).not.toBeNull();
    expect(editor?.getAttribute('data-mode')).toBe('wysiwyg');
    expect(view).toBeNull();
    expect(modeButton?.textContent).toContain('Edit');
  });

  it('honors the global preview preference across existing markdown files', async () => {
    localStorage.setItem('md-view-mode', 'preview');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="first.md"
          content={'# First'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    let editor = host.querySelector('[data-testid="markdown-editor"]');
    let view = host.querySelector('[data-testid="markdown-view"]');
    let modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');

    expect(editor).toBeNull();
    expect(view).not.toBeNull();
    expect(modeButton?.textContent).toContain('View');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="second.md"
          content={'# Second'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    editor = host.querySelector('[data-testid="markdown-editor"]');
    view = host.querySelector('[data-testid="markdown-view"]');
    modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');

    expect(editor).toBeNull();
    expect(view).not.toBeNull();
    expect(modeButton?.textContent).toContain('View');
  });

  it('honors the global source preference for normal markdown files', async () => {
    localStorage.setItem('md-view-mode', 'source');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="source-mode.md"
          content={'# Source Mode'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const editor = host.querySelector('[data-testid="markdown-editor"]');
    const view = host.querySelector('[data-testid="markdown-view"]');
    const modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');

    expect(editor).not.toBeNull();
    expect(editor?.getAttribute('data-mode')).toBe('source');
    expect(view).toBeNull();
    expect(modeButton?.textContent).toContain('Source');
  });

  it('remembers when the user switches back to Edit for later markdown files', async () => {
    localStorage.setItem('md-view-mode', 'preview');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="first.md"
          content={'# First'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');
    expect(modeButton?.textContent).toContain('View');

    await act(async () => {
      modeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const editChoice = [...host.querySelectorAll('[role="menuitemradio"]')]
      .find(item => item.textContent?.includes('Edit'));
    expect(editChoice).toBeTruthy();

    await act(async () => {
      editChoice!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorAfterEdit = host.querySelector('[data-testid="markdown-editor"]');
    expect(editorAfterEdit).not.toBeNull();
    expect(editorAfterEdit?.getAttribute('data-mode')).toBe('wysiwyg');
    expect(localStorage.getItem('md-view-mode')).toBe('wysiwyg');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="second.md"
          content={'# Second'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const editorOnSecondFile = host.querySelector('[data-testid="markdown-editor"]');
    const viewOnSecondFile = host.querySelector('[data-testid="markdown-view"]');
    const secondModeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');
    expect(editorOnSecondFile).not.toBeNull();
    expect(editorOnSecondFile?.getAttribute('data-mode')).toBe('wysiwyg');
    expect(viewOnSecondFile).toBeNull();
    expect(secondModeButton?.textContent).toContain('Edit');
  });

  it('keeps empty markdown immediately editable', async () => {
    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="empty.md"
          content=""
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const editor = host.querySelector('[data-testid="markdown-editor"]');
    const view = host.querySelector('[data-testid="markdown-view"]');
    const modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');

    expect(editor).not.toBeNull();
    expect(editor?.getAttribute('data-mode')).toBe('wysiwyg');
    expect(view).toBeNull();
    expect(modeButton?.textContent).toContain('Edit');
  });

  it('shows markdown mode choices from a compact dropdown in Edit, View, Source order', async () => {
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

    await flushDeferredFileBody();

    const modeButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Markdown mode');
    expect(modeButton).toBeTruthy();
    expect(modeButton?.textContent).toContain('Edit');

    await act(async () => {
      modeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const labels = [...host.querySelectorAll('[role="menuitemradio"]')]
      .map(item => item.textContent?.trim())
      .filter(Boolean);
    expect(labels).toEqual(['Edit', 'View', 'Source']);
  });
});
