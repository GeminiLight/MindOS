// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';

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

  it('keeps a failed save visible at every viewport and retries without losing the edit', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Disk is full')).mockResolvedValue(undefined);
    const editor = await renderEditing(save);
    vi.useFakeTimers();
    act(() => setTextareaValue(editor, 'Keep this edit'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const alert = host.querySelector('[role=alert]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Disk is full');
    expect(alert?.className).not.toContain('hidden');
    expect(editor.value).toBe('Keep this edit');
    const retry = alert!.querySelector('button')!;
    await act(async () => retry.click());
    expect(save).toHaveBeenLastCalledWith('Keep this edit');
    expect(host.querySelector('[role=alert]')).toBeNull();
  });
  it('locks the draft during creation and ignores duplicate submits until it finishes', async () => {
    const pending = deferred<void>();
    const create = vi.fn(() => pending.promise);
    await act(async () => root.render(<ViewPageClient filePath="Untitled.md" content="A" extension="md" saveAction={vi.fn()} createDraftAction={create} initialEditing isDraft draftScope="test" />));
    await flushDeferredFileBody();
    expect(host.querySelector('button[aria-label="Save"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Cancel"]')).not.toBeNull();
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Editor"]')!;
    const name = host.querySelector<HTMLInputElement>('#note-draft-name')!;
    await act(async () => name.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})));
    await act(async () => { setTextareaValue(editor, 'AB'); name.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true})); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(editor.value).toBe('A');
    await act(async () => pending.resolve());
    expect(sessionStorage.getItem('mindos:note-draft:test')).toBeNull();
  });

});
