import { EditorSelection as CMSelection, EditorState, type Text, type Transaction } from '@codemirror/state';
import type {
  ClickableToken, Editor, EditorPosition, EditorSelection, EditorSelectionOrCaret,
  EditorTransaction, MarkdownView, TFile,
} from './types';

export interface MarkdownEditorContextInput {
  content: string;
  selectionStart?: number;
  selectionEnd?: number;
  cursorOffset?: number;
  clickableToken?: ClickableToken | null;
}

export interface MarkdownEditorCommandContext {
  editor: MarkdownTextEditorFacade;
  view: MarkdownView;
}

const MAX_HISTORY = 100;

/** Command-local text state, not a browser EditorView or a raw extension host. */
export class MarkdownTextEditorFacade implements Editor {
  private localState: EditorState;
  protected get state(): EditorState { return this.localState; }
  private past: EditorState[] = [];
  private future: EditorState[] = [];
  private clickableToken: ClickableToken | null = null;

  constructor(input: MarkdownEditorContextInput) {
    const end = input.content.length;
    const fallback = clampOffset(input.cursorOffset ?? end, end);
    const anchor = clampOffset(input.selectionStart ?? fallback, end);
    const head = clampOffset(input.selectionEnd ?? anchor, end);
    this.localState = EditorState.create({
      doc: input.content,
      selection: CMSelection.single(anchor, head),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        // Do not silently normalize CRLF/mixed line endings when a plugin runs.
        EditorState.lineSeparator.of('\n'),
      ],
    });
    this.clickableToken = normalizeClickableToken(input.clickableToken);
  }

  getDoc(): this { return this; }

  getValue(): string { return this.state.doc.toString(); }

  setValue(value: string): void {
    const text = String(value);
    this.commit(this.state.update({
      changes: { from: 0, to: this.state.doc.length, insert: text },
      selection: CMSelection.single(text.length),
    }));
  }

  getSelection(): string {
    const { from, to } = this.state.selection.main;
    return this.state.doc.sliceString(from, to);
  }

  somethingSelected(): boolean {
    return this.state.selection.ranges.some(range => !range.empty);
  }

  listSelections(): EditorSelection[] {
    return this.state.selection.ranges.map(({ anchor, head }) => ({
      anchor: this.offsetToPos(anchor), head: this.offsetToPos(head),
    }));
  }

  setSelections(ranges: EditorSelectionOrCaret[], main = 0): void {
    this.assertCanEdit();
    this.commit(this.state.update({ selection: selectionFor(this.state.doc, ranges, main) }));
  }

  replaceSelection(replacement: string, _origin?: string): void {
    void _origin; // Origin-tagged browser events are not part of this command-local host.
    this.commit(this.state.update(this.state.replaceSelection(replacement)));
  }

  getCursor(which: 'from' | 'to' | 'anchor' | 'head' = 'head'): EditorPosition {
    return this.offsetToPos(this.state.selection.main[which]);
  }

  getClickableTokenAt(_position: EditorPosition): ClickableToken | null {
    void _position;
    return this.clickableToken ? { ...this.clickableToken } : null;
  }

  setClickableToken(token: ClickableToken | null | undefined): void {
    this.clickableToken = normalizeClickableToken(token);
  }

  setCursor(posOrLine: EditorPosition | number, ch?: number): void {
    this.setSelection(typeof posOrLine === 'number' ? { line: posOrLine, ch: ch ?? 0 } : posOrLine);
  }

  setSelection(anchor: EditorPosition, head = anchor): void {
    this.setSelections([{ anchor, head }]);
  }

  lineCount(): number { return this.state.doc.lines; }

  lastLine(): number { return this.lineCount() - 1; }

  getLine(line: number): string {
    return Number.isInteger(line) && line >= 0 && line < this.lineCount()
      ? this.state.doc.line(line + 1).text : '';
  }

  setLine(line: number, text: string): void {
    if (!Number.isInteger(line) || line < 0 || line >= this.lineCount()) return;
    const previous = this.state.doc.line(line + 1);
    const insert = String(text);
    this.commit(this.state.update({
      changes: { from: previous.from, to: previous.to, insert },
      selection: CMSelection.single(previous.from + insert.length),
    }));
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    return this.state.doc.sliceString(Math.min(start, end), Math.max(start, end));
  }

  replaceRange(replacement: string, from: EditorPosition, to = from, _origin?: string): void {
    void _origin;
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    const changes = this.state.changes({ from: Math.min(start, end), to: Math.max(start, end), insert: replacement });
    this.commit(this.state.update({
      changes, selection: this.state.selection.map(changes, 1),
    }));
  }

  posToOffset(position: EditorPosition): number {
    return positionToOffset(this.state.doc, position);
  }

  offsetToPos(offset: number): EditorPosition {
    const safe = clampOffset(offset, this.state.doc.length);
    const line = this.state.doc.lineAt(safe);
    return { line: line.number - 1, ch: safe - line.from };
  }

  transaction(tx: EditorTransaction, _origin?: string): void {
    void _origin;
    const changes = (tx.changes ?? []).map(change => {
      if (typeof change.text !== 'string') throw new TypeError('Editor change text must be a string.');
      const from = this.posToOffset(change.from);
      const to = change.to ? this.posToOffset(change.to) : from;
      if (to < from) throw new RangeError('Editor change ends before it starts.');
      return { from, to, insert: change.text };
    });
    if (tx.replaceSelection !== undefined) {
      if (typeof tx.replaceSelection !== 'string') throw new TypeError('Editor replacement must be a string.');
      changes.push(...this.state.selection.ranges.map(({ from, to }) => ({
        from, to, insert: tx.replaceSelection!,
      })));
    }
    changes.sort((a, b) => a.from - b.from || a.to - b.to);
    for (let index = 1; index < changes.length; index++) {
      if (changes[index].from < changes[index - 1].to) {
        throw new RangeError('Overlapping editor changes cannot be applied atomically.');
      }
    }
    const changeSet = this.state.changes(changes);
    const mapped = tx.replaceSelection !== undefined
      ? CMSelection.create(this.state.selection.ranges.map(range =>
        CMSelection.cursor(changeSet.mapPos(range.to, 1))), this.state.selection.mainIndex)
      : this.state.selection.map(changeSet, 1);
    let selection = mapped;
    const selections = tx.selections ?? (tx.selection ? [tx.selection] : undefined);
    if (selections) {
      selection = selectionFor(changeSet.apply(this.state.doc), selections.map(range => ({
        anchor: range.from, head: range.to,
      })));
    }
    // All validation (including selection coordinates) happens before committing.
    this.commit(this.state.update({ changes: changeSet, selection }));
  }

  undo(): void {
    this.assertCanEdit();
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state);
    this.localState = previous;
  }

  redo(): void {
    this.assertCanEdit();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state);
    this.localState = next;
  }

  protected commit(transaction: Transaction): void {
    this.assertCanEdit();
    const next = transaction.state;
    if (!next.doc.eq(this.state.doc)) {
      this.past.push(this.state);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
    }
    this.localState = next;
  }

  protected assertCanEdit(): void {}
}

