'use client';

import dynamic from 'next/dynamic';
import EditorWrapper from './EditorWrapper';
import { hasMarkdownFrontmatterFence } from '@/lib/parsing/frontmatter';
import type { BrowserEditorSandboxContribution } from '@/lib/obsidian-compat/browser-editor-sandbox';

// WysiwygEditor uses browser APIs — load client-side only
const WysiwygEditor = dynamic(() => import('./WysiwygEditor'), { ssr: false });

export type MdViewMode = 'wysiwyg' | 'split' | 'source' | 'preview';

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  viewMode: MdViewMode;
  editorKey?: string;
  sandboxContributions?: BrowserEditorSandboxContribution[];
}

const EDITOR_HEIGHT = 'calc(100vh - 160px)';

export default function MarkdownEditor({
  value,
  onChange,
  viewMode,
  editorKey,
  sandboxContributions = [],
}: MarkdownEditorProps) {
  const hasFrontmatter = hasMarkdownFrontmatterFence(value);
  const isWysiwyg = viewMode === 'wysiwyg' && !hasFrontmatter;
  const isSource = viewMode === 'source' || (viewMode === 'wysiwyg' && hasFrontmatter);

  return (
    <>
      {/* WYSIWYG normalizes markdown on mount; keep it off the path for frontmatter/source notes. */}
      {isWysiwyg && (
        <div className="min-h-[50vh] min-w-0">
          <WysiwygEditor key={editorKey ?? 'wysiwyg'} value={value} onChange={onChange} />
        </div>
      )}

      {/* Source: bordered editor container */}
      {isSource && (
        <div
          className="min-w-0 rounded-xl overflow-hidden border border-border flex"
          style={{ height: EDITOR_HEIGHT }}
        >
          <div className="min-w-0 w-full h-full overflow-y-auto overflow-x-hidden">
            <EditorWrapper
              value={value}
              onChange={onChange}
              language="markdown"
              sandboxContributions={sandboxContributions}
            />
          </div>
        </div>
      )}
    </>
  );
}
