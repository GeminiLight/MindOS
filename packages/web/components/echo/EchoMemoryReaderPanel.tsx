'use client';

import type { ComponentType, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  FlaskConical,
  Infinity,
  Leaf,
  MessageSquareText,
  NotebookText,
  Scale,
  SunMedium,
  Target,
} from 'lucide-react';
import type { EchoSavedItem, EchoSavedItemDetail, EchoStoredSegment } from '@/lib/echo-store';
import type { Messages } from '@/lib/i18n';
import { cn, encodePath } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

type EchoMarkdownComponent = ComponentType<{ markdown: string }>;
type EchoSavedItemsCopy = Messages['echoPages'];

const echoSurfaceClass =
  'rounded-xl border border-border/60 bg-card/45 shadow-sm';

const echoDetailProseClass =
  'prose prose-sm prose-panel dark:prose-invert max-w-none text-foreground ' +
  'prose-p:my-3 prose-p:leading-8 ' +
  'prose-headings:font-semibold prose-headings:text-foreground prose-h1:text-xl prose-h2:text-lg prose-h3:text-base ' +
  'prose-headings:mt-8 prose-headings:mb-3 ' +
  'prose-ul:my-5 prose-ol:my-5 prose-li:my-2 ' +
  'prose-code:text-[0.8em] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none ' +
  'prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs ' +
  'prose-blockquote:border-l-[var(--amber)] prose-blockquote:text-muted-foreground ' +
  'prose-a:text-[var(--amber)] prose-a:no-underline hover:prose-a:underline ' +
  'prose-strong:text-foreground prose-strong:font-semibold';

const segmentIcons: Record<EchoStoredSegment, ReactNode[]> = {
  imprint: [
    <SunMedium key="sun" size={22} strokeWidth={1.7} />,
    <NotebookText key="note" size={22} strokeWidth={1.7} />,
    <BookOpen key="book" size={22} strokeWidth={1.7} />,
  ],
  threads: [
    <SunMedium key="sun" size={22} strokeWidth={1.7} />,
    <Target key="target" size={22} strokeWidth={1.7} />,
    <Scale key="scale" size={22} strokeWidth={1.7} />,
    <BookOpen key="book" size={22} strokeWidth={1.7} />,
    <Infinity key="infinity" size={22} strokeWidth={1.7} />,
  ],
  growth: [
    <Leaf key="leaf" size={22} strokeWidth={1.7} />,
    <Scale key="scale" size={22} strokeWidth={1.7} />,
    <Target key="target" size={22} strokeWidth={1.7} />,
  ],
  practice: [
    <FlaskConical key="flask" size={22} strokeWidth={1.7} />,
    <Target key="target" size={22} strokeWidth={1.7} />,
    <MessageSquareText key="message" size={22} strokeWidth={1.7} />,
  ],
};

function segmentIcon(segment: EchoStoredSegment, index: number) {
  const icons = segmentIcons[segment];
  return icons[Math.max(0, index) % icons.length];
}

