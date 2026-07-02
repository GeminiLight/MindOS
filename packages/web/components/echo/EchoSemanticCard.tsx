'use client';

import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen,
  ChevronDown,
  ClipboardCheck,
  GitBranch,
  Leaf,
  MessageSquareText,
  NotebookText,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type EchoSemanticCardKind = 'digest' | 'moment' | 'pattern' | 'judgment' | 'playbook' | 'practice';

type EchoCardTone = {
  accent: string;
  chip: string;
  dot: string;
  wash: string;
  icon: ReactNode;
};

const CARD_TONES: Record<EchoSemanticCardKind, EchoCardTone> = {
  digest: {
    accent: 'bg-[var(--amber)]',
    chip: 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-[var(--amber)]',
    dot: 'bg-[var(--amber)]',
    wash: 'bg-[color-mix(in_srgb,var(--amber)_7%,transparent)]',
    icon: <ShieldCheck size={13} strokeWidth={1.8} aria-hidden />,
  },
  moment: {
    accent: 'bg-muted-foreground/55',
    chip: 'border-border/55 bg-muted/35 text-muted-foreground',
    dot: 'bg-muted-foreground/60',
    wash: 'bg-muted/20',
    icon: <NotebookText size={13} strokeWidth={1.8} aria-hidden />,
  },
  pattern: {
    accent: 'bg-[var(--success)]',
    chip: 'border-success/25 bg-success/10 text-success',
    dot: 'bg-[var(--success)]',
    wash: 'bg-[color-mix(in_srgb,var(--success)_7%,transparent)]',
    icon: <BookOpen size={13} strokeWidth={1.8} aria-hidden />,
  },
  judgment: {
    accent: 'bg-[var(--tool-search)]',
    chip: 'border-[var(--tool-search)]/25 bg-[var(--tool-search)]/10 text-[var(--tool-search)]',
    dot: 'bg-[var(--tool-search)]',
    wash: 'bg-[color-mix(in_srgb,var(--tool-search)_7%,transparent)]',
    icon: <ClipboardCheck size={13} strokeWidth={1.8} aria-hidden />,
  },
  playbook: {
    accent: 'bg-[var(--tool-read)]',
    chip: 'border-[var(--tool-read)]/25 bg-[var(--tool-read)]/10 text-[var(--tool-read)]',
    dot: 'bg-[var(--tool-read)]',
    wash: 'bg-[color-mix(in_srgb,var(--tool-read)_7%,transparent)]',
    icon: <GitBranch size={13} strokeWidth={1.8} aria-hidden />,
  },
  practice: {
    accent: 'bg-[var(--success)]',
    chip: 'border-success/25 bg-success/10 text-success',
    dot: 'bg-[var(--success)]',
    wash: 'bg-[color-mix(in_srgb,var(--success)_7%,transparent)]',
    icon: <Leaf size={13} strokeWidth={1.8} aria-hidden />,
  },
};

const TIME_ONLY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const echoCardMarkdownClass =
  'prose prose-sm prose-panel dark:prose-invert max-w-3xl break-words text-muted-foreground ' +
  'prose-p:my-2 prose-p:leading-7 prose-p:text-muted-foreground ' +
  'prose-headings:my-2 prose-headings:font-semibold prose-headings:text-foreground prose-h1:text-lg prose-h2:text-base prose-h3:text-sm ' +
  'prose-ul:my-2 prose-ol:my-2 prose-li:my-1 ' +
  'prose-code:rounded prose-code:bg-muted/65 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none ' +
  'prose-pre:my-3 prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-xs ' +
  'prose-blockquote:border-l-[var(--amber)] prose-blockquote:text-muted-foreground ' +
  'prose-a:text-[var(--amber)] prose-a:no-underline hover:prose-a:underline ' +
  'prose-strong:text-foreground prose-strong:font-semibold';

const echoCardDetailMarkdownClass =
  'prose prose-sm prose-panel dark:prose-invert max-w-none break-words text-muted-foreground ' +
  'prose-p:my-1 prose-p:leading-5 prose-p:text-muted-foreground ' +
  'prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 ' +
  'prose-code:rounded prose-code:bg-muted/65 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none ' +
  'prose-pre:my-2 prose-pre:bg-muted prose-pre:text-foreground prose-pre:text-[0.7rem] ' +
  'prose-strong:text-foreground prose-strong:font-semibold prose-a:text-[var(--amber)]';

function padTimePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatClock(date: Date): string {
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;
}

function sameLocalDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function formatEchoCardTimestamp(value: string | undefined, now = new Date()): string {
  const raw = value?.trim();
  if (!raw) return '';
  if (TIME_ONLY_RE.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  if (sameLocalDate(parsed, now)) return formatClock(parsed);

  const month = padTimePart(parsed.getMonth() + 1);
  const day = padTimePart(parsed.getDate());
  const date = parsed.getFullYear() === now.getFullYear()
    ? `${month}/${day}`
    : `${parsed.getFullYear()}/${month}/${day}`;
  return `${date} ${formatClock(parsed)}`;
}

export function EchoCardFrame({
  kind,
  children,
  className,
  testId,
}: {
  kind: EchoSemanticCardKind;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const tone = CARD_TONES[kind];
  return (
    <article
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-xl border border-border/45 bg-background/70',
        'shadow-[0_1px_1px_color-mix(in_srgb,var(--foreground)_5%,transparent),0_14px_34px_-30px_color-mix(in_srgb,var(--foreground)_28%,transparent)]',
        'transition-[background-color,border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-px hover:border-border/70 hover:bg-background/85 hover:shadow-md',
        className,
      )}
      data-testid={testId}
      data-echo-card-kind={kind}
    >
      <div className={cn('pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100', tone.wash)} aria-hidden />
      <div className={cn('absolute bottom-4 left-0 top-4 w-px rounded-full opacity-80', tone.accent)} aria-hidden />
      <div className={cn('absolute left-0 top-4 h-8 w-[3px] rounded-r-full', tone.accent)} aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foreground/10" aria-hidden />
      <div className="relative px-4 py-4 pl-5 md:px-5 md:py-5">
        {children}
      </div>
    </article>
  );
}

