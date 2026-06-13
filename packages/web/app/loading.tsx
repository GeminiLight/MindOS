/**
 * Home page skeleton — shown while server components load.
 * Matches the HomeContent layout: hero → spaces grid → recent files.
 */
export default function Loading() {
  return (
    <div className="content-width px-4 md:px-6 py-10 md:py-14 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Hero skeleton */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-1 h-7 rounded-full bg-muted" />
          <div className="h-6 w-28 bg-muted rounded" />
        </div>
        <div className="h-4 w-64 bg-muted rounded ml-4 mb-6" />

        {/* Command bar skeleton */}
        <div className="w-full max-w-xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ml-4">
          <div className="flex-1 h-12 rounded-xl bg-muted" />
          <div className="h-12 w-16 rounded-xl bg-muted shrink-0" />
        </div>

        {/* Quick actions skeleton */}
        <div className="flex items-center gap-3 mt-4 ml-4">
          <div className="h-9 w-28 rounded-lg bg-muted" />
          <div className="h-9 w-40 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Spaces grid skeleton */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-4 h-4 rounded bg-muted" />
          <div className="h-4 w-16 bg-muted rounded" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-3.5 py-3 rounded-xl border border-border">
              <div className="w-5 h-5 rounded bg-muted shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-4 w-20 bg-muted rounded" />
                <div className="h-3 w-full bg-muted rounded" />
                <div className="h-3 w-12 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent files skeleton */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-4 h-4 rounded bg-muted" />
          <div className="h-4 w-24 bg-muted rounded" />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 px-1 py-1.5">
                <div className="w-4 h-4 rounded bg-muted" />
                <div className="h-3 w-24 bg-muted rounded" />
              </div>
              <div className="flex flex-col gap-0.5 ml-2 border-l border-border/40 pl-3">
                {Array.from({ length: 2 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-3 px-3 py-2">
                    <div className="w-3 h-3 rounded bg-muted shrink-0" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 w-40 bg-muted rounded" />
                      <div className="h-3 w-24 bg-muted rounded" />
                    </div>
                    <div className="h-3 w-12 bg-muted rounded shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
