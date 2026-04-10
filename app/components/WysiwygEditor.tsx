'use client';

import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table';
import { TableHeader } from '@tiptap/extension-table';
import { Markdown } from 'tiptap-markdown';
import { useEditorImageUpload } from '@/hooks/useEditorImageUpload';
import { resolveImagePath } from '@/lib/image';
import { toast } from '@/lib/toast';

/**
 * Custom Image extension that resolves `/.media/` paths to API URLs in the DOM,
 * while keeping the raw path in the markdown serialization.
 */
const ResolvedImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src = HTMLAttributes.src;
    const resolvedSrc = typeof src === 'string' ? resolveImagePath(src) : src;
    return ['img', { ...HTMLAttributes, src: resolvedSrc }];
  },
});

interface WysiwygEditorProps {
  value: string;
  onChange: (markdown: string) => void;
}

export default function WysiwygEditor({ value, onChange }: WysiwygEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { uploadToMedia, isUploading } = useEditorImageUpload();
  const uploadRef = useRef(uploadToMedia);
  uploadRef.current = uploadToMedia;

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
      ResolvedImage.configure({
        HTMLAttributes: { class: 'rounded-md max-w-full' },
      }),
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

  // Set up drag/drop and paste handlers on editor mount
  useEffect(() => {
    if (!editor) return;

    const editorDom = editor.view.dom;

    const handleImageInsert = async (files: File[]) => {
      if (!editor) return;
      try {
        const uploadedPaths = await uploadRef.current(files);
        for (const p of uploadedPaths) {
          editor.chain().focus().setImage({ src: p }).run();
        }
        toast.success('Images inserted');
      } catch (err) {
        toast.error('Failed to insert images');
        console.error(err);
      }
    };

    const handleDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleImageInsert(files);
      }
    };

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
        handleImageInsert(files);
      }
    };

    editorDom.addEventListener('drop', handleDrop as EventListener);
    editorDom.addEventListener('paste', handlePaste as EventListener);

    return () => {
      editorDom.removeEventListener('drop', handleDrop as EventListener);
      editorDom.removeEventListener('paste', handlePaste as EventListener);
    };
  }, [editor]);

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
      {isUploading && (
        <div className="fixed inset-0 overlay-backdrop flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg px-6 py-4 text-center shadow-lg">
            <div className="animate-spin inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
            <p className="mt-2 text-sm text-muted-foreground">Uploading images...</p>
          </div>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
