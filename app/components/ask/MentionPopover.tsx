'use client';

import { useEffect, useRef } from 'react';
import { FileText, Table, FolderOpen } from 'lucide-react';
import HighlightMatch from './HighlightMatch';

interface MentionPopoverProps {
  results: string[];
  selectedIndex: number;
  query?: string;
  onSelect: (filePath: string) => void;
}

export default function MentionPopover({ results, selectedIndex, query, onSelect }: MentionPopoverProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (results.length === 0) return null;

  return (
    <div className="border border-border rounded-lg bg-card shadow-lg overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border flex items-center gap-1.5">
        <FolderOpen size={11} className="text-muted-foreground/50" />
        <span className="text-2xs font-medium text-muted-foreground/70 uppercase tracking-wider">Files</span>
        <span className="text-2xs text-muted-foreground/40 ml-auto">{results.length}</span>
      </div>
      <div ref={listRef} className="max-h-[360px] overflow-y-auto">
      {results.map((f, idx) => {
        const name = f.split('/').pop() ?? f;
        const dir = f.split('/').slice(0, -1).join('/');
        const isCsv = name.endsWith('.csv');
        return (
          <button
            key={f}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(f);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
              idx === selectedIndex
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {isCsv ? (
              <Table size={13} className="text-success shrink-0" />
            ) : (
              <FileText size={13} className="text-muted-foreground shrink-0" />
            )}
            <span className="truncate font-medium flex-1" title={name}><HighlightMatch text={name} query={query} /></span>
            {dir && (
              <span className="text-2xs text-muted-foreground/40 truncate max-w-[140px] shrink-0" title={dir}>
                <HighlightMatch text={dir} query={query} />
              </span>
            )}
          </button>
        );
      })}
      </div>
      <div className="px-3 py-1.5 border-t border-border flex gap-3 text-2xs text-muted-foreground/40 shrink-0">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>ESC dismiss</span>
      </div>
    </div>
  );
}
