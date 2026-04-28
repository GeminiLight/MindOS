'use client';

/**
 * Root-level error boundary that catches errors in the entire app,
 * including layout.tsx and server component failures.
 * This prevents the generic "Application error" white screen.
 *
 * NOTE: Inline styles with fallback hex values are intentional here.
 * This component renders when the layout (and globals.css) may have failed,
 * so CSS variables may not be available. We reference var(--xxx) with
 * hardcoded fallbacks matching the dark theme tokens from the design system.
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
      <body style={{ margin: 0, fontFamily: "'IBM Plex Sans', system-ui, sans-serif", background: 'var(--background, #131210)', color: 'var(--foreground, #e8e4dc)' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', gap: '16px', padding: '24px', textAlign: 'center',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Something went wrong</h2>
          <p style={{ fontSize: '14px', color: 'var(--muted-foreground, #8a8275)', maxWidth: '400px', margin: 0 }}>
            {error.message || 'An unexpected error occurred. Please try again.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button
              onClick={reset}
              style={{
                padding: '8px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 500,
                background: 'var(--card, #1c1a17)', color: 'var(--foreground, #e8e4dc)', border: '1px solid var(--border, rgba(232,228,220,0.08))', cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/setup"
              style={{
                padding: '8px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 500,
                background: 'var(--amber, #c8873a)', color: 'var(--amber-foreground, #ffffff)', textDecoration: 'none', cursor: 'pointer',
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
