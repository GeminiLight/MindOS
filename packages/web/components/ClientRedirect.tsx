'use client';

import { useEffect } from 'react';

export interface ClientRedirectProps {
  href: string;
  label?: string;
}

export default function ClientRedirect({ href, label = 'Redirecting...' }: ClientRedirectProps) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <a
        href={href}
        className="text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {label}
      </a>
    </main>
  );
}
