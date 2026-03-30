'use client';

import { X, FileText, Table, Paperclip } from 'lucide-react';

interface FileChipProps {
  path: string;
  onRemove: () => void;
  variant?: 'kb' | 'upload';
}

export default function FileChip({ path, onRemove, variant = 'kb' }: FileChipProps) {
  const name = path.split('/').pop() ?? path;
  const isCsv = name.endsWith('.csv');
  const Icon = variant === 'upload' ? Paperclip : isCsv ? Table : FileText;
  const iconClass = variant === 'upload' ? 'text-muted-foreground' : isCsv ? 'text-success' : 'text-muted-foreground';

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border border-border bg-muted text-foreground max-w-[220px]">
      <Icon size={11} className={`${iconClass} shrink-0`} />
      <span className="truncate" title={path}>{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="p-1 -mr-1 rounded hover:bg-muted hover:text-foreground transition-colors shrink-0"
      >
        <X size={10} />
      </button>
    </span>
  );
}
