'use client';

import { useEffect } from 'react';

export default function ViewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('View error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Failed to load file</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {error.message || 'The file could not be read or rendered.'}
        </p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
        style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
      >
        Try again
      </button>
    </div>
  );
}
