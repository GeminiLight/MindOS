import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppShim } from '@/lib/obsidian-compat/shims/app';
import type { Editor } from '@/lib/obsidian-compat/types';

let root: string;
let editor: Editor;

describe('Workspace read-only editor boundary', () => {
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mindos-readonly-editor-'));
    const app = new AppShim(root);
    const file = await app.vault.create('note.md', 'one\ntwo');
    await app.withActiveFile(file, async () => {
      editor = app.workspace.activeEditor!.editor;
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('exposes text inspection helpers without granting editor command permissions', () => {
    expect(editor.getDoc()).toBe(editor);
    expect(editor.lastLine()).toBe(1);
    expect(editor.posToOffset({ line: 1, ch: 1 })).toBe(5);
    expect(editor.offsetToPos(5)).toEqual({ line: 1, ch: 1 });
    expect(editor.listSelections()).toEqual([{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }]);
    expect(editor.somethingSelected()).toBe(false);
  });

  it('rejects every mutation including empty transactions and history operations', () => {
    const mutations = [
      () => editor.setValue('no'),
      () => editor.replaceSelection('no'),
      () => editor.replaceRange('no', { line: 0, ch: 0 }),
      () => editor.setLine(0, 'no'),
      () => editor.setCursor(1),
      () => editor.setSelection({ line: 0, ch: 0 }),
      () => editor.setSelections([{ anchor: { line: 0, ch: 0 } }]),
      () => editor.transaction({}),
      () => editor.undo(),
      () => editor.redo(),
    ];
    for (const mutate of mutations) expect(mutate).toThrow(/read-only outside editor command/);
    expect(editor.getValue()).toBe('one\ntwo');
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('one\ntwo');
  });
});
