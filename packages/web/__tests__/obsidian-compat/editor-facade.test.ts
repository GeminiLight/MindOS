import { describe, expect, it } from 'vitest';
import { createMarkdownEditorCommandContext, MarkdownTextEditorFacade } from '@/lib/obsidian-compat/editor-facade';
import type { TFile } from '@/lib/obsidian-compat/types';

const markdownFile = {
  path: 'notes/current.md',
  name: 'current.md',
  basename: 'current',
  extension: 'md',
  stat: { ctime: 0, mtime: 0, size: 0 },
  parent: null,
  vault: {},
} as TFile;

describe('MarkdownTextEditorFacade', () => {
  it('defaults the cursor to the end of the document and replaces the current selection', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'ready' });

    expect(editor.getCursor()).toEqual({ line: 0, ch: 5 });
    expect(editor.getSelection()).toBe('');

    editor.replaceSelection(' done');

    expect(editor.getValue()).toBe('ready done');
    expect(editor.getCursor()).toEqual({ line: 0, ch: 10 });
  });

  it('supports line, cursor, range, and clamped selection operations', () => {
    const editor = new MarkdownTextEditorFacade({
      content: 'alpha\nbeta\ngamma',
      selectionStart: 6,
      selectionEnd: 10,
    });

    expect(editor.getSelection()).toBe('beta');
    editor.replaceSelection('BETA');
    expect(editor.getValue()).toBe('alpha\nBETA\ngamma');
    expect(editor.lineCount()).toBe(3);
    expect(editor.getLine(1)).toBe('BETA');

    editor.setLine(2, 'delta');
    expect(editor.getValue()).toBe('alpha\nBETA\ndelta');
    expect(editor.getRange({ line: 0, ch: 2 }, { line: 1, ch: 2 })).toBe('pha\nBE');

    editor.replaceRange('X', { line: 1, ch: 4 }, { line: 1, ch: 0 });
    expect(editor.getValue()).toBe('alpha\nX\ndelta');

    editor.setCursor({ line: 99, ch: 99 });
    expect(editor.getCursor()).toEqual({ line: 2, ch: 5 });
  });

  it('creates a Markdown view for the active file', () => {
    const context = createMarkdownEditorCommandContext(markdownFile, { content: '# Current' });

    expect(context.view.file).toBe(markdownFile);
    expect(context.view.editor).toBe(context.editor);
    expect(context.view.getViewType()).toBe('markdown');
  });
});
