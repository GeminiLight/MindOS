'use client';

import type { ReactNode } from 'react';

/**
 * Echo page hero: kicker, h1, lead, and optional embedded children (e.g. segment nav).
 * The accent bar highlights the text zone; children sit below it inside the card.
 */
export function EchoHero({
  heroKicker,
  pageTitle,
  lead,
  titleId,
  children,
}: {
  heroKicker: string;
  pageTitle: string;
  lead: string;
  titleId: string;
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-card px-5 pb-5 pt-6 shadow-sm sm:px-8 sm:pb-6 sm:pt-8">
      <div
        className="absolute left-0 top-5 w-[3px] rounded-full bg-[var(--amber)] sm:top-6"
        style={{ bottom: children ? '40%' : '1.25rem' }}
        aria-hidden
      />
      <div className="relative pl-4 sm:pl-5">
        <p className="mb-4 font-sans text-2xs font-semibold uppercase tracking-[0.2em] text-[var(--amber)]">
          {heroKicker}
        </p>
        <h1 id={titleId} className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {pageTitle}
        </h1>
        <p className="mt-3 max-w-prose font-sans text-base leading-relaxed text-muted-foreground">{lead}</p>
      </div>
      {children}
    </header>
  );
}
