import { undo, redo } from '@codemirror/commands';
import { StateEffect, type EditorState, type Transaction } from '@codemirror/state';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import { MarkdownTextEditorFacade } from '../editor-facade';

/** Shares the live view's state and undo history; never replaces or snapshots the view. */
export class LiveMarkdownEditor extends MarkdownTextEditorFacade {
  private disposed = false;
  constructor(readonly cm: EditorView) {
    super({ content: '' });
    cm.dispatch({ effects: StateEffect.appendConfig.of(ViewPlugin.define(() => ({
      destroy: () => { this.disposed = true; },
    }))) });
  }

  protected override get state(): EditorState { return this.cm.state; }

  protected override commit(transaction: Transaction): void {
    this.assertAlive();
    if (transaction.docChanged && this.cm.state.readOnly) throw new Error('Editor is read-only.');
    this.cm.dispatch(transaction);
  }

  override undo(): void { this.assertAlive(); if (!this.state.readOnly) undo(this.cm); }
  override redo(): void { this.assertAlive(); if (!this.state.readOnly) redo(this.cm); }
  focus(): void { this.assertAlive(); this.cm.focus(); }
  hasFocus(): boolean { return this.cm.hasFocus; }

  private assertAlive(): void {
    if (this.disposed) throw new Error('EditorView is destroyed or its state has been replaced.');
  }
}
