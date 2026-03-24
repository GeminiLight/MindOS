'use client';

import Link from 'next/link';
import { useLocale } from '@/lib/LocaleContext';
import { cn } from '@/lib/utils';
import { ECHO_SEGMENT_HREF, ECHO_SEGMENT_ORDER, type EchoSegment } from '@/lib/echo-segments';

function labelForSegment(
  segment: EchoSegment,
  echo: ReturnType<typeof useLocale>['t']['panels']['echo'],
): string {
  switch (segment) {
    case 'about-you':
      return echo.aboutYouTitle;
    case 'continued':
      return echo.continuedTitle;
    case 'daily':
      return echo.dailyEchoTitle;
    case 'past-you':
      return echo.pastYouTitle;
    case 'growth':
      return echo.intentGrowthTitle;
  }
}

export default function EchoSegmentNav({ activeSegment }: { activeSegment: EchoSegment }) {
  const { t } = useLocale();
  const echo = t.panels.echo;
  const aria = t.echoPages.segmentNavAria;

  return (
    <nav aria-label={aria} className="mt-6 font-sans">
      <ul className="-mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {ECHO_SEGMENT_ORDER.map((segment) => {
          const href = ECHO_SEGMENT_HREF[segment];
          const label = labelForSegment(segment, echo);
          const isActive = segment === activeSegment;
          return (
            <li key={segment} className="snap-start shrink-0">
              <Link
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-9 max-w-[11rem] items-center rounded-full border px-3 py-1.5 text-sm transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-[var(--amber)]/45 bg-[var(--amber-dim)]/50 font-medium text-foreground'
                    : 'border-transparent bg-muted/35 text-muted-foreground hover:bg-muted/55 hover:text-foreground',
                )}
              >
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
