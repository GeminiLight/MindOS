'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Row matching Discover panel nav: icon tile, title, optional subtitle, optional badge, chevron. */
export function PanelNavRow({
  icon,
  title,
  subtitle,
  badge,
  href,
  onClick,
  active,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** When true, row shows selected state (e.g. current Echo segment). */
  active?: boolean;
}) {
  const content = (
    <>
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-[background-color,border-color,color] duration-150',
          active
            ? 'border-[var(--amber)]/35 bg-[var(--amber)]/10 text-[var(--amber)]'
            : 'border-transparent bg-muted/70 text-muted-foreground group-hover:bg-muted group-hover:text-foreground',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-left text-sm font-medium text-foreground truncate" title={title}>{title}</span>
        {subtitle ? (
          <span className="block text-left text-2xs text-muted-foreground truncate" title={subtitle}>{subtitle}</span>
        ) : null}
      </span>
      {badge}
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </>
  );

  const className = cn(
    'group relative flex items-center gap-3 rounded-md border px-4 py-2.5 transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'cursor-default border-[var(--amber)]/35 bg-[var(--amber-dim)]/45 text-foreground shadow-sm'
      : 'cursor-pointer border-transparent text-muted-foreground hover:border-border/60 hover:bg-muted/45 hover:text-foreground',
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(className, 'w-full')}>
      {content}
    </button>
  );
}

export function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{label}</span>
  );
}
