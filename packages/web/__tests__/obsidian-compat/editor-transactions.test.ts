import { describe, expect, it } from 'vitest';
import { MarkdownTextEditorFacade } from '@/lib/obsidian-compat/editor-facade';

const pos = (line: number, ch = 0) => ({ line, ch });

describe('Obsidian text editor transaction contract', () => {
  it('preserves backwards selections and distinguishes their anchor from their ordered bounds', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'alpha\nbeta' });
    editor.setSelection(pos(1, 4), pos(0, 2));
    expect(editor.getCursor('anchor')).toEqual(pos(1, 4));
    expect(editor.getCursor()).toEqual(pos(0, 2));
    expect(editor.getCursor('from')).toEqual(pos(0, 2));
    expect(editor.getCursor('to')).toEqual(pos(1, 4));
    expect(editor.getSelection()).toBe('pha\nbeta');
  });

  it('exposes document helpers with UTF-16 offsets, trailing newlines and clamped positions', () => {
    const editor = new MarkdownTextEditorFacade({ content: '中😀\nnext\n' });
    expect(editor.getDoc()).toBe(editor);
    expect(editor.lastLine()).toBe(2);
    expect(editor.posToOffset(pos(1, 2))).toBe(6);
    expect(editor.offsetToPos(6)).toEqual(pos(1, 2));
    expect(editor.offsetToPos(999)).toEqual(pos(2));
    expect(editor.posToOffset(pos(-1, -1))).toBe(0);
    expect(new MarkdownTextEditorFacade({ content: '' }).lastLine()).toBe(0);
  });

  it('replaces multiple selections once each and retains the chosen primary selection', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'one two three' });
    editor.setSelections([
      { anchor: pos(0, 7), head: pos(0, 4) },
      { anchor: pos(0), head: pos(0, 3) },
    ], 0);
    expect(editor.getSelection()).toBe('two');
    expect(editor.somethingSelected()).toBe(true);
    editor.replaceSelection('X');
    expect(editor.getValue()).toBe('X X three');
    expect(editor.getCursor()).toEqual(pos(0, 3));
    expect(editor.listSelections()).toEqual([
      { anchor: pos(0, 1), head: pos(0, 1) },
      { anchor: pos(0, 3), head: pos(0, 3) },
    ]);
    expect(editor.somethingSelected()).toBe(false);
  });

  it('merges overlapping selections and does not expose mutable selection state', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'abcdef' });
    editor.setSelections([
      { anchor: pos(0), head: pos(0, 4) },
      { anchor: pos(0, 2), head: pos(0, 6) },
    ]);
    const selections = editor.listSelections();
    selections[0].anchor.ch = 5;
    expect(editor.getSelection()).toBe('abcdef');
    editor.replaceSelection('X');
    expect(editor.getValue()).toBe('X');
  });

  it('applies unsorted changes relative to the original document in one undoable operation', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'alpha\nbeta\ngamma' });
    editor.setSelection(pos(1, 4), pos(1));
    editor.transaction({
      changes: [
        { from: pos(2), to: pos(2, 5), text: 'G' },
        { from: pos(0), to: pos(0, 5), text: 'ALPHA LONG' },
      ],
      selection: { from: pos(2, 1) },
    });
    expect(editor.getValue()).toBe('ALPHA LONG\nbeta\nG');
    expect(editor.getCursor()).toEqual(pos(2, 1));
    editor.undo();
    expect(editor.getValue()).toBe('alpha\nbeta\ngamma');
    expect(editor.getCursor('anchor')).toEqual(pos(1, 4));
    expect(editor.getCursor('head')).toEqual(pos(1));
    editor.redo();
    expect(editor.getValue()).toBe('ALPHA LONG\nbeta\nG');
    expect(editor.getCursor()).toEqual(pos(2, 1));
  });

  it('maps existing selections through edits instead of moving the cursor to the last edit', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'abc xyz' });
    editor.setSelection(pos(0, 7), pos(0, 4));
    editor.transaction({ changes: [{ from: pos(0), to: pos(0, 3), text: 'longer' }] });
    expect(editor.getSelection()).toBe('xyz');
    expect(editor.getCursor('anchor')).toEqual(pos(0, 10));
    expect(editor.getCursor('head')).toEqual(pos(0, 7));
  });

  it('uses transaction selections in the resulting document, overriding selection', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'x' });
    editor.transaction({
      replaceSelection: '\nhello',
      selection: { from: pos(0) },
      selections: [{ from: pos(1, 5), to: pos(1) }],
    });
    expect(editor.getValue()).toBe('x\nhello');
    expect(editor.getSelection()).toBe('hello');
    expect(editor.getCursor()).toEqual(pos(1));
  });

  it.each([
    { changes: [{ from: pos(0), to: pos(0, 3), text: 'X' }, { from: pos(0, 2), text: 'Y' }] },
    { changes: [{ from: pos(0), text: 'X' }], selections: [] },
    { changes: [{ from: pos(0), text: 'X' }], selection: { from: pos(NaN) } },
    { changes: [{ from: pos(0), text: 'X' }, { from: pos(Infinity), text: 'Y' }] },
  ])('rejects invalid or overlapping transactions without partially modifying text or history: %j', tx => {
    const editor = new MarkdownTextEditorFacade({ content: 'original' });
    expect(() => editor.transaction(tx)).toThrow(RangeError);
    expect(editor.getValue()).toBe('original');
    editor.undo();
    expect(editor.getValue()).toBe('original');
  });

  it('rejects empty selections and invalid main indices without losing existing selections', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'original' });
    editor.setSelection(pos(0), pos(0, 3));
    expect(() => editor.setSelections([])).toThrow(RangeError);
    expect(() => editor.setSelections([{ anchor: pos(0) }], 2)).toThrow(RangeError);
    expect(editor.getSelection()).toBe('ori');
  });

  it('does not create undo steps for selection-only or empty transactions and clears redo after edits', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'a' });
    editor.replaceSelection('b');
    editor.transaction({});
    editor.transaction({ selection: { from: pos(0) } });
    editor.undo();
    expect(editor.getValue()).toBe('a');
    editor.replaceSelection('c');
    editor.redo();
    expect(editor.getValue()).toBe('ac');
  });

  it('keeps only the last 100 document edits in the command-local undo history', () => {
    const editor = new MarkdownTextEditorFacade({ content: '' });
    for (let i = 0; i < 105; i++) editor.replaceSelection('x');
    for (let i = 0; i < 110; i++) editor.undo();
    expect(editor.getValue()).toBe('xxxxx');
  });

  it('preserves mixed newline bytes when inspecting, editing, and undoing a document', () => {
    const content = 'one\r\ntwo\n三😀\r\n';
    const editor = new MarkdownTextEditorFacade({ content });
    expect(editor.getValue()).toBe(content);
    for (let offset = 0; offset <= content.length; offset++) {
      expect(editor.posToOffset(editor.offsetToPos(offset))).toBe(offset);
    }
    editor.replaceRange('TWO', pos(1), pos(1, 3));
    expect(editor.getValue()).toBe('one\r\nTWO\n三😀\r\n');
    editor.undo();
    expect(editor.getValue()).toBe(content);
  });

  it('combines selection replacement with disjoint explicit edits in the original coordinate space', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'abc def' });
    editor.setSelection(pos(0, 4), pos(0, 7));
    editor.transaction({ replaceSelection: 'D', changes: [{ from: pos(0), to: pos(0, 3), text: 'A' }] });
    expect(editor.getValue()).toBe('A D');
    expect(editor.getCursor()).toEqual(pos(0, 3));
    editor.undo();
    expect(editor.getValue()).toBe('abc def');
  });

  it('keeps same-offset insertion order and treats the batch as one edit', () => {
    const editor = new MarkdownTextEditorFacade({ content: 'x' });
    editor.transaction({ changes: [
      { from: pos(0), text: 'a' }, { from: pos(0), text: 'b' },
    ] });
    expect(editor.getValue()).toBe('abx');
    editor.undo();
    expect(editor.getValue()).toBe('x');
  });
});
