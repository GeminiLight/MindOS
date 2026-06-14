import type { Editor, EditorPosition, MarkdownView, TFile } from './types';

export interface MarkdownEditorContextInput {
  content: string;
  selectionStart?: number;
  selectionEnd?: number;
  cursorOffset?: number;
}

export interface MarkdownEditorCommandContext {
  editor: MarkdownTextEditorFacade;
  view: MarkdownView;
}

export class MarkdownTextEditorFacade implements Editor {
  private content: string;
  private selectionStart = 0;
  private selectionEnd = 0;

  constructor(input: MarkdownEditorContextInput) {
    this.content = input.content;
    const fallbackOffset = clampOffset(
      typeof input.cursorOffset === 'number' ? input.cursorOffset : this.content.length,
      this.content,
    );
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : fallbackOffset;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
    this.setSelectionOffsets(start, end);
  }

  getValue(): string {
    return this.content;
  }

  setValue(value: string): void {
    this.content = String(value);
    const end = this.content.length;
    this.setSelectionOffsets(end, end);
  }

  getSelection(): string {
    return this.content.slice(this.selectionStart, this.selectionEnd);
  }

  replaceSelection(replacement: string): void {
    this.replaceOffsets(this.selectionStart, this.selectionEnd, replacement);
  }

  getCursor(which?: 'from' | 'to' | 'anchor' | 'head'): EditorPosition {
    const offset = which === 'from' || which === 'anchor' ? this.selectionStart : this.selectionEnd;
    return offsetToPosition(this.content, offset);
  }

  setCursor(posOrLine: EditorPosition | number, ch?: number): void {
    const offset = typeof posOrLine === 'number'
      ? positionToOffset(this.content, { line: posOrLine, ch: ch ?? 0 })
      : positionToOffset(this.content, posOrLine);
    this.setSelectionOffsets(offset, offset);
  }

  setSelection(anchor: EditorPosition, head?: EditorPosition): void {
    const start = positionToOffset(this.content, anchor);
    const end = positionToOffset(this.content, head ?? anchor);
    this.setSelectionOffsets(start, end);
  }

  lineCount(): number {
    return this.lines().length;
  }

  getLine(line: number): string {
    return this.lines()[line] ?? '';
  }

  setLine(line: number, text: string): void {
    const lines = this.lines();
    if (line < 0 || line >= lines.length) return;
    lines[line] = String(text);
    this.content = lines.join('\n');
    const cursor = positionToOffset(this.content, { line, ch: lines[line]?.length ?? 0 });
    this.setSelectionOffsets(cursor, cursor);
  }

  getRange(from: EditorPosition, to: EditorPosition): string {
    const start = positionToOffset(this.content, from);
    const end = positionToOffset(this.content, to);
    return this.content.slice(Math.min(start, end), Math.max(start, end));
  }

  replaceRange(replacement: string, from: EditorPosition, to?: EditorPosition): void {
    const start = positionToOffset(this.content, from);
    const end = to ? positionToOffset(this.content, to) : start;
    this.replaceOffsets(Math.min(start, end), Math.max(start, end), replacement);
  }

  private lines(): string[] {
    return this.content.split('\n');
  }

  private replaceOffsets(start: number, end: number, replacement: string): void {
    const safeStart = clampOffset(start, this.content);
    const safeEnd = clampOffset(end, this.content);
    const from = Math.min(safeStart, safeEnd);
    const to = Math.max(safeStart, safeEnd);
    this.content = `${this.content.slice(0, from)}${replacement}${this.content.slice(to)}`;
    const nextCursor = from + replacement.length;
    this.setSelectionOffsets(nextCursor, nextCursor);
  }

  private setSelectionOffsets(start: number, end: number): void {
    const safeStart = clampOffset(start, this.content);
    const safeEnd = clampOffset(end, this.content);
    this.selectionStart = Math.min(safeStart, safeEnd);
    this.selectionEnd = Math.max(safeStart, safeEnd);
  }
}

export function createMarkdownEditorCommandContext(
  file: TFile,
  input: MarkdownEditorContextInput,
): MarkdownEditorCommandContext {
  const editor = new MarkdownTextEditorFacade(input);
  return {
    editor,
    view: {
      file,
      editor,
      getViewType: () => 'markdown',
    },
  };
}

function clampOffset(offset: number, content: string): number {
  if (!Number.isFinite(offset)) return content.length;
  return Math.max(0, Math.min(Math.trunc(offset), content.length));
}

function offsetToPosition(content: string, offset: number): EditorPosition {
  const safeOffset = clampOffset(offset, content);
  const before = content.slice(0, safeOffset);
  const lines = before.split('\n');
  return {
    line: lines.length - 1,
    ch: lines[lines.length - 1]?.length ?? 0,
  };
}

function positionToOffset(content: string, position: EditorPosition): number {
  const lines = content.split('\n');
  const line = Math.max(0, Math.min(Math.trunc(position.line), lines.length - 1));
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }
  const ch = Math.max(0, Math.min(Math.trunc(position.ch), lines[line]?.length ?? 0));
  return offset + ch;
}
