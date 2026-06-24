// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';
import { toast } from '@/lib/toast';
import { OBSIDIAN_LINTER_PROFILE_STORAGE_KEY } from '@/lib/stores/obsidian-linter-profile-store';

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
  default: ({
    value,
    viewMode,
    sandboxContributions = [],
  }: {
    value: string;
    viewMode: string;
    sandboxContributions?: unknown[];
  }) => (
    <div
      data-testid="markdown-editor"
      data-mode={viewMode}
      data-sandbox-count={sandboxContributions.length}
    >
      {value}
    </div>
  ),
}));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/EditorWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
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
  buildLineDiff: (before: string, after: string) => [
    { type: 'delete', text: before.split('\n')[0] ?? '' },
    { type: 'insert', text: after.split('\n')[0] ?? '' },
  ],
  collapseDiffContext: (rows: unknown[]) => rows,
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

  it('enables Linter preview decorations explicitly in markdown source mode', async () => {
    localStorage.setItem('md-view-mode', 'source');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="source-mode.md"
          content={'#Title\nLine with space  \n'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const editorBefore = host.querySelector('[data-testid="markdown-editor"]');
    const lintButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Toggle Linter preview');

    expect(editorBefore?.getAttribute('data-mode')).toBe('source');
    expect(editorBefore?.getAttribute('data-sandbox-count')).toBe('0');
    expect(lintButton).toBeTruthy();
    expect(lintButton?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      lintButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorAfter = host.querySelector('[data-testid="markdown-editor"]');
    expect(lintButton?.getAttribute('aria-pressed')).toBe('true');
    expect(lintButton?.textContent).toContain('2');
    expect(editorAfter?.getAttribute('data-sandbox-count')).toBe('2');
  });

  it('uses the persisted Obsidian Linter profile and updates preview when rules change', async () => {
    localStorage.setItem('md-view-mode', 'source');
    localStorage.setItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY, JSON.stringify({
      version: 1,
      enabledRules: {
        'trailing-whitespace': false,
      },
      maxConsecutiveBlankLines: 1,
    }));

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="source-mode.md"
          content={'#Title\nLine with space  \n'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const lintButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Toggle Linter preview');
    expect(lintButton).toBeTruthy();

    await act(async () => {
      lintButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(lintButton?.textContent).toContain('1');
    expect(host.querySelector('[data-testid="markdown-editor"]')?.getAttribute('data-sandbox-count')).toBe('1');

    const rulesButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Configure Linter rules');
    expect(rulesButton).toBeTruthy();

    await act(async () => {
      rulesButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const trailingWhitespaceToggle = host.querySelector(
      '[data-testid="linter-rule-toggle-trailing-whitespace"]',
    ) as HTMLInputElement | null;
    expect(trailingWhitespaceToggle).toBeTruthy();
    expect(trailingWhitespaceToggle?.checked).toBe(false);

    await act(async () => {
      trailingWhitespaceToggle!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const updatedPreference = JSON.parse(localStorage.getItem(OBSIDIAN_LINTER_PROFILE_STORAGE_KEY) ?? '{}');
    expect(updatedPreference.enabledRules['trailing-whitespace']).toBe(true);
    expect(host.querySelector('[data-testid="markdown-editor"]')?.getAttribute('data-sandbox-count')).toBe('2');
    expect(lintButton?.textContent).toContain('2');
  });

  it('reviews and applies Linter fixes only through an explicit source-mode action with undo', async () => {
    localStorage.setItem('md-view-mode', 'source');

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="source-mode.md"
          content={'#Title\nLine with space  \n'}
          extension="md"
          saveAction={vi.fn()}
        />,
      );
    });

    await flushDeferredFileBody();

    const lintButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Toggle Linter preview');
    expect(lintButton).toBeTruthy();
    expect([...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Apply Linter fixes')).toBeFalsy();
    expect([...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Review Linter fixes')).toBeFalsy();

    await act(async () => {
      lintButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const reviewButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Review Linter fixes');
    expect(reviewButton).toBeTruthy();
    expect(host.querySelector('[data-testid="linter-fix-review"]')).toBeNull();

    await act(async () => {
      reviewButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="linter-fix-review"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="linter-fix-review-summary"]')?.textContent).toContain('2 fixes');
    expect(host.querySelector('[data-testid="markdown-editor"]')?.textContent).toBe('#Title\nLine with space  \n');

    const applyReviewedButton = [...host.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Apply reviewed Linter fixes');
    expect(applyReviewedButton).toBeTruthy();

    await act(async () => {
      applyReviewedButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const editorAfter = host.querySelector('[data-testid="markdown-editor"]');
    expect(editorAfter?.textContent).toBe('# Title\nLine with space\n');
    expect(editorAfter?.getAttribute('data-sandbox-count')).toBe('0');
    expect(host.querySelector('[data-testid="linter-fix-review"]')).toBeNull();
    expect(toast.undo).toHaveBeenCalledWith(
      'Applied 2 Linter fixes',
      expect.any(Function),
      { label: 'Undo' },
    );

    const undo = vi.mocked(toast.undo).mock.calls.at(-1)?.[1];
    expect(undo).toBeTruthy();

    await act(async () => {
      undo?.();
    });

    expect(host.querySelector('[data-testid="markdown-editor"]')?.textContent).toBe('#Title\nLine with space  \n');
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
