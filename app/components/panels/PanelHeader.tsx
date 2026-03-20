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
    <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-display">{title}</span>
      <div className="flex items-center gap-1">
        {children}
        {onMaximize && (
          <button
            onClick={onMaximize}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label={maximized ? 'Restore panel' : 'Maximize panel'}
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}
