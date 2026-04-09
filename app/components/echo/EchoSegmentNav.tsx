'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Footprints, Brain, Eye } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import { ECHO_SEGMENT_HREF, ECHO_SEGMENT_ORDER, type EchoSegment } from '@/lib/echo-segments';

function segmentMeta(
  segment: EchoSegment,
  echo: ReturnType<typeof useLocale>['t']['panels']['echo'],
): { label: string; icon: ReactNode } {
  switch (segment) {
    case 'imprint':
      return { label: echo.imprintTitle, icon: <Footprints size={14} /> };
    case 'growth':
      return { label: echo.growthTitle, icon: <Brain size={14} /> };
    case 'self':
      return { label: echo.selfTitle, icon: <Eye size={14} /> };
  }
}

export default function EchoSegmentNav({ activeSegment }: { activeSegment: EchoSegment }) {
  const { t } = useLocale();
  const echo = t.panels.echo;
  const aria = t.echoPages.segmentNavAria;

  return (
    <nav aria-label={aria} className="mt-5 border-t border-border/25 pt-4 font-sans">
      <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
        {ECHO_SEGMENT_ORDER.map((segment) => {
          const href = ECHO_SEGMENT_HREF[segment];
          const { label, icon } = segmentMeta(segment, echo);
          const isActive = segment === activeSegment;
          return (
            <li key={segment} className="snap-start shrink-0">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 max-w-44 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  isActive
                    ? 'border-[var(--amber)]/50 bg-[var(--amber-dim)]/50 font-medium text-foreground'
                    : 'border-transparent bg-muted/25 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                <span className={cn('shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} aria-hidden>{icon}</span>
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
