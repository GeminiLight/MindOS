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
import { ECHO_SEGMENT_HREF } from '@/lib/echo-segments';
import type { Messages } from '@/lib/i18n';
import { cn, encodePath } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

type EchoMarkdownComponent = ComponentType<{ markdown: string }>;
type EchoSavedItemsCopy = Messages['echoPages'];

const echoSurfaceClass =
  'rounded-xl border border-border/60 bg-card/45 shadow-sm';

const echoDetailProseClass =
  'prose prose-sm prose-panel dark:prose-invert max-w-none text-foreground ' +
  'break-words prose-p:my-3 prose-p:leading-7 ' +
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

function stripDuplicateTitleHeading(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex < 0) return markdown;

  const firstLine = lines[firstContentIndex]?.trim() ?? '';
  const headingTitle = firstLine.match(/^#\s+(.+)$/)?.[1]?.trim();
  if (!headingTitle || headingTitle !== title.trim()) return markdown;

  const nextLines = lines.slice(firstContentIndex + 1);
  while (nextLines[0]?.trim() === '') nextLines.shift();
  return nextLines.join('\n').trim();
}

function imprintSourceLabel(item: EchoSavedItem, p: EchoSavedItemsCopy): string {
  if (item.assistantId) return p.imprintSourceAssistant;
  if (item.path.includes('/Daily/')) return p.imprintSourceManual;
  return p.imprintSourceMarkdown;
}

function markdownSection(markdown: string, headings: string[]): string {
  const normalizedHeadings = new Set(headings.map((heading) => heading.trim().toLowerCase()));
  const lines = markdown.split(/\r?\n/);
  const selected: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const heading = line.trim().match(/^#{2,3}\s+(.+)$/)?.[1]?.trim().toLowerCase();
    if (heading) {
      if (capturing) break;
      capturing = normalizedHeadings.has(heading);
      continue;
    }
    if (capturing) selected.push(line);
  }

  return selected.join('\n').trim();
}

