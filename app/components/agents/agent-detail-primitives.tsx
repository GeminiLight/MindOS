'use client';

/**
 * Shared primitives and utility functions for agent detail sub-sections.
 */

/** Simple label–value pair used across detail sections. */
export function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 px-0.5 min-w-0">
      <span className="text-2xs text-muted-foreground/50 uppercase tracking-wider shrink-0 min-w-[60px]">{label}</span>
      <span className="text-xs text-foreground/80 font-mono truncate min-w-0">{value}</span>
    </div>
  );
}

/** Compact stat card for metric display. */
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
      <p className="text-2xs text-muted-foreground/50 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground font-mono tabular-nums">{value}</p>
    </div>
  );
}

/** Format an ISO timestamp as relative time (e.g. "5m ago", "2h ago"). */
export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}
