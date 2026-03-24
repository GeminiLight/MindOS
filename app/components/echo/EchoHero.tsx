'use client';

import Link from 'next/link';

/**
 * Echo page hero: kicker, minimal breadcrumb (parent only — h1 holds the section title),
 * lead. Avoids repeating the current segment name in both breadcrumb and h1.
 */
export function EchoHero({
  breadcrumbNav,
  parentHref,
  parent,
  heroKicker,
  pageTitle,
  lead,
  titleId,
}: {
  breadcrumbNav: string;
  parentHref: string;
  parent: string;
  heroKicker: string;
  pageTitle: string;
  lead: string;
  titleId: string;
}) {
  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-card px-5 py-6 shadow-sm sm:px-8 sm:py-8">
      <div
        className="absolute bottom-5 left-0 top-5 w-0.5 rounded-full bg-[var(--amber)] sm:bottom-6 sm:top-6"
        aria-hidden
      />
      <div className="relative pl-4 sm:pl-5">
        <p className="mb-3 font-sans text-2xs font-semibold uppercase tracking-[0.2em] text-[var(--amber)]">
          {heroKicker}
        </p>
        <nav aria-label={breadcrumbNav} className="mb-5 font-sans text-sm">
          <ol className="m-0 list-none p-0">
            <li>
              <Link
                href={parentHref}
                className="text-muted-foreground transition-colors duration-150 hover:text-[var(--amber)] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {parent}
              </Link>
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
