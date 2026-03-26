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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-left text-sm font-medium text-foreground truncate">{title}</span>
        {subtitle ? (
          <span className="block text-left text-2xs text-muted-foreground truncate">{subtitle}</span>
        ) : null}
      </span>
      {badge}
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
    </>
  );

  const showRail = Boolean(active && href);

  const className = cn(
    'relative flex items-center gap-3 py-2.5 transition-colors duration-150 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    showRail ? 'bg-[var(--amber-dim)]/40 pl-3.5 pr-4 text-foreground' : 'px-4',
    href && !showRail && 'cursor-pointer hover:bg-muted/50',
    showRail && 'cursor-default',
    !href && 'cursor-pointer hover:bg-muted/50',
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
        {showRail ? (
          <span
            className="pointer-events-none absolute bottom-[22%] left-0 top-[22%] w-0.5 rounded-r-full bg-[var(--amber)]"
            aria-hidden
          />
        ) : null}
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
