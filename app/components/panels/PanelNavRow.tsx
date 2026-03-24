'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/** Row matching Discover panel nav: icon tile, title, optional badge, chevron. */
export function PanelNavRow({
  icon,
  title,
  badge,
  href,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex items-center justify-center w-7 h-7 rounded-md bg-muted shrink-0">{icon}</span>
      <span className="text-sm font-medium text-foreground flex-1 text-left">{title}</span>
      {badge}
      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
    </>
  );

  const className =
    'flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${className} w-full`}>
      {content}
    </button>
  );
}

export function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{label}</span>
  );
}
