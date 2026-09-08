// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, StateField, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import * as host from '@/lib/obsidian-compat/browser-host/editor-extensions';

const views: EditorView[] = [];
function editor() {
  const view = new EditorView({ state: EditorState.create({ doc: 'hello' }), parent: document.body });
  views.push(view);
  return view;
}
function registry() {
  expect(host.EditorExtensionRegistry, 'a real editor extension host is required').toBeTypeOf('function');
  return new host.EditorExtensionRegistry();
}
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); });

describe('real CodeMirror extension ownership', () => {
  it('mounts a StateField in existing and later editors using the same CodeMirror instance', () => {
    const extensions = registry();
    const field = StateField.define({ create: () => 0, update: (count, tx) => count + Number(tx.docChanged) });
    const first = editor();
    extensions.attach(first);
    extensions.register('tables', field);
    expect(first.state.field(field)).toBe(0);
    first.dispatch({ changes: { from: 0, insert: 'X' } });
    expect(first.state.field(field)).toBe(1);
    const second = editor();
    extensions.attach(second);
    expect(second.state.field(field)).toBe(0);
  });

  it('removes one owner and destroys its ViewPlugin without removing another owner', () => {
    const extensions = registry();
    const view = editor();
    const destroyed: string[] = [];
    extensions.attach(view);
    const a = ViewPlugin.define(() => ({ destroy: () => { destroyed.push('a'); } }));
    const b = StateField.define({ create: () => 'b', update: value => value });
    extensions.register('a', a);
    extensions.register('b', b);
    extensions.remove('a');
    extensions.remove('a');
    expect(view.plugin(a)).toBeNull();
    expect(destroyed).toEqual(['a']);
    expect(view.state.field(b)).toBe('b');
    expect(view.state.doc.toString()).toBe('hello');
  });

  it('supports mutable extension arrays refreshed by workspace.updateOptions', () => {
    const extensions = registry();
    const view = editor();
    const a = EditorView.editable.of(false);
    const mutable: Extension[] = [a];
    extensions.register('a', mutable);
    extensions.attach(view);
    expect(view.state.facet(EditorView.editable)).toBe(false);
    mutable.splice(0);
    extensions.refresh();
    expect(view.state.facet(EditorView.editable)).toBe(true);
  });

  it('keeps prior extensions and registrations when an invalid extension is rejected', () => {
    const extensions = registry();
    const first = editor();
    const second = editor();
    extensions.attach(first);
    extensions.attach(second);
    extensions.register('a', EditorView.editable.of(false));
    expect(() => extensions.register('a', {} as Extension)).toThrow();
    for (const view of [first, second]) expect(view.state.facet(EditorView.editable)).toBe(false);
    extensions.refresh();
    expect(first.state.facet(EditorView.editable)).toBe(false);
  });

  it('detaches and reattaches without duplicate compartments or stale plugin resources', () => {
    const extensions = registry();
    const view = editor();
    extensions.register('a', EditorView.editable.of(false));
    const detach = extensions.attach(view);
    expect(() => extensions.attach(view)).toThrow(/already/i);
    detach();
    detach();
    expect(view.state.facet(EditorView.editable)).toBe(true);
    extensions.attach(view);
    expect(view.state.facet(EditorView.editable)).toBe(false);
    extensions.destroy();
    expect(view.state.facet(EditorView.editable)).toBe(true);
    expect(() => extensions.register('late', [])).toThrow(/destroyed/i);
  });

  it('rejects empty owners and rolls back changes across different editor states', () => {
    const extensions = registry();
    expect(() => extensions.register('', [])).toThrow(/owner/i);
    const first = editor();
    const second = editor();
    second.dispatch({ changes: { from: 0, to: 5, insert: 'reject' } });
    extensions.attach(first);
    extensions.attach(second);
    const field = StateField.define({ create: state => {
      if (state.doc.toString() === 'reject') throw new Error('invalid document');
      return 1;
    }, update: value => value });
    expect(() => extensions.register('broken', field)).toThrow('invalid document');
    expect(first.state.field(field, false)).toBeUndefined();
    extensions.refresh();
    expect(second.state.field(field, false)).toBeUndefined();
  });
});
