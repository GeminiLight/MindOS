'use client';

import dynamic from 'next/dynamic';
import EditorWrapper from './EditorWrapper';

// WysiwygEditor uses browser APIs — load client-side only
const WysiwygEditor = dynamic(() => import('./WysiwygEditor'), { ssr: false });

export type MdViewMode = 'wysiwyg' | 'split' | 'source' | 'preview';

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  viewMode: MdViewMode;
}

const EDITOR_HEIGHT = 'calc(100vh - 160px)';

export default function MarkdownEditor({ value, onChange, viewMode }: MarkdownEditorProps) {
  const isWysiwyg = viewMode === 'wysiwyg';

  return (
    <>
      {/* WYSIWYG: always mounted, hidden when not active to preserve editor state */}
      <div className="min-h-[50vh]" style={{ display: isWysiwyg ? undefined : 'none' }}>
        <WysiwygEditor value={value} onChange={onChange} />
      </div>

      {/* Source: bordered editor container */}
      {viewMode === 'source' && (
        <div
          className="rounded-xl overflow-hidden border border-border flex"
          style={{ height: EDITOR_HEIGHT }}
        >
          <div className="w-full h-full overflow-auto">
            <EditorWrapper value={value} onChange={onChange} language="markdown" />
          </div>
        </div>
      )}
    </>
  );
}
