import { Maximize2, Minimize2 } from 'lucide-react';

/**
 * Shared header bar for side panels (Files, Search, Plugins, etc.)
 * Keeps the uppercase label + optional right content pattern consistent.
 */
export default function PanelHeader({
  title,
  children,
  maximized,
  onMaximize,
}: {
  title: string;
  children?: React.ReactNode;
  maximized?: boolean;
  onMaximize?: () => void;
}) {
  return (
    <div className="panel-header relative z-10 flex h-[var(--app-titlebar-h)] min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
      <span className="relative z-10 min-w-0 shrink truncate text-xs text-muted-foreground uppercase tracking-wider">{title}</span>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {children}
        {onMaximize && (
          <button
            type="button"
            onClick={onMaximize}
            className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
            aria-label={maximized ? 'Restore panel' : 'Maximize panel'}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}
