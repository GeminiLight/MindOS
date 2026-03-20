'use client';

import Link from 'next/link';
import { ChevronRight, Home, FileText, Table, Folder } from 'lucide-react';

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (ext === '.csv') return <Table size={13} className="text-success shrink-0" />;
  if (ext) return <FileText size={13} className="text-muted-foreground shrink-0" />;
  return <Folder size={13} className="text-yellow-400 shrink-0" />;
}

export default function Breadcrumb({ filePath }: { filePath: string }) {
  const parts = filePath.split('/');
  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap font-display">
      <Link href="/" className="hover:text-foreground transition-colors">
        <Home size={14} />
      </Link>
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        const href = '/view/' + parts.slice(0, i + 1).map(encodeURIComponent).join('/');
        return (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-muted-foreground/50" />
            {isLast ? (
              <span className="flex items-center gap-1.5 text-foreground font-medium">
                <FileTypeIcon name={part} />
                <span suppressHydrationWarning>{part}</span>
              </span>
            ) : (
              <Link href={href} className="hover:text-foreground transition-colors truncate max-w-[200px]">
                <span suppressHydrationWarning>{part}</span>
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
