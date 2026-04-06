'use client';

/**
 * Root-level error boundary that catches errors in the entire app,
 * including layout.tsx and server component failures.
 * This prevents the generic "Application error" white screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "'IBM Plex Sans', system-ui, sans-serif", background: '#131210', color: '#e8e4dc' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', gap: '16px', padding: '24px', textAlign: 'center',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Something went wrong</h2>
          <p style={{ fontSize: '14px', color: '#8a8275', maxWidth: '400px', margin: 0 }}>
            {error.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button
              onClick={reset}
              style={{
                padding: '8px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 500,
                background: '#1c1a17', color: '#e8e4dc', border: '1px solid rgba(232,228,220,0.08)', cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/setup"
              style={{
                padding: '8px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 500,
                background: '#c8873a', color: '#fff', textDecoration: 'none', cursor: 'pointer',
              }}
            >
              Go to Setup
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
