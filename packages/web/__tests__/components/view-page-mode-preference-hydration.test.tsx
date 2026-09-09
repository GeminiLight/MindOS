// @vitest-environment jsdom
import React, { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ViewPageClient from '@/app/view/[...path]/ViewPageClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      view: { emptyNote: 'Empty note' },
      home: { rootLevel: 'Root' },
      fileTree: { pinToFavorites: 'Pin', removeFromFavorites: 'Unpin' },
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
vi.mock('@/components/changes/line-diff', () => ({
  buildLineDiff: () => [],
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
  twemojiToNative: (value: string) => value,
}));
vi.mock('@/lib/plugins/client', () => ({
  fetchPluginViewSurfacesForExtension: vi.fn().mockResolvedValue([]),
  pluginViewSurfaceHref: vi.fn(() => null),
}));
vi.mock('@/hooks/useAgentChangeReview', () => ({
  useAgentChangeReview: () => ({ unreadAgentCount: 0, entries: [], markSeen: vi.fn() }),
}));

function modeLabel(container: ParentNode): string | undefined {
  return [...container.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === 'Markdown mode')?.textContent ?? undefined;
}

function page() {
  return <ViewPageClient filePath="note.md" content={'# Body'} extension="md" saveAction={vi.fn()} />;
}

describe('ViewPageClient markdown mode preference and hydration', () => {
  let host: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    localStorage.clear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = null;
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    host.remove();
  });

  it('renders the server default no matter what the browser has stored', () => {
    const withoutPreference = renderToString(page());
    localStorage.setItem('md-view-mode', 'preview');
    const withPreference = renderToString(page());
    expect(withPreference).toBe(withoutPreference);
    const probe = document.createElement('div');
    probe.innerHTML = withPreference;
    expect(modeLabel(probe)).toContain('Edit');
  });

  it('hydrates without a mismatch and then applies the stored preview preference', async () => {
    localStorage.setItem('md-view-mode', 'preview');
    const errors: unknown[] = [];
    host.innerHTML = renderToString(page());
    await act(async () => {
      root = hydrateRoot(host, page(), { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(modeLabel(host)).toContain('View');
  });

  it('applies a stored source preference the same way', async () => {
    localStorage.setItem('md-view-mode', 'source');
    const errors: unknown[] = [];
    host.innerHTML = renderToString(page());
    await act(async () => {
      root = hydrateRoot(host, page(), { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(modeLabel(host)).toContain('Source');
  });
});
