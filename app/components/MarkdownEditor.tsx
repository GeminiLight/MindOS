'use client';

import dynamic from 'next/dynamic';
import { Columns2, PanelLeft, Eye, Pencil } from 'lucide-react';
import EditorWrapper from './EditorWrapper';
import MarkdownView from './MarkdownView';

// WysiwygEditor uses browser APIs — load client-side only
const WysiwygEditor = dynamic(() => import('./WysiwygEditor'), { ssr: false });

export type MdViewMode = 'wysiwyg' | 'split' | 'source' | 'preview';

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  viewMode: MdViewMode;
  onViewModeChange: (m: MdViewMode) => void;
}

const MODES: { id: MdViewMode; icon: React.ReactNode; label: string }[] = [
  { id: 'wysiwyg',  icon: <Pencil size={12} />,   label: 'WYSIWYG' },
  { id: 'split',    icon: <Columns2 size={12} />,  label: 'Split' },
  { id: 'source',   icon: <PanelLeft size={12} />, label: 'Source' },
  { id: 'preview',  icon: <Eye size={12} />,       label: 'Preview' },
];

const EDITOR_HEIGHT = 'calc(100vh - 160px)';

export default function MarkdownEditor({ value, onChange, viewMode, onViewModeChange }: MarkdownEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Mode toolbar */}
      <div className="flex items-center gap-1 p-1 bg-muted rounded-lg self-start">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => onViewModeChange(m.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors font-display ${
              viewMode === m.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {/* Panes */}
      <div
        className="rounded-xl overflow-hidden border border-border flex"
        style={{ height: EDITOR_HEIGHT }}
      >
        {/* WYSIWYG */}
        {viewMode === 'wysiwyg' && (
          <div className="w-full h-full overflow-hidden">
            <WysiwygEditor value={value} onChange={onChange} />
          </div>
        )}

        {/* Split: source left + preview right */}
        {viewMode === 'split' && (
          <>
            <div className="w-1/2 h-full overflow-auto border-r border-border">
              <EditorWrapper value={value} onChange={onChange} language="markdown" />
            </div>
            <div className="w-1/2 h-full overflow-auto bg-background">
              <div className="px-6 py-5">
                <MarkdownView content={value} />
              </div>
            </div>
          </>
        )}

        {/* Source only */}
        {viewMode === 'source' && (
          <div className="w-full h-full overflow-auto">
            <EditorWrapper value={value} onChange={onChange} language="markdown" />
          </div>
        )}

        {/* Preview only */}
        {viewMode === 'preview' && (
          <div className="w-full h-full overflow-auto bg-background">
            <div className="px-6 py-5">
              <MarkdownView content={value} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
