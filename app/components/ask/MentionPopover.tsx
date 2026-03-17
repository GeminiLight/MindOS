'use client';

import { FileText, Table } from 'lucide-react';

interface MentionPopoverProps {
  results: string[];
  selectedIndex: number;
  onSelect: (filePath: string) => void;
}

export default function MentionPopover({ results, selectedIndex, onSelect }: MentionPopoverProps) {
  if (results.length === 0) return null;

  return (
    <div className="mx-4 mb-1 border border-border rounded-lg bg-card shadow-lg overflow-hidden">
      {results.map((f, idx) => {
        const name = f.split('/').pop() ?? f;
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
            <span className="truncate flex-1">{name}</span>
            <span className="text-2xs text-muted-foreground/50 truncate max-w-[140px] shrink-0">
              {f.split('/').slice(0, -1).join('/')}
            </span>
          </button>
        );
      })}
      <div className="px-3 py-1.5 border-t border-border flex gap-3 text-2xs text-muted-foreground/50">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>ESC dismiss</span>
      </div>
    </div>
  );
}
