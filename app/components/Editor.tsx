'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';
import { Image as ImageIcon } from 'lucide-react';
import { useEditorImageUpload } from '@/hooks/useEditorImageUpload';
import { toast } from '@/lib/toast';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'markdown' | 'plain';
}

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    height: '100%',
    fontSize: '0.875rem',
    fontFamily: 'var(--font-ibm-plex-mono), ui-monospace, monospace',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '16px',
    caretColor: 'var(--amber)',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-line': {
    padding: '0 4px',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--card)',
    borderRight: '1px solid var(--border)',
    color: 'var(--muted-foreground)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--muted)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--muted) 50%, transparent)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--amber) 25%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--amber) 38%, transparent)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--amber)',
    borderLeftWidth: '2px',
  },
});

export default function Editor({ value, onChange, language = 'markdown' }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Track whether update is from external value change
  const isExternalUpdate = useRef(false);

  const { uploadToMedia, isUploading } = useEditorImageUpload();
  const uploadRef = useRef(uploadToMedia);
  uploadRef.current = uploadToMedia;
  const [isMarkdown] = useState(language === 'markdown');

  // Stable image insertion function via ref
  const insertImagesRef = useRef(async (files: File[]) => {});
  insertImagesRef.current = async (files: File[]) => {
    const view = viewRef.current;
    if (!view) return;

    try {
      const uploadedPaths = await uploadRef.current(files);

      for (const p of uploadedPaths) {
        const md = `![image](${p})\n`;
        view.dispatch({
          changes: {
            from: view.state.selection.main.head,
            insert: md,
          },
        });
      }

      toast.success('Images inserted');
    } catch (err) {
      toast.error('Failed to insert images');
      console.error(err);
    }
  };

  // Handle file picker (image button click)
  const handlePickImages = useCallback(() => {
    if (!isMarkdown) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*';
    input.onchange = (e) => {
      const files = Array.from((e.target as HTMLInputElement).files ?? []);
      if (files.length > 0) {
        insertImagesRef.current(files);
      }
    };
    input.click();
  }, [isMarkdown]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !isExternalUpdate.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        darkTheme,
        language === 'markdown' ? markdown() : [],
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set up paste and drag/drop handlers
  useEffect(() => {
    if (!isMarkdown) return;

    const container = containerRef.current;
    if (!container) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        e.preventDefault();
        insertImagesRef.current(files);
      }
    };

    const handleDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        insertImagesRef.current(files);
      }
    };

    container.addEventListener('paste', handlePaste as EventListener);
    container.addEventListener('drop', handleDrop as EventListener);

    return () => {
      container.removeEventListener('paste', handlePaste as EventListener);
      container.removeEventListener('drop', handleDrop as EventListener);
    };
  }, [isMarkdown]);

  // Sync external value changes to editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      isExternalUpdate.current = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
      isExternalUpdate.current = false;
    }
  }, [value]);

  return (
    <div className="relative h-full w-full flex flex-col">
      {/* Image insert button for markdown mode */}
      {isMarkdown && (
        <div className="px-2 py-1.5 border-b border-border bg-card/50 flex items-center gap-1">
          <button
            onClick={handlePickImages}
            disabled={isUploading}
            className="p-1.5 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Insert images (Ctrl+V or drag & drop)"
          >
            <ImageIcon size={14} />
            <span>Images</span>
          </button>
          {isUploading && (
            <span className="text-xs text-muted-foreground ml-2">Uploading...</span>
          )}
        </div>
      )}

      {/* Editor container */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden rounded-lg border border-border"
        style={{ minHeight: '400px' }}
      />
    </div>
  );
}