export function EchoKindBadge({
  kind,
  label,
}: {
  kind: EchoSemanticCardKind;
  label: string;
}) {
  const tone = CARD_TONES[kind];
  return (
    <span className={cn(
      'inline-flex min-h-6 items-center gap-1.5 rounded-md border px-2 py-0.5 font-sans text-xs font-medium leading-5',
      tone.chip,
    )}>
      {tone.icon}
      <span>{label}</span>
    </span>
  );
}

export function EchoCardHeader({
  kind,
  label,
  timestamp,
  meta,
}: {
  kind: EchoSemanticCardKind;
  label: string;
  timestamp?: string;
  meta?: ReactNode;
}) {
  const tone = CARD_TONES[kind];
  const displayTimestamp = formatEchoCardTimestamp(timestamp);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <EchoKindBadge kind={kind} label={label} />
      {displayTimestamp ? (
        <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-muted/20 px-2 py-1 font-sans text-xs leading-5 text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
          <time className="min-w-0 truncate" data-testid="echo-card-timestamp">{displayTimestamp}</time>
        </span>
      ) : null}
      {meta ? (
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted/10 px-2 py-1 font-mono text-[0.68rem] leading-5 text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </div>
  );
}

export function EchoCardTitle({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <h4 className="mt-4 max-w-3xl text-wrap font-sans text-base font-semibold leading-6 text-foreground">
      {children}
    </h4>
  );
}

export function EchoCardBody({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <EchoCardMarkdown
      markdown={children}
      className={cn('mt-2 font-sans text-sm leading-7', className)}
      data-testid="echo-card-markdown"
    />
  );
}

export function EchoCardDetailFields({
  sourceLabel,
  source,
}: {
  sourceLabel: string;
  source: string;
}) {
  return (
    <details className="group mt-4 overflow-hidden rounded-lg border border-border/35 bg-muted/10">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 font-sans text-xs font-medium text-foreground transition hover:bg-background/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/35 bg-background/70 text-muted-foreground">
            <MessageSquareText size={13} aria-hidden />
          </span>
          <span className="truncate">{sourceLabel}</span>
        </span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/35 bg-background/45 px-3 py-3">
        <EchoCardDetailField label={sourceLabel} value={source} />
      </div>
    </details>
  );
}

function EchoCardDetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.68rem] text-muted-foreground">{label}</p>
      <EchoCardMarkdown
        markdown={value}
        className={cn('mt-1 font-sans text-xs leading-5', echoCardDetailMarkdownClass)}
        data-testid="echo-card-detail-markdown"
      />
    </div>
  );
}

function EchoCardMarkdown({
  markdown,
  className,
  'data-testid': testId,
}: {
  markdown: string;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div className={cn(echoCardMarkdownClass, className)} data-testid={testId}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export function EchoCardActionBar({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <footer className="mt-5 flex min-w-0 flex-col gap-3 border-t border-border/30 pt-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {left}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1">
        {right}
      </div>
    </footer>
  );
}

export function EchoCardDeleteButton({
  label,
  confirmLabel,
  cancelLabel,
  onDelete,
}: {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  onDelete: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);

  if (isConfirming) {
    return (
      <span
        className="inline-flex min-w-0 flex-wrap items-center gap-1"
        data-testid="echo-card-delete-confirmation"
      >
        <Button
          type="button"
          variant="destructive"
          size="sm"
          title={confirmLabel}
          aria-label={confirmLabel}
          data-testid="echo-card-delete-confirm-button"
          onClick={onDelete}
        >
          <Trash2 size={13} aria-hidden />
          {confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          title={cancelLabel}
          aria-label={cancelLabel}
          data-testid="echo-card-delete-cancel-button"
          onClick={() => setIsConfirming(false)}
        >
          <X size={13} aria-hidden />
          {cancelLabel}
        </Button>
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-[var(--error)]"
      title={label}
      aria-label={label}
      data-testid="echo-card-delete-button"
      onClick={() => setIsConfirming(true)}
    >
      <Trash2 size={13} aria-hidden />
      {label}
    </Button>
  );
}

export function buildEchoCardChatPrompt({
  prompt,
  kindPromptLabel,
  titlePromptLabel,
  contentPromptLabel,
  sourceLabel,
  kindLabel,
  title,
  content,
  source,
}: {
  prompt: (kind: string, title: string) => string;
  kindPromptLabel: string;
  titlePromptLabel: string;
  contentPromptLabel: string;
  sourceLabel: string;
  kindLabel: string;
  title: string;
  content: string;
  source: string;
}) {
  return [
    prompt(kindLabel, title),
    '',
    `${kindPromptLabel}: ${kindLabel}`,
    `${titlePromptLabel}: ${title}`,
    `${contentPromptLabel}: ${content}`,
    `${sourceLabel}: ${source}`,
  ].join('\n');
}
