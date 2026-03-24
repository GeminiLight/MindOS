'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export function EchoHero({
  breadcrumbNav,
  parentHref,
  parent,
  currentTitle,
  heroKicker,
  pageTitle,
  lead,
  titleId,
}: {
  breadcrumbNav: string;
  parentHref: string;
  parent: string;
  currentTitle: string;
  heroKicker: string;
  pageTitle: string;
  lead: string;
  titleId: string;
}) {
  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-card px-5 py-6 shadow-sm sm:px-8 sm:py-8">
      <div
        className="absolute left-0 top-5 bottom-5 w-0.5 rounded-full bg-[var(--amber)] sm:top-6 sm:bottom-6"
        aria-hidden
      />
      <div className="relative pl-4 sm:pl-5">
        <p className="mb-4 font-sans text-2xs font-semibold uppercase tracking-[0.2em] text-[var(--amber)]">
          {heroKicker}
        </p>
        <nav aria-label={breadcrumbNav} className="mb-5 font-sans text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link
                href={parentHref}
                className="rounded-sm px-0.5 transition-colors duration-150 hover:text-[var(--amber)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {parent}
              </Link>
            </li>
            <li className="flex items-center px-0.5 text-muted-foreground/45" aria-hidden>
              <ChevronRight size={14} className="shrink-0" />
            </li>
            <li className="font-medium text-foreground" aria-current="page">
              {currentTitle}
            </li>
          </ol>
        </nav>
        <h1 id={titleId} className="font-display text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {pageTitle}
        </h1>
        <p className="mt-3 max-w-prose font-sans text-base leading-relaxed text-muted-foreground">{lead}</p>
      </div>
    </header>
  );
}
