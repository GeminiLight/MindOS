import { StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { MarkdownView } from '../types';

/**
 * Minimal `MarkdownFileInfo` shape from the official API: the editor context a
 * Markdown editor exposes through `editorInfoField`. The server tier never
 * produces one, so the field reads as null until an editor host exists.
 */
export type MarkdownFileInfo = Pick<MarkdownView, 'file' | 'editor'> & {
  app?: unknown;
};

/**
 * Server-tier editor context fields.
 *
 * These are real CodeMirror 6 `StateField` instances so plugins can compose
 * them into headless `EditorState`s. Unlike the browser host
 * (`browser-host/editor-context.ts`), whose fields throw until the host
 * installs a live editor context, the server tier defaults to null because no
 * editor context will ever be attached: `state.field(editorInfoField)` reads
 * as null, and live preview reports as inactive.
 */
export const editorInfoField = StateField.define<MarkdownFileInfo | null>({
  create: () => null,
  update: (value) => value,
});

export const editorEditorField = StateField.define<EditorView | null>({
  create: () => null,
  update: (value) => value,
});

export const editorLivePreviewField = StateField.define<boolean>({
  create: () => false,
  update: (value) => value,
});
