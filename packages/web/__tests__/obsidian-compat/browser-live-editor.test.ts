// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, StateField, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import * as live from '@/lib/obsidian-compat/browser-host/live-editor';

const views: EditorView[] = [];
function editor(doc = 'one\ntwo', readOnly = false) {
  expect(live.LiveMarkdownEditor, 'the facade must edit an actual EditorView').toBeTypeOf('function');
  const view = new EditorView({ parent: document.body, state: EditorState.create({
    doc, extensions: [basicSetup, EditorState.readOnly.of(readOnly), EditorState.lineSeparator.of('\n')],
  }) });
  views.push(view);
  return new live.LiveMarkdownEditor(view);
}
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });

describe('Obsidian editor backed by a live CodeMirror view', () => {
  it('reads external edits and dispatches plugin edits to the same editor', () => {
    const e = editor();
    e.cm.dispatch({ changes: { from: 0, to: 3, insert: 'ONE' } });
    expect(e.getValue()).toBe('ONE\ntwo');
    e.replaceRange('TWO', { line: 1, ch: 0 }, { line: 1, ch: 3 });
    expect(e.cm.state.doc.toString()).toBe('ONE\nTWO');
  });

  it('keeps ViewPlugin/StateField state through selections and atomic transactions', () => {
    const e = editor();
    const field = StateField.define({ create: () => 0, update: (n, tx) => n + Number(tx.docChanged) });
    // The live editor must dispatch, not replace EditorState or re-create EditorView.
    e.cm.dispatch({ effects: StateEffect.appendConfig.of(field) });
    e.setCursor(1, 2);
    e.transaction({ changes: [
      { from: { line: 0, ch: 0 }, to: { line: 0, ch: 3 }, text: 'a' },
      { from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 }, text: 'b' },
    ], selection: { from: { line: 1, ch: 1 } } });
    expect(e.cm.state.field(field)).toBe(1);
    expect(e.getValue()).toBe('a\nb');
    expect(e.getCursor()).toEqual({ line: 1, ch: 1 });
  });

  it('shares actual browser undo/redo history with plugin commands', () => {
    const e = editor('a');
    e.setCursor(0, 1);
    e.replaceSelection('b');
    e.undo();
    expect(e.cm.state.doc.toString()).toBe('a');
    e.redo();
    expect(e.cm.state.doc.toString()).toBe('ab');
  });

  it('preserves backwards multi-selections, Unicode and raw newline bytes', () => {
    const e = editor('中😀\r\nnext\n');
    e.setSelections([
      { anchor: { line: 1, ch: 4 }, head: { line: 1, ch: 0 } },
      { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 3 } },
    ]);
    expect(e.getSelection()).toBe('next');
    e.replaceSelection('X');
    expect(e.getValue()).toBe('中X\r\nX\n');
    expect(e.listSelections()).toHaveLength(2);
  });

  it('rejects invalid transactions atomically and protects read-only documents', () => {
    const e = editor('original');
    expect(() => e.transaction({ changes: [{ from: { line: 0, ch: 0 }, text: 'x' }],
      selections: [] })).toThrow();
    expect(e.getValue()).toBe('original');
    const readOnly = editor('locked', true);
    expect(() => readOnly.replaceSelection('x')).toThrow(/read.only/i);
    readOnly.setCursor(0, 3);
    expect(readOnly.getCursor().ch).toBe(3);
    expect(readOnly.getValue()).toBe('locked');
  });

  it('handles empty documents and rejects writes after the EditorView is destroyed', () => {
    const e = editor('');
    expect(e.lastLine()).toBe(0);
    e.cm.destroy();
    expect(() => e.setValue('late')).toThrow(/destroyed/i);
  });
});
