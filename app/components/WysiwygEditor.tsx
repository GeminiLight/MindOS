'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table';
import { TableHeader } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';

interface WysiwygEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

export default function WysiwygEditor({ value, onChange }: WysiwygEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: 'not-prose' } },
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none wysiwyg-editor',
      },
    },
    onUpdate({ editor }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText();
      onChangeRef.current(md);
    },
    immediatelyRender: false,
  });

  // Sync external value changes (e.g. cancel → revert) without full re-mount
  const lastMd = useRef(value);
  useEffect(() => {
    if (!editor || value === lastMd.current) return;
    lastMd.current = value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (editor.storage as any).markdown?.getMarkdown?.() ?? '';
    if (current !== value) {
      editor.commands.setContent(value);
    }
  }, [editor, value]);

  return (
    <div className="wysiwyg-wrapper h-full overflow-y-auto px-8 py-6">
      <EditorContent editor={editor} />
    </div>
  );
}
