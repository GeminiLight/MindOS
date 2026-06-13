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
      view: {
        saveDirectory: 'Directory',
        saveFileName: 'File name',
        emptyNote: 'Empty note',
      },
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

vi.mock('@/components/MarkdownView', () => ({ default: () => <div /> }));
vi.mock('@/components/JsonView', () => ({ default: () => <div /> }));
vi.mock('@/components/CsvView', () => ({ default: () => <div /> }));
vi.mock('@/components/Backlinks', () => ({ default: () => <div /> }));
vi.mock('@/components/Breadcrumb', () => ({ default: () => <div /> }));
vi.mock('@/components/MarkdownEditor', () => ({
  default: () => <textarea aria-label="Editor" />,
}));
vi.mock('@/components/EditorWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/TableOfContents', () => ({ default: () => <div /> }));
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
  toast: { success: vi.fn(), error: vi.fn() },
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

describe('ViewPageClient draft file names', () => {
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

  it('allows consecutive dots inside a draft file name', async () => {
    const createDraftAction = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <ViewPageClient
          filePath="Untitled.md"
          content=""
          extension="md"
          saveAction={vi.fn()}
          initialEditing
          isDraft
          draftDirectories={[]}
          createDraftAction={createDraftAction}
        />,
      );
    });

    const nameInput = host.querySelector('input[placeholder="Untitled.md"]') as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(nameInput!, 'meeting..notes');
      nameInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const saveButton = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Save'));
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(createDraftAction).toHaveBeenCalledWith('meeting..notes.md', '');
  });
});
