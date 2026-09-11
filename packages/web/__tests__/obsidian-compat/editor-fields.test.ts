import { describe, expect, it } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import {
  editorEditorField,
  editorInfoField,
  editorLivePreviewField,
} from '@/lib/obsidian-compat/shims/editor-fields';
import { createObsidianModule } from '@/lib/obsidian-compat/shims/obsidian';

describe('obsidian editor field shims', () => {
  it('exposes real CodeMirror 6 StateField instances with distinct identities', () => {
    expect(editorInfoField).toBeInstanceOf(StateField);
    expect(editorEditorField).toBeInstanceOf(StateField);
    expect(editorLivePreviewField).toBeInstanceOf(StateField);
    expect(editorInfoField).not.toBe(editorEditorField);
    expect(editorLivePreviewField).not.toBe(editorEditorField);
  });

  it('defaults to a null editor context and inactive live preview in the server tier', () => {
    const state = EditorState.create({
      doc: '',
      extensions: [editorInfoField, editorEditorField, editorLivePreviewField],
    });
    expect(state.field(editorInfoField)).toBeNull();
    expect(state.field(editorEditorField)).toBeNull();
    expect(state.field(editorLivePreviewField)).toBe(false);
  });

  it('keeps the defaults stable across transactions', () => {
    const state = EditorState.create({
      doc: 'hello',
      extensions: [editorInfoField, editorEditorField, editorLivePreviewField],
    });
    const next = state.update({ changes: { from: 5, insert: ' world' } }).state;
    expect(next.field(editorInfoField)).toBeNull();
    expect(next.field(editorEditorField)).toBeNull();
    expect(next.field(editorLivePreviewField)).toBe(false);
  });

  it('registers the fields on the obsidian module with stable identity', () => {
    const obsidian = createObsidianModule();
    expect(obsidian.editorInfoField).toBe(editorInfoField);
    expect(obsidian.editorEditorField).toBe(editorEditorField);
    expect(obsidian.editorLivePreviewField).toBe(editorLivePreviewField);
  });
});
