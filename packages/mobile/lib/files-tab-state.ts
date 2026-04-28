import type { FileNode } from '@/lib/types';

export interface FilesBannerState {
  title: string;
  message: string;
  showRetry: boolean;
}

export interface FilesTabViewState {
  showEmptyState: boolean;
  banner: FilesBannerState | null;
  tree: FileNode[];
}

const FALLBACK_FILES_ERROR_MESSAGE = 'Unable to load files right now';

export const getFilesErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return FALLBACK_FILES_ERROR_MESSAGE;
};

export const getFilesTabViewState = (tree: FileNode[], error: unknown): FilesTabViewState => {
  const hasError = Boolean(error);
  return {
    tree,
    showEmptyState: tree.length === 0 && !hasError,
    banner: hasError
      ? {
          title: 'Files are temporarily unavailable',
          message: getFilesErrorMessage(error),
          showRetry: true,
        }
      : null,
  };
};

export const getRenameInputDefaultValue = (fileName: string): string => fileName.replace(/\.md$/, '');
