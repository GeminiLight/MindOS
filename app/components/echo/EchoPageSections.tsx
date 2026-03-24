'use client';

import type { ReactNode } from 'react';
import { Library } from 'lucide-react';

export function EchoFactSnapshot({
  headingId,
  heading,
  snapshotBadge,
  emptyTitle,
  emptyBody,
  actions,
}: {
  headingId: string;
  heading: string;
  snapshotBadge: string;
  emptyTitle: string;
  emptyBody: string;
  /** e.g. continue-in-Agent CTA — inside this card so it is not orphaned between sections */
  actions?: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--amber)]/20 hover:shadow-md sm:p-6"
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
      {actions ? (
        <div className="mt-4 border-t border-border/60 pt-4">{actions}</div>
      ) : null}
    </section>
  );
}

export function EchoContinuedGroups({
  draftsLabel,
  todosLabel,
  subEmptyHint,
  footer,
}: {
  draftsLabel: string;
  todosLabel: string;
  subEmptyHint: string;
  footer?: ReactNode;
}) {
  const cell = (label: string) => (
    <div className="flex min-h-[5.75rem] flex-col justify-center rounded-xl border border-dashed border-border/80 bg-muted/10 px-4 py-4">
      <h3 className="font-sans text-sm font-medium text-foreground">{label}</h3>
      <p className="mt-2 font-sans text-2xs leading-relaxed text-muted-foreground">{subEmptyHint}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {cell(draftsLabel)}
        {cell(todosLabel)}
      </div>
      {footer ? <div className="border-t border-border/60 pt-4">{footer}</div> : null}
    </div>
  );
}
