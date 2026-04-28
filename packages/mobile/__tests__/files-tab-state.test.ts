import { describe, expect, it } from 'vitest';
import { getFilesErrorMessage, getFilesTabViewState, getRenameInputDefaultValue } from '@/lib/files-tab-state';
import type { FileNode } from '@/lib/types';

describe('files-tab-state', () => {
  it('returns a readable message from an Error instance', () => {
    expect(getFilesErrorMessage(new Error('connect ECONNREFUSED'))).toBe('connect ECONNREFUSED');
  });

  it('falls back for unknown errors', () => {
    expect(getFilesErrorMessage(null)).toBe('Unable to load files right now');
  });

  it('falls back for Error with empty message', () => {
    expect(getFilesErrorMessage(new Error(''))).toBe('Unable to load files right now');
    expect(getFilesErrorMessage(new Error('   '))).toBe('Unable to load files right now');
  });

  it('shows recoverable banner and hides empty state when load failed with no tree', () => {
    const state = getFilesTabViewState([], new Error('offline'));
    expect(state.showEmptyState).toBe(false);
    expect(state.banner).toEqual({
      title: 'Files are temporarily unavailable',
      message: 'offline',
      showRetry: true,
    });
  });

  it('keeps existing tree visible while also showing error banner', () => {
    const tree: FileNode[] = [{ type: 'file', name: 'note.md', path: 'note.md', extension: '.md' }];
    const state = getFilesTabViewState(tree, new Error('timeout'));
    expect(state.tree).toEqual(tree);
    expect(state.showEmptyState).toBe(false);
    expect(state.banner?.message).toBe('timeout');
  });

  it('shows empty state only when tree is empty and there is no error', () => {
    const state = getFilesTabViewState([], null);
    expect(state.banner).toBeNull();
    expect(state.showEmptyState).toBe(true);
  });

  it('uses the current markdown file name as rename seed without md suffix', () => {
    expect(getRenameInputDefaultValue('notes.md')).toBe('notes');
  });

  it('keeps non-markdown file names unchanged for rename seed', () => {
    expect(getRenameInputDefaultValue('report.txt')).toBe('report.txt');
  });
});
