import { describe, expect, it } from 'vitest';
import {
  getFilesErrorMessage,
  getFilesTabViewState,
  getRenameInputDefaultValue,
  normalizeNewMarkdownFileName,
  normalizeRenameTarget,
} from '@/lib/files-tab-state';
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

  it('normalizes new markdown file names while preserving portable names', () => {
    expect(normalizeNewMarkdownFileName('Project Notes')).toEqual({
      ok: true,
      fileName: 'Project Notes.md',
      title: 'Project Notes',
    });
    expect(normalizeNewMarkdownFileName('会议..notes.md')).toEqual({
      ok: true,
      fileName: '会议..notes.md',
      title: '会议..notes',
    });
    expect(normalizeNewMarkdownFileName('idea 🚀')).toEqual({
      ok: true,
      fileName: 'idea 🚀.md',
      title: 'idea 🚀',
    });
  });

  it('rejects unsafe new markdown file names before calling the server', () => {
    expect(normalizeNewMarkdownFileName('')).toMatchObject({ ok: false });
    expect(normalizeNewMarkdownFileName('../secret')).toMatchObject({ ok: false });
    expect(normalizeNewMarkdownFileName('folder/note')).toMatchObject({ ok: false });
    expect(normalizeNewMarkdownFileName('bad:name')).toMatchObject({ ok: false });
    expect(normalizeNewMarkdownFileName('CON')).toMatchObject({ ok: false });
    expect(normalizeNewMarkdownFileName('note.')).toMatchObject({ ok: false });
  });

  it('preserves markdown extensions during rename when users accept the default seed', () => {
    expect(normalizeRenameTarget('notes.md', 'renamed')).toEqual({
      ok: true,
      fileName: 'renamed.md',
      title: 'renamed',
    });
  });

  it('does not append markdown extension when renaming non-markdown files', () => {
    expect(normalizeRenameTarget('data.csv', 'renamed')).toEqual({
      ok: true,
      fileName: 'renamed',
      title: 'renamed',
    });
  });

  it('allows explicit extension changes but rejects path-like rename targets', () => {
    expect(normalizeRenameTarget('notes.md', 'notes.txt')).toMatchObject({
      ok: true,
      fileName: 'notes.txt',
    });
    expect(normalizeRenameTarget('notes.md', 'folder/notes')).toMatchObject({ ok: false });
    expect(normalizeRenameTarget('notes.md', '..')).toMatchObject({ ok: false });
  });
});
