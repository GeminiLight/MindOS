"use client";
import { cn } from "@/lib/utils";

/** Native buttons retain normal Tab/Enter/Space behavior; these are view filters, not ARIA tabs. */
export function StudySectionNav<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string; count?: number }[]; onChange: (value: T) => void;
}) {
  return <nav aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-muted/40 p-1">
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}
      className={cn("inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === option.value ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
      {option.label}{option.count !== undefined && option.count > 0 ? <span className="rounded bg-muted px-1.5 font-mono text-xs">{option.count}</span> : null}
    </button>)}
  </nav>;
}
