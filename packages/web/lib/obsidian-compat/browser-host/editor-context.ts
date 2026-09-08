import { StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { LiveMarkdownEditor } from './live-editor';

type MarkdownFileInfo = Readonly<{ app: unknown; editor: LiveMarkdownEditor; file: Readonly<{ path: string }> }>;
const missingContext = (): never => { throw new Error('An Obsidian editor context must be supplied by the host.'); };
/** Actual CM6 fields; each host installs them with its own view/file context. */
export const editorInfoField = StateField.define<MarkdownFileInfo>({ create: missingContext, update: value => value });
export const editorEditorField = StateField.define<EditorView>({ create: missingContext, update: value => value });
// The current host is a source-mode editor, not an in-document Live Preview renderer.
export const editorLivePreviewField = StateField.define<boolean>({ create: () => false, update: value => value });
