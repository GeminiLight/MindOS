/**
 * Root route-segment loading fallback — a neutral skeleton shown while server
 * components stream. `/` itself only ever redirects (see app/page.tsx), so
 * this surface appears for content routes that have no deeper loading.tsx;
 * it is intentionally generic and matches no specific page layout.
 */
export default function Loading() {
  return (
    <div className="content-width px-4 md:px-6 py-10 md:py-14 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-40 bg-muted rounded mb-6" />
      <div className="flex flex-col gap-3">
        <div className="h-4 w-3/4 bg-muted rounded" />
        <div className="h-4 w-2/3 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
      </div>
    </div>
  );
}
