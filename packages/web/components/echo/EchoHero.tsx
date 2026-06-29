'use client';

import type { ReactNode } from 'react';

export function EchoHero({
  pageTitle,
  lead,
  titleId,
  beforeTitle,
  actions,
  children,
}: {
  pageTitle: string;
  lead: string;
  titleId: string;
  beforeTitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="echo-page-hero mb-6 min-w-0">
      {beforeTitle ? <div className="mb-3">{beforeTitle}</div> : null}
      <div className="echo-page-hero__row">
        <div className="echo-page-hero__copy">
          <h1 id={titleId} className="text-2xl font-semibold tracking-tight text-foreground">
            {pageTitle}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{lead}</p>
        </div>
        {actions ? (
          <div className="echo-page-hero__actions" data-echo-page-actions>
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
