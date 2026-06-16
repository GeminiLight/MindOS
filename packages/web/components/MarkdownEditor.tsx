'use client';

import dynamic from 'next/dynamic';
import EditorWrapper from './EditorWrapper';
import { hasMarkdownFrontmatterFence } from '@/lib/parsing/frontmatter';

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
  const hasFrontmatter = hasMarkdownFrontmatterFence(value);
  const isWysiwyg = viewMode === 'wysiwyg' && !hasFrontmatter;
  const isSource = viewMode === 'source' || (viewMode === 'wysiwyg' && hasFrontmatter);

  return (
    <>
      {/* WYSIWYG normalizes markdown on mount, so do not mount it for YAML frontmatter notes. */}
      {!hasFrontmatter && (
        <div className="min-h-[50vh] min-w-0" style={{ display: isWysiwyg ? undefined : 'none' }}>
          <WysiwygEditor value={value} onChange={onChange} />
        </div>
      )}

      {/* Source: bordered editor container */}
      {isSource && (
        <div
          className="min-w-0 rounded-xl overflow-hidden border border-border flex"
          style={{ height: EDITOR_HEIGHT }}
        >
          <div className="min-w-0 w-full h-full overflow-y-auto overflow-x-hidden">
            <EditorWrapper value={value} onChange={onChange} language="markdown" />
          </div>
        </div>
      )}
    </>
  );
}
