// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const mockRefresh = vi.fn();
const mockClose = vi.fn();
const mockConvertToSpaceAction = vi.fn();
const mockCheckAiAvailable = vi.fn();
const mockTriggerSpaceAiInit = vi.fn();
const mockToastError = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

vi.mock('@/lib/actions', () => ({
  convertToSpaceAction: (...args: unknown[]) => mockConvertToSpaceAction(...args),
}));

vi.mock('@/lib/space-ai-init', () => ({
  checkAiAvailable: () => mockCheckAiAvailable(),
  triggerSpaceAiInit: (...args: unknown[]) => mockTriggerSpaceAiInit(...args),
}));

vi.mock('@/lib/toast', () => ({
  toast: { error: mockToastError },
}));

vi.mock('@/lib/hooks/usePinnedFiles', () => ({
  usePinnedFiles: () => ({ isPinned: () => false, togglePin: vi.fn() }),
}));

vi.mock('@/lib/stores/locale-store', () => ({
  useLocale: () => ({
    t: {
      fileTree: {
        newFile: 'New File',
        addAsContext: 'Add as Context',
        addedAsContext: 'Added to context',
        openInFileManager: 'Open in File Manager',
        openInFileManagerFailed: 'Could not open in file manager',
        removeFromFavorites: 'Remove from Favorites',
        pinToFavorites: 'Pin to Favorites',
        convertToSpace: 'Convert to Space',
        convertToSpaceAiRequired: 'Configure AI before converting this folder into a Space.',
        copyPath: 'Copy Path',
        rename: 'Rename',
        deleteFolder: 'Delete Folder',
        failed: 'Failed',
      },
    },
  }),
}));

describe('FolderContextMenu convert to Space AI gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  async function renderMenu() {
    const { FolderContextMenu } = await import('@/components/file-tree/FileTreeContextMenus');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <FolderContextMenu
          x={20}
          y={20}
          node={{ name: 'Research', path: 'Research', type: 'directory', children: [] }}
          onClose={mockClose}
          onRename={vi.fn()}
          onNewFile={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });

    const button = [...document.body.querySelectorAll('button')]
      .find(el => el.textContent?.includes('Convert to Space'));
    expect(button).toBeTruthy();
    return { host, root, button: button as HTMLButtonElement };
  }

  it('does not create template files when AI is unavailable', async () => {
    mockCheckAiAvailable.mockResolvedValue(false);

    const { root, button } = await renderMenu();

    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(mockConvertToSpaceAction).not.toHaveBeenCalled();
    expect(mockTriggerSpaceAiInit).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Configure AI before converting this folder into a Space.', 5000);
    expect(mockClose).toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });

  it('converts the folder and starts visible AI initialization when AI is available', async () => {
    mockCheckAiAvailable.mockResolvedValue(true);
    mockConvertToSpaceAction.mockResolvedValue({ success: true });

    const { root, button } = await renderMenu();

    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockConvertToSpaceAction).toHaveBeenCalledWith('Research');
    expect(mockTriggerSpaceAiInit).toHaveBeenCalledWith('Research', 'Research');
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });
});