function ImprintReaderPanel({
  listTitle,
  items,
  selectedPath,
  onSelect,
  selectedItem,
  readableMarkdown,
  EchoMarkdown,
  loading,
  error,
  detailLoading,
  detailError,
  p,
}: {
  listTitle: string;
  items: EchoSavedItem[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  selectedItem: EchoSavedItem | null;
  readableMarkdown: string;
  EchoMarkdown: EchoMarkdownComponent | null;
  loading: boolean;
  error: string;
  detailLoading: boolean;
  detailError: string;
  p: EchoSavedItemsCopy;
}) {
  const hasItems = items.length > 0;
  const showDetailPanel = loading || detailError || detailLoading || selectedItem || hasItems;

  return (
    <div
      className={cn(
        'grid gap-5',
        showDetailPanel
          ? 'lg:h-[calc(100vh-13rem)] lg:min-h-[34rem] lg:max-h-[46rem] lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]'
          : 'lg:max-w-[36rem]',
      )}
      aria-labelledby="echo-memory-reader-title"
      data-testid="echo-memory-reader-layout"
    >
      <section className={cn(echoSurfaceClass, 'flex flex-col overflow-hidden lg:min-h-0')}>
        <div className="shrink-0 border-b border-border/45 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id="echo-memory-reader-title" className="font-sans text-base font-medium leading-tight text-foreground">
                {listTitle}
              </h2>
              <p className="mt-1 font-sans text-xs text-muted-foreground">{p.imprintEventBookSubtitle}</p>
            </div>
            <span className="shrink-0 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 font-mono text-[0.68rem] text-muted-foreground">
              {p.imprintEventCountLabel(items.length)}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error ? (
            <p className="px-3 py-4 font-sans text-sm text-error" role="alert">{error}</p>
          ) : loading ? (
            <ReaderLoadingState label={p.echoSavedLoadingLabel} compact />
          ) : hasItems ? (
            <div className="space-y-2">
              {items.map((item, index) => (
                <ImprintEventListItem
                  key={item.path}
                  item={item}
                  index={index}
                  active={item.path === selectedPath}
                  onSelect={onSelect}
                  p={p}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-52 items-center justify-center px-6 py-10 text-center">
              <p className="max-w-xs font-sans text-sm leading-6 text-muted-foreground">{p.imprintReaderEmptyLabel}</p>
            </div>
          )}
        </div>
      </section>

      {showDetailPanel ? (
        <section className={cn(echoSurfaceClass, 'flex min-h-0 min-w-0 flex-col overflow-hidden lg:min-h-0')}>
          {detailError ? (
            <p className="px-8 py-7 font-sans text-sm text-error" role="alert">
              {p.echoSavedDetailErrorPrefix} {detailError}
            </p>
          ) : loading || detailLoading ? (
            <DetailLoadingState label={loading ? p.echoSavedLoadingLabel : p.echoSavedDetailLoadingLabel} />
          ) : selectedItem ? (
            <ImprintEventDetail
              selectedItem={selectedItem}
              selectedIndex={items.findIndex((item) => item.path === selectedItem.path)}
              readableMarkdown={readableMarkdown}
              EchoMarkdown={EchoMarkdown}
              p={p}
            />
          ) : (
            <div className="flex min-h-80 flex-1 items-center justify-center px-8 py-10 text-center">
              <p className="max-w-sm font-sans text-sm leading-6 text-muted-foreground">{p.imprintReaderDetailEmptyLabel}</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function ImprintEventListItem({
  item,
  index,
  active,
  onSelect,
  p,
}: {
  item: EchoSavedItem;
  index: number;
  active: boolean;
  onSelect: (path: string) => void;
  p: EchoSavedItemsCopy;
}) {
  const source = imprintSourceLabel(item, p);

  return (
    <button
      type="button"
      onClick={() => onSelect(item.path)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg px-3.5 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border border-[var(--amber)]/35 bg-[var(--amber)]/10 shadow-sm'
          : 'border border-transparent hover:bg-muted/30',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
          active
            ? 'border-[var(--amber)]/30 bg-[var(--amber)]/10 text-[var(--amber)]'
            : 'border-border/60 bg-background/65 text-muted-foreground group-hover:text-foreground',
        )}
        aria-hidden
      >
        {segmentIcon('imprint', index)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-sm font-medium leading-5 text-foreground">{item.title}</span>
        <span className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 font-sans text-[0.72rem] text-muted-foreground">
          <span>{source}</span>
          <span aria-hidden>·</span>
          <span>{item.date}</span>
          <span className="rounded-full bg-muted/45 px-2 py-0.5">{p.imprintStatusCaptured}</span>
        </span>
        {item.excerpt ? (
          <span className="mt-2 line-clamp-2 font-sans text-xs leading-5 text-muted-foreground">{item.excerpt}</span>
        ) : null}
      </span>
    </button>
  );
}

function ImprintEventDetail({
  selectedItem,
  selectedIndex,
  readableMarkdown,
  EchoMarkdown,
  p,
}: {
  selectedItem: EchoSavedItem;
  selectedIndex: number;
  readableMarkdown: string;
  EchoMarkdown: EchoMarkdownComponent | null;
  p: EchoSavedItemsCopy;
}) {
  const markdown = readableMarkdown.trim();
  const source = imprintSourceLabel(selectedItem, p);
  const sceneMarkdown = markdownSection(markdown, ['现场', 'Scene']) || markdown;
  const resultMarkdown = markdownSection(markdown, ['结果', 'Result']) || selectedItem.excerpt || p.imprintRawFallback;
  const evidence = [
    { label: p.imprintDetailDateLabel, value: selectedItem.date },
    { label: p.imprintDetailSourceLabel, value: source },
    { label: p.imprintDetailPathLabel, value: selectedItem.path },
  ];

  return (
    <article className="flex min-h-0 flex-1 flex-col" aria-labelledby="echo-memory-detail-title">
      <header className="shrink-0 border-b border-border/45 px-6 py-5 md:px-8 md:py-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber)]" aria-hidden>
              {segmentIcon('imprint', selectedIndex)}
            </span>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border/55 bg-muted/35 px-2.5 py-1 font-sans text-xs text-muted-foreground">{source}</span>
                <span className="rounded-full bg-[var(--amber)]/10 px-2.5 py-1 font-sans text-xs text-[var(--amber)]">{p.imprintStatusCaptured}</span>
              </div>
              <h3 id="echo-memory-detail-title" className="font-sans text-2xl font-semibold leading-tight text-foreground md:text-3xl">
                {selectedItem.title}
              </h3>
              <p className="mt-3 truncate font-sans text-sm text-muted-foreground">{selectedItem.date} · {selectedItem.path}</p>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-6" data-testid="echo-imprint-detail-body">
        <div className="space-y-4">
          <section className="rounded-lg border border-border/55 bg-background/60 p-4 md:p-5" data-testid="echo-imprint-evidence-card">
            <SectionLabel icon={<Target size={15} aria-hidden />} title={p.imprintDetailEvidenceTitle} compact />
            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              {evidence.map((entry) => (
                <div key={entry.label} className="min-w-0 rounded-md bg-muted/25 px-3 py-2.5">
                  <dt className="font-sans text-[0.7rem] text-muted-foreground">{entry.label}</dt>
                  <dd className="mt-1 break-words font-sans text-sm leading-5 text-foreground">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="min-w-0 rounded-lg border border-border/55 bg-background/60 p-5" data-testid="echo-imprint-scene-card">
            <SectionLabel icon={<NotebookText size={16} aria-hidden />} title={p.imprintDetailSceneTitle} />
            <div className={cn(echoDetailProseClass, 'mt-4')}>
              {sceneMarkdown ? (
                EchoMarkdown ? (
                  <EchoMarkdown markdown={sceneMarkdown} />
                ) : (
                  <p className="whitespace-pre-wrap font-sans text-base leading-7 text-muted-foreground">{sceneMarkdown}</p>
                )
              ) : (
                <p className="font-sans text-base leading-7 text-muted-foreground">{selectedItem.excerpt || p.imprintRawFallback}</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/55 bg-background/60 p-5" data-testid="echo-imprint-result-card">
            <SectionLabel icon={<BookOpen size={16} aria-hidden />} title={p.imprintDetailResultTitle} />
            <div className={cn(echoDetailProseClass, 'mt-4')}>
              {EchoMarkdown ? (
                <EchoMarkdown markdown={resultMarkdown} />
              ) : (
                <p className="whitespace-pre-wrap font-sans text-sm leading-7 text-muted-foreground">{resultMarkdown}</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/55 bg-background/60 p-5">
            <SectionLabel icon={<Scale size={16} aria-hidden />} title={p.imprintDetailQuestionsTitle} />
            <ul className="mt-4 grid gap-2 font-sans text-sm leading-6 text-muted-foreground md:grid-cols-3">
              {p.imprintDetailQuestions.map((question) => (
                <li key={question} className="flex gap-2 rounded-md bg-muted/20 px-3 py-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--amber)]/70" aria-hidden />
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-[var(--amber)]/20 bg-[var(--amber)]/10 p-5">
            <SectionLabel icon={<FlaskConical size={16} aria-hidden />} title={p.imprintDetailNextTitle} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={ECHO_SEGMENT_HREF.threads} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {p.imprintDetailOpenThread}
              </Link>
              <Link href={ECHO_SEGMENT_HREF.growth} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {p.imprintDetailOpenInsight}
              </Link>
              <Link href={ECHO_SEGMENT_HREF.practice} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {p.imprintDetailOpenPractice}
              </Link>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

function SectionLabel({
  icon,
  title,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-muted/45 text-muted-foreground',
        compact ? 'h-7 w-7' : 'h-8 w-8',
      )}>
        {icon}
      </span>
      <h4 className={cn('font-sans font-medium text-foreground', compact ? 'text-sm' : 'text-base')}>
        {title}
      </h4>
    </div>
  );
}

function ReaderLoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={cn('space-y-3', compact ? 'p-2' : 'p-4')} role="status" aria-label={label}>
      <p className="px-1 font-sans text-xs text-muted-foreground">{label}</p>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-start gap-3 rounded-lg border border-border/35 bg-background/35 p-3">
          <span className="h-9 w-9 shrink-0 rounded-md bg-muted/55" aria-hidden />
          <span className="min-w-0 flex-1 space-y-2" aria-hidden>
            <span className="block h-3.5 w-2/3 rounded-full bg-muted/60" />
            <span className="block h-3 w-1/2 rounded-full bg-muted/45" />
            <span className="block h-3 w-5/6 rounded-full bg-muted/35" />
          </span>
        </div>
      ))}
    </div>
  );
}

function DetailLoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-80 flex-1 flex-col px-6 py-6 md:px-8" role="status" aria-label={label}>
      <p className="font-sans text-sm text-muted-foreground">{label}</p>
      <div className="mt-6 space-y-5" aria-hidden>
        <div className="space-y-3">
          <div className="h-8 w-2/3 rounded-full bg-muted/60" />
          <div className="h-3 w-1/3 rounded-full bg-muted/45" />
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="h-40 rounded-lg border border-border/35 bg-background/40" />
          <div className="h-40 rounded-lg border border-border/35 bg-background/40" />
        </div>
      </div>
    </div>
  );
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
  const readableMarkdown = detail?.markdown && selectedItem
    ? stripDuplicateTitleHeading(detail.markdown, selectedItem.title)
    : detail?.markdown ?? '';
  const hasItems = items.length > 0;
  const showDetailPanel = loading || detailError || detailLoading || selectedItem || hasItems;

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

  if (segment === 'imprint') {
    return (
      <ImprintReaderPanel
        listTitle={listTitle}
        items={items}
        selectedPath={selectedPath}
        onSelect={onSelect}
        selectedItem={selectedItem}
        readableMarkdown={readableMarkdown}
        EchoMarkdown={EchoMarkdown}
        loading={loading}
        error={error}
        detailLoading={detailLoading}
        detailError={detailError}
        p={p}
      />
    );
  }

  return (
    <div
      className={cn(
        'grid gap-5',
        showDetailPanel
          ? 'lg:h-[calc(100vh-13rem)] lg:min-h-[34rem] lg:max-h-[46rem] lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]'
          : 'lg:max-w-[36rem]',
      )}
      aria-labelledby="echo-memory-reader-title"
      data-testid="echo-memory-reader-layout"
    >
      <section className={cn(echoSurfaceClass, 'flex flex-col overflow-hidden lg:min-h-0')}>
        <div className="shrink-0 border-b border-border/45 px-5 py-4">
          <h2 id="echo-memory-reader-title" className="font-sans text-base font-medium leading-tight text-foreground">
            {listTitle}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error ? (
            <p className="px-6 py-5 font-sans text-sm text-error" role="alert">{error}</p>
          ) : loading ? (
            <ReaderLoadingState label={p.echoSavedLoadingLabel} />
          ) : hasItems ? (
            <div className="space-y-2">
              {items.map((item, index) => {
                const active = item.path === selectedPath;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => onSelect(item.path)}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-lg border px-3.5 py-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-[var(--amber)]/35 bg-[var(--amber)]/10 shadow-sm'
                        : 'border-transparent hover:bg-muted/30',
                    )}
                    data-testid="echo-memory-list-item"
                  >
                    <span
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
                        active
                          ? 'border-[var(--amber)]/30 bg-[var(--amber)]/10 text-[var(--amber)]'
                          : 'border-border/60 bg-background/65 text-muted-foreground group-hover:text-foreground',
                      )}
                      aria-hidden
                    >
                      {segmentIcon(segment, index)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-sm font-medium leading-5 text-foreground">{item.title}</span>
                      <span className="mt-1.5 block truncate font-sans text-xs text-muted-foreground">{item.date}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-52 items-center justify-center px-6 py-10 text-center">
              <p className="max-w-xs font-sans text-sm leading-6 text-muted-foreground">{p.echoReaderEmptyLabel}</p>
            </div>
          )}
        </div>
      </section>

      {showDetailPanel ? (
        <section className={cn(echoSurfaceClass, 'flex min-h-0 min-w-0 flex-col overflow-hidden lg:min-h-0')}>
          {detailError ? (
            <p className="px-8 py-7 font-sans text-sm text-error" role="alert">
              {p.echoSavedDetailErrorPrefix} {detailError}
            </p>
          ) : loading || detailLoading ? (
            <DetailLoadingState label={loading ? p.echoSavedLoadingLabel : p.echoSavedDetailLoadingLabel} />
          ) : selectedItem ? (
            <article className="flex min-h-0 flex-1 flex-col" aria-labelledby="echo-memory-detail-title">
              <header className="shrink-0 border-b border-border/45 px-6 py-5 md:px-8 md:py-6">
                <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber)]" aria-hidden>
                      {segmentIcon(segment, items.findIndex((item) => item.path === selectedItem.path))}
                    </span>
                    <div className="min-w-0">
                      <h3 id="echo-memory-detail-title" className="font-sans text-xl font-semibold leading-tight text-foreground md:text-2xl">
                        {selectedItem.title}
                      </h3>
                      <p className="mt-3 truncate font-sans text-sm text-muted-foreground">{selectedItem.date} · {selectedItem.path}</p>
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

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-8 md:py-7">
                {readableMarkdown ? (
                  <div className={cn(echoDetailProseClass, 'max-w-3xl')}>
                    {EchoMarkdown ? (
                      <EchoMarkdown markdown={readableMarkdown} />
                    ) : (
                      <p className="whitespace-pre-wrap font-sans text-base leading-8 text-muted-foreground">{readableMarkdown}</p>
                    )}
                  </div>
                ) : (
                  <p className="font-sans text-base leading-8 text-muted-foreground">{selectedItem.excerpt}</p>
                )}
              </div>
            </article>
          ) : (
            <div className="flex min-h-80 flex-1 items-center justify-center px-8 py-10 text-center">
              <p className="max-w-sm font-sans text-sm leading-6 text-muted-foreground">{p.echoReaderDetailEmptyLabel}</p>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
