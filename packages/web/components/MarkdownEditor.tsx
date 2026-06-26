'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo } from 'react';
import EditorWrapper from './EditorWrapper';
import {
  composeMarkdownFrontmatter,
  hasMarkdownFrontmatterFence,
  splitMarkdownFrontmatter,
} from '@/lib/parsing/frontmatter';
import type { BrowserEditorSandboxContribution } from '@/lib/obsidian-compat/browser-editor-sandbox';

// WysiwygEditor uses browser APIs — load client-side only
const WysiwygEditor = dynamic(() => import('./WysiwygEditor'), { ssr: false });

export type MdViewMode = 'wysiwyg' | 'split' | 'source' | 'preview';

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  viewMode: MdViewMode;
  editorKey?: string;
  sourcePath?: string;
  sandboxContributions?: BrowserEditorSandboxContribution[];
}

const EDITOR_HEIGHT = 'calc(100vh - 160px)';

export default function MarkdownEditor({
  value,
  onChange,
  viewMode,
  editorKey,
  sourcePath = '',
  sandboxContributions = [],
}: MarkdownEditorProps) {
  const parsedFrontmatter = useMemo(() => splitMarkdownFrontmatter(value), [value]);
  const hasFrontmatterFence = hasMarkdownFrontmatterFence(value);
  const hasSafeFrontmatter = parsedFrontmatter.frontmatter !== null;
  const isWysiwyg = viewMode === 'wysiwyg' && (!hasFrontmatterFence || hasSafeFrontmatter);
  const isSource = viewMode === 'source' || (viewMode === 'wysiwyg' && hasFrontmatterFence && !hasSafeFrontmatter);
  const wysiwygValue = hasSafeFrontmatter ? parsedFrontmatter.body : value;
  const handleWysiwygChange = useCallback((markdownBody: string) => {
    onChange(parsedFrontmatter.frontmatter
      ? composeMarkdownFrontmatter(parsedFrontmatter.frontmatter, markdownBody)
      : markdownBody);
  }, [onChange, parsedFrontmatter.frontmatter]);

  return (
    <>
      {/* Keep valid frontmatter out of Milkdown's normalization path, then splice it back unchanged. */}
      {isWysiwyg && (
        <div className="min-h-[50vh] min-w-0">
          <WysiwygEditor key={editorKey ?? 'wysiwyg'} value={wysiwygValue} onChange={handleWysiwygChange} sourcePath={sourcePath} />
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
