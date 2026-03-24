'use client';

import { useId, useState } from 'react';
import { ChevronDown, Library, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EchoFactSnapshot({
  headingId,
  heading,
  snapshotBadge,
  emptyTitle,
  emptyBody,
}: {
  headingId: string;
  heading: string;
  snapshotBadge: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      aria-labelledby={headingId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-dim)] text-[var(--amber)]"
            aria-hidden
          >
            <Library size={18} strokeWidth={1.75} />
          </span>
          <div>
            <h2
              id={headingId}
              className="font-sans text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {heading}
            </h2>
            <p className="mt-2 font-sans font-medium text-foreground">{emptyTitle}</p>
          </div>
        </div>
        <span className="font-sans text-2xs font-medium uppercase tracking-wide text-[var(--amber)] sm:mt-0.5 sm:shrink-0 rounded-md bg-[var(--amber-dim)] px-2 py-1">
          {snapshotBadge}
        </span>
      </div>
      <p className="mt-4 border-t border-border/60 pt-4 font-sans text-sm leading-relaxed text-muted-foreground">
        {emptyBody}
      </p>
    </section>
  );
}

export function EchoContinuedGroups({
  draftsLabel,
  todosLabel,
  subEmptyHint,
}: {
  draftsLabel: string;
  todosLabel: string;
  subEmptyHint: string;
}) {
  const cell = (label: string) => (
    <div className="flex min-h-[5.75rem] flex-col justify-center rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-4">
      <h3 className="font-sans text-sm font-medium text-foreground">{label}</h3>
      <p className="mt-2 font-sans text-2xs leading-relaxed text-muted-foreground">{subEmptyHint}</p>
    </div>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cell(draftsLabel)}
      {cell(todosLabel)}
    </div>
  );
}

export function EchoCollapsibleInsight({
  title,
  showLabel,
  hideLabel,
  hint,
  generateLabel,
  disabledHint,
}: {
  title: string;
  showLabel: string;
  hideLabel: string;
  hint: string;
  generateLabel: string;
  disabledHint: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const btnId = `${panelId}-btn`;

  return (
    <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        id={btnId}
        type="button"
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-dim)] text-[var(--amber)]"
          aria-hidden
        >
          <Sparkles size={17} strokeWidth={1.75} />
        </span>
        <span className="flex-1 font-sans text-sm font-medium text-foreground">{title}</span>
        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
        <span className="sr-only">{open ? hideLabel : showLabel}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={btnId}
          className="border-t border-border/60 px-5 pb-5 pt-4"
        >
          <p className="font-sans text-sm leading-relaxed text-muted-foreground">{hint}</p>
          <button
            type="button"
            disabled
            className="mt-4 inline-flex cursor-not-allowed items-center rounded-lg border border-border bg-muted/30 px-3 py-2 font-sans text-sm text-muted-foreground opacity-75"
          >
            {generateLabel}
          </button>
          <p className="mt-2 font-sans text-2xs text-muted-foreground">{disabledHint}</p>
        </div>
      ) : null}
    </div>
  );
}
