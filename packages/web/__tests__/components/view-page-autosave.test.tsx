// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';
import { renameFileAction } from '@/lib/actions';
import { toast } from '@/lib/toast';

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh, back: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      view: { saveDirectory: 'Directory', saveFileName: 'File name', emptyNote: 'Empty note' },
      home: { rootLevel: 'Root' },
      fileTree: { pinToFavorites: 'Pin', removeFromFavorites: 'Unpin' },
      changes: {},
    },
  }),
}));
vi.mock('@/lib/renderers/useRendererState', () => ({ useRendererState: () => [false, vi.fn()] }));
vi.mock('@/lib/renderers/registry', () => ({
  registerRenderer: vi.fn(),
  resolveRenderer: () => undefined,
  isRendererEnabled: () => false,
}));
vi.mock('@/components/MarkdownView', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown-view">{content}</div>,
}));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
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
vi.mock('@/components/agents/AgentsPrimitives', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/changes/line-diff', () => ({ buildLineDiff: () => ({ changedLines: [] }) }));
vi.mock('@/lib/actions', () => ({
  renameFileAction: vi.fn(),
  deleteFileAction: vi.fn(),
  undoDeleteAction: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), undo: vi.fn() } }));
vi.mock('@/lib/hooks/usePinnedFiles', () => ({ usePinnedFiles: () => ({ isPinned: () => false, togglePin: vi.fn() }) }));
vi.mock('@/lib/stores/editor-theme-store', () => ({ useEditorTheme: () => 'default' }));
vi.mock('@/lib/twemoji', () => ({ twemojiToNative: (value: string) => value }));
vi.mock('@/lib/plugins/client', () => ({
  fetchPluginViewSurfacesForExtension: vi.fn().mockResolvedValue([]),
  pluginViewSurfaceHref: vi.fn(() => null),
}));
vi.mock('@/hooks/useAgentChangeReview', () => ({
  useAgentChangeReview: () => ({
    loading: false, unreadCount: 0, unreadAgentCount: 0, unreviewedPathCount: 0,
    unreviewedPaths: new Set<string>(), events: [], unreviewedEvents: [], lastSeenAt: null,
    refresh: vi.fn(), hasUnreviewedAgentChange: () => false, latestForPath: () => null,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ViewPageClient markdown autosave and error surfacing', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  async function renderEditing(saveAction: (content: string) => Promise<void>, content = 'hello') {
    await act(async () => {
      root.render(
        <ViewPageClient filePath="Notes/a.md" content={content} extension="md" saveAction={saveAction} initialEditing />,
      );
    });
    await flushDeferredFileBody();
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Editor"]');
    expect(editor).not.toBeNull();
    return editor!;
  }

  it('flushes a pending edit when the page unmounts before the autosave timer fires', async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const editor = await renderEditing(saveAction);
    act(() => { setTextareaValue(editor, 'hello world'); });
    expect(saveAction).not.toHaveBeenCalled();

    act(() => { root.unmount(); });
    root = createRoot(host);

    expect(saveAction).toHaveBeenCalledWith('hello world');
  });

  it('reschedules the autosave when the timer fires while a save is in flight', async () => {
    const first = deferred<void>();
    const saveAction = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const editor = await renderEditing(saveAction);
    vi.useFakeTimers();

    act(() => { setTextareaValue(editor, 'hello 1'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(saveAction).toHaveBeenCalledWith('hello 1');

    // A second edit lands while the first save is still pending.
    act(() => { setTextareaValue(editor, 'hello 2'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    first.resolve();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });

    expect(saveAction).toHaveBeenCalledWith('hello 2');
  });

  it('surfaces autosave failures instead of going silently idle', async () => {
    const saveAction = vi.fn().mockRejectedValue(new Error('disk full'));
    const editor = await renderEditing(saveAction);
    vi.useFakeTimers();

    act(() => { setTextareaValue(editor, 'hello again'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(saveAction).toHaveBeenCalledWith('hello again');
    expect(host.textContent).toContain('disk full');
  });

  it('rolls savedContent back and reports the error when switching to View fails to save', async () => {
    const saveAction = vi.fn().mockRejectedValue(new Error('save blocked'));
    const editor = await renderEditing(saveAction);
    vi.useFakeTimers();
    act(() => { setTextareaValue(editor, 'hello edited'); });

    const modeButton = host.querySelector<HTMLButtonElement>('button[aria-label="Markdown mode"]');
    expect(modeButton).not.toBeNull();
    act(() => { modeButton!.click(); });
    const viewOption = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((button) => button.textContent?.includes('View'));
    expect(viewOption).toBeTruthy();
    await act(async () => { viewOption!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(saveAction).toHaveBeenCalledWith('hello edited');
    expect(host.textContent).toContain('save blocked');
    expect(host.querySelector('[data-testid="markdown-view"]')?.textContent).toBe('hello');
  });

  it('shows a toast when rename fails instead of silently closing the dialog', async () => {
    vi.mocked(renameFileAction).mockResolvedValue({ success: false, error: 'Rename blocked' } as never);
    const saveAction = vi.fn().mockResolvedValue(undefined);
    await renderEditing(saveAction);

    const moreButton = host.querySelector<HTMLButtonElement>('button[title="More"]');
    expect(moreButton).not.toBeNull();
    act(() => { moreButton!.click(); });
    const renameItem = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Rename');
    expect(renameItem).toBeTruthy();
    act(() => { renameItem!.click(); });

    const input = [...host.querySelectorAll<HTMLInputElement>('input')].find((el) => el.value === 'a.md');
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input!, 'b.md');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renameFileAction).toHaveBeenCalledWith('Notes/a.md', 'b.md');
    expect(toast.error).toHaveBeenCalledWith('Rename blocked');
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('renders when localStorage throws a SecurityError', async () => {
    const throwSecurity = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(throwSecurity);
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(throwSecurity);
    try {
      const saveAction = vi.fn().mockResolvedValue(undefined);

      const editor = await renderEditing(saveAction);
      expect(editor).toBeTruthy();

      // Switching modes writes the preference; that must not throw either.
      const modeButton = host.querySelector<HTMLButtonElement>('button[aria-label="Markdown mode"]')!;
      act(() => { modeButton.click(); });
      const sourceOption = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((button) => button.textContent?.includes('Source'))!;
      expect(() => act(() => { sourceOption.click(); })).not.toThrow();
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });
});