export default function EchoMemoryReaderPanel({
  segment,
  listTitle,
  items,
  selectedPath,
  onSelect,
  detail,
  loading,
  error,
  detailLoading,
  detailError,
  p,
}: {
  segment: EchoStoredSegment;
  listTitle: string;
  items: EchoSavedItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  detail: EchoSavedItemDetail | null;
  loading: boolean;
  error: string;
  detailLoading: boolean;
  detailError: string;
  p: EchoSavedItemsCopy;
}) {
  const [EchoMarkdown, setEchoMarkdown] = useState<EchoMarkdownComponent | null>(null);
  const selectedItem = detail ?? items.find((item) => item.path === selectedPath) ?? null;

  useEffect(() => {
    if (!detail?.markdown || EchoMarkdown) return;
    let cancelled = false;
    import('./EchoInsightMarkdown')
      .then((mod) => {
        if (!cancelled) setEchoMarkdown(() => mod.default);
      })
      .catch((err) => {
        console.error('[EchoMemoryReaderPanel] Failed to load markdown renderer:', err);
      });
    return () => { cancelled = true; };
  }, [detail?.markdown, EchoMarkdown]);

  return (
    <div
      className="grid gap-5 lg:h-[calc(100vh-13rem)] lg:min-h-[34rem] lg:max-h-[46rem] lg:grid-cols-[minmax(18rem,0.74fr)_minmax(0,1.42fr)]"
      aria-labelledby="echo-memory-reader-title"
    >
      <section className={cn(echoSurfaceClass, 'flex min-h-[22rem] flex-col overflow-hidden lg:min-h-0')}>
        <div className="shrink-0 border-b border-border/45 px-6 py-5">
          <h2 id="echo-memory-reader-title" className="font-sans text-lg font-semibold leading-tight text-foreground">
            {listTitle}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p className="px-6 py-5 font-sans text-sm text-error" role="alert">{error}</p>
          ) : loading ? (
            <p className="px-6 py-5 font-sans text-sm text-muted-foreground">{p.echoSavedLoadingLabel}</p>
          ) : items.length > 0 ? (
            <div className="divide-y divide-border/45">
              {items.map((item, index) => {
                const active = item.path === selectedPath;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => onSelect(item.path)}
                    className={cn(
                      'group relative flex w-full items-center gap-5 px-6 py-6 text-left transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active ? 'bg-[var(--amber)]/10' : 'hover:bg-muted/30',
                    )}
                  >
                    {active ? <span className="absolute bottom-0 left-0 top-0 w-1 rounded-r-full bg-[var(--amber)]" aria-hidden /> : null}
                    <span
                      className={cn(
                        'shrink-0 transition-colors duration-150',
                        active ? 'text-[var(--amber)]' : 'text-muted-foreground group-hover:text-foreground',
                      )}
                      aria-hidden
                    >
                      {segmentIcon(segment, index)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-sans text-base font-medium leading-snug text-foreground">{item.title}</span>
                      <span className="mt-2 block truncate font-sans text-sm text-muted-foreground">{item.date}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-56 items-center justify-center px-6 py-10 text-center">
              <p className="max-w-xs font-sans text-sm leading-6 text-muted-foreground">{p.echoSavedEmptyLabel}</p>
            </div>
          )}
        </div>
      </section>

      <section className={cn(echoSurfaceClass, 'flex min-h-[30rem] min-w-0 flex-col overflow-hidden lg:min-h-0')}>
        {detailError ? (
          <p className="px-8 py-7 font-sans text-sm text-error" role="alert">
            {p.echoSavedDetailErrorPrefix} {detailError}
          </p>
        ) : detailLoading ? (
          <p className="px-8 py-7 font-sans text-sm text-muted-foreground">{p.echoSavedDetailLoadingLabel}</p>
        ) : selectedItem ? (
          <article className="flex min-h-0 flex-1 flex-col" aria-labelledby="echo-memory-detail-title">
            <header className="shrink-0 border-b border-border/45 px-8 py-7 md:px-10 md:py-8">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 items-start gap-5">
                  <span className="mt-1 text-[var(--amber)]" aria-hidden>
                    {segmentIcon(segment, items.findIndex((item) => item.path === selectedItem.path))}
                  </span>
                  <div className="min-w-0">
                    <h3 id="echo-memory-detail-title" className="font-sans text-2xl font-semibold leading-tight text-foreground md:text-3xl">
                      {selectedItem.title}
                    </h3>
                    <p className="mt-4 truncate font-sans text-sm text-muted-foreground">{selectedItem.date} · {selectedItem.path}</p>
                  </div>
                </div>
                <Link
                  href={`/view/${encodePath(selectedItem.path)}`}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'w-fit shrink-0',
                  )}
                >
                  {p.echoSavedOpenLabel}
                  <ArrowUpRight size={13} aria-hidden />
                </Link>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7 md:px-10 md:py-8">
              {detail?.markdown ? (
                <div className={echoDetailProseClass}>
                  {EchoMarkdown ? (
                    <EchoMarkdown markdown={detail.markdown} />
                  ) : (
                    <p className="whitespace-pre-wrap font-sans text-base leading-8 text-muted-foreground">{detail.markdown}</p>
                  )}
                </div>
              ) : (
                <p className="font-sans text-base leading-8 text-muted-foreground">{selectedItem.excerpt}</p>
              )}
            </div>
          </article>
        ) : (
          <div className="flex min-h-[30rem] flex-1 items-center justify-center px-8 py-10 text-center">
            <p className="max-w-sm font-sans text-sm leading-6 text-muted-foreground">{p.echoSavedEmptyLabel}</p>
          </div>
        )}
      </section>
    </div>
  );
}
