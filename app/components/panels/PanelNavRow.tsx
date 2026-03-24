'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Row matching Discover panel nav: icon tile, title, optional badge, chevron. */
export function PanelNavRow({
  icon,
  title,
  badge,
  href,
  onClick,
  active,
}: {
  icon: ReactNode;
  title: string;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** When true, row shows selected state (e.g. current Echo segment). */
  active?: boolean;
}) {
  const content = (
    <>
      <span className="flex items-center justify-center w-7 h-7 rounded-md bg-muted shrink-0">{icon}</span>
      <span className="text-sm font-medium text-foreground flex-1 text-left">{title}</span>
      {badge}
      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
    </>
  );

  const className = cn(
    'flex items-center gap-3 px-4 py-2.5 transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'bg-accent/50 text-foreground cursor-default'
      : 'hover:bg-muted/50 cursor-pointer',
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
