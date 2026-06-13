'use client';

import type { ReactNode } from 'react';

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
    <header className="mb-6">
      <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-foreground">
        {pageTitle}
      </h1>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{lead}</p>
      {children}
    </header>
  );
}
