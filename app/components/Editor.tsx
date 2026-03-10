'use client';

import { useEffect, useRef, useCallback } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: 'markdown' | 'plain';
}

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#09090b',
    height: '100%',
    fontSize: '0.875rem',
    fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '16px',
    caretColor: '#60a5fa',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-line': {
    padding: '0 4px',
  },
  '.cm-gutters': {
    backgroundColor: '#0d0d0f',
    borderRight: '1px solid #27272a',
    color: '#52525b',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#18181b',
  },
  '.cm-activeLine': {
    backgroundColor: '#18181b50',
  },
  '.cm-selectionBackground': {
    backgroundColor: '#2563eb40',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: '#2563eb60',
  },
  '.cm-cursor': {
    borderLeftColor: '#60a5fa',
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
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden rounded-lg border border-zinc-800"
      style={{ minHeight: '400px' }}
    />
  );
}
