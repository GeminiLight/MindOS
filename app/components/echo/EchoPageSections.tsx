'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EchoFactSnapshot({
  headingId,
  heading,
  emptyTitle,
  emptyBody,
}: {
  headingId: string;
  heading: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  return (
    <section
      className="rounded-lg border border-border/60 bg-muted/20 p-4"
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground font-sans">
        {heading}
      </h2>
      <p className="mt-3 font-medium text-foreground font-sans">{emptyTitle}</p>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed font-sans">{emptyBody}</p>
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
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-border/50 bg-card/30 p-3">
        <h3 className="text-sm font-medium text-foreground font-sans">{draftsLabel}</h3>
        <p className="mt-2 text-2xs text-muted-foreground font-sans">{subEmptyHint}</p>
      </div>
      <div className="rounded-md border border-border/50 bg-card/30 p-3">
        <h3 className="text-sm font-medium text-foreground font-sans">{todosLabel}</h3>
        <p className="mt-2 text-2xs text-muted-foreground font-sans">{subEmptyHint}</p>
      </div>
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
    <div className="rounded-lg border border-border/60 bg-card/40 mt-8">
      <button
        id={btnId}
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground font-sans rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors hover:bg-muted/30"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
          aria-hidden
        />
        <span className="sr-only">{open ? hideLabel : showLabel}</span>
      </button>
      {open ? (
        <div id={panelId} role="region" aria-labelledby={btnId} className="border-t border-border/50 px-4 pb-4 pt-2">
          <p className="text-sm text-muted-foreground leading-relaxed font-sans">{hint}</p>
          <button
            type="button"
            disabled
            className="mt-3 inline-flex items-center rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground font-sans opacity-70 cursor-not-allowed"
          >
            {generateLabel}
          </button>
          <p className="mt-2 text-2xs text-muted-foreground font-sans">{disabledHint}</p>
        </div>
      ) : null}
    </div>
  );
}