/** Workspace inspection must not acquire command-scoped mutation authority. */
export class ReadonlyMarkdownEditorFacade extends MarkdownTextEditorFacade {
  constructor(private readonly file: TFile, content: string) {
    super({ content, cursorOffset: 0 });
  }

  protected override assertCanEdit(): void {
    throw new Error(`Active MarkdownView editor for "${this.file.path}" is read-only outside editor command execution.`);
  }
}

export function createMarkdownEditorCommandContext(
  file: TFile,
  input: MarkdownEditorContextInput,
): MarkdownEditorCommandContext {
  const editor = new MarkdownTextEditorFacade(input);
  return { editor, view: { file, editor, getViewType: () => 'markdown' } };
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return length;
  return Math.max(0, Math.min(Math.trunc(offset), length));
}

function positionToOffset(doc: Text, position: EditorPosition): number {
  if (!position || !Number.isFinite(position.line) || !Number.isFinite(position.ch)) {
    throw new RangeError('Editor positions require finite line and ch coordinates.');
  }
  const line = doc.line(Math.max(0, Math.min(Math.trunc(position.line), doc.lines - 1)) + 1);
  return line.from + Math.max(0, Math.min(Math.trunc(position.ch), line.length));
}

function selectionFor(doc: Text, ranges: EditorSelectionOrCaret[], main = 0): CMSelection {
  if (!Array.isArray(ranges) || ranges.length === 0) throw new RangeError('At least one editor selection is required.');
  if (!Number.isInteger(main) || main < 0 || main >= ranges.length) throw new RangeError('Invalid primary editor selection.');
  return CMSelection.create(ranges.map(range => CMSelection.range(
    positionToOffset(doc, range.anchor), positionToOffset(doc, range.head ?? range.anchor),
  )), main);
}

function normalizeClickableToken(token: ClickableToken | null | undefined): ClickableToken | null {
  if (!token) return null;
  const text = token.text.trim();
  const type = token.type.trim();
  if (!text || !type) return null;
  return {
    type, text,
    ...(token.start ? { start: { ...token.start } } : {}),
    ...(token.end ? { end: { ...token.end } } : {}),
  };
}
