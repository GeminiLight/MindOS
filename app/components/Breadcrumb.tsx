'use client';

import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

export default function Breadcrumb({ filePath }: { filePath: string }) {
  const parts = filePath.split('/');
  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
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
              <span className="text-foreground font-medium" suppressHydrationWarning>{part}</span>
            ) : (
              <Link href={href} className="hover:text-foreground transition-colors truncate max-w-[200px]" suppressHydrationWarning>
                {part}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
