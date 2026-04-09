'use client';

import type { ReactNode } from 'react';
import { Library } from 'lucide-react';

export function EchoFactSnapshot({
  headingId,
  heading,
  snapshotBadge,
  emptyTitle,
  emptyBody,
  icon,
  actions,
}: {
  headingId: string;
  heading: string;
  snapshotBadge: string;
  emptyTitle: string;
  emptyBody: string;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--amber)]/25 hover:shadow sm:p-6"
      aria-labelledby={headingId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber-dim)] text-[var(--amber)]"
            aria-hidden
          >
            {icon ?? <Library size={16} strokeWidth={1.75} />}
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
        <span className="font-sans text-xs font-medium uppercase tracking-wide text-[var(--amber-text)] sm:shrink-0 rounded-md bg-[var(--amber-dim)] px-2 py-0.5">
          {snapshotBadge}
        </span>
      </div>
      <p className="mt-4 border-t border-border/50 pt-4 font-sans text-sm leading-relaxed text-muted-foreground">
        {emptyBody}
      </p>
      {actions ? (
        <div className="mt-4 border-t border-border/50 pt-4">{actions}</div>
      ) : null}
    </section>
  );
}
