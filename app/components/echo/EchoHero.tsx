'use client';

import type { ReactNode } from 'react';

/**
 * Echo page hero: h1, lead, and optional embedded children (e.g. segment nav).
 * The accent bar highlights the text zone; children sit below it inside the card.
 */
export function EchoHero({
  pageTitle,
  lead,
  titleId,
  children,
}: {
  pageTitle: string;
  lead: string;
  titleId: string;
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-card px-5 pb-5 pt-6 shadow-sm sm:px-8 sm:pb-6 sm:pt-8">
      <div
        className={`absolute left-0 top-5 w-[3px] rounded-sm bg-[var(--amber)] sm:top-6 ${children ? 'bottom-[40%]' : 'bottom-5'}`}
        aria-hidden
      />
      <div className="relative pl-4 sm:pl-5">
        <h1 id={titleId} className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {pageTitle}
        </h1>
        <p className="mt-3 max-w-prose font-sans text-base leading-relaxed text-muted-foreground">{lead}</p>
      </div>
      {children}
    </header>
  );
}
