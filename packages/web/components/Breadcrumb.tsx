'use client';

import Link from 'next/link';
import { ChevronRight, Home, FileText, Table, Folder, History } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

const FRIENDLY_PATHS: Record<string, { icon: React.ReactNode; getLabel: (t: ReturnType<typeof useLocale>['t']) => string }> = {
  '.mindos/change-log.json': { icon: <History size={13} className="text-[var(--amber)] shrink-0" />, getLabel: (t) => t.changes.title },
};

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
  if (ext === '.csv') return <Table size={13} className="text-success shrink-0" />;
  if (ext) return <FileText size={13} className="text-muted-foreground shrink-0" />;
  return <Folder size={13} className="text-yellow-400 shrink-0" />;
}

export default function Breadcrumb({ filePath }: { filePath: string }) {
  const { t } = useLocale();
  const friendly = FRIENDLY_PATHS[filePath];

  if (friendly) {
    return (
      <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground flex-nowrap overflow-hidden">
        <Link
          href="/"
          className="hit-target-box inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]"
          title="Home"
        >
          <Home size={14} />
        </Link>
        <ChevronRight size={12} className="pointer-events-none text-muted-foreground/50 shrink-0" />
        <span className="min-w-0 inline-flex min-h-8 items-center gap-1.5 px-2 text-foreground font-medium">
          {friendly.icon}
          <span className="block truncate max-w-[180px] sm:max-w-[260px] md:max-w-[360px]">{friendly.getLabel(t)}</span>
        </span>
      </nav>
    );
  }

  const parts = filePath.split('/');
  return (
    <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground flex-nowrap overflow-hidden">
      <Link
        href="/"
        className="hit-target-box inline-flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]"
        title="Home"
      >
        <Home size={14} />
      </Link>
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        const href = '/view/' + parts.slice(0, i + 1).map(encodeURIComponent).join('/');
        return (
          <span key={i} className="flex items-center gap-1 min-w-0">
            <ChevronRight size={12} className="pointer-events-none text-muted-foreground/50 shrink-0" />
            {isLast ? (
              <span className="min-w-0 inline-flex min-h-8 items-center gap-1.5 px-2 text-foreground font-medium">
                <FileTypeIcon name={part} />
                <span className="block truncate max-w-[180px] sm:max-w-[260px] md:max-w-[360px]" suppressHydrationWarning>{part}</span>
              </span>
            ) : (
              <Link href={href} className="hit-target-box inline-flex min-h-8 max-w-[120px] items-center px-2 transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation sm:max-w-[160px] md:max-w-[200px] [--hit-target-hover-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-radius:var(--radius-md)]" title={part}>
                <span className="truncate" suppressHydrationWarning>{part}</span>
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
