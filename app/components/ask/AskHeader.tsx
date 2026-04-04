import { memo } from 'react';
import { Sparkles, SquarePen, History, X, Maximize2, Minimize2, PanelRight, AppWindow } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';

interface AskHeaderProps {
  isPanel: boolean;
  showHistory: boolean;
  onToggleHistory: () => void;
  onReset: () => void;
  isLoading: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
  askMode?: 'panel' | 'popup';
  onModeSwitch?: () => void;
  onClose?: () => void;
}

export default memo(function AskHeader({
  isPanel, showHistory, onToggleHistory, onReset, isLoading,
  maximized, onMaximize, askMode, onModeSwitch, onClose,
}: AskHeaderProps) {
  const { t } = useLocale();
  const iconSize = isPanel ? 13 : 14;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
      {!isPanel && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-muted-foreground/20 md:hidden" />
      )}
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Sparkles size={isPanel ? 14 : 15} className="text-[var(--amber)]" />
        <span className={isPanel ? 'font-display text-xs uppercase tracking-wider text-muted-foreground' : 'font-display'}>
          {isPanel ? 'MindOS Agent' : t.ask.title}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleHistory(); }} aria-pressed={showHistory} className={`p-2 rounded transition-colors ${showHistory ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} title={t.hints.sessionHistory}>
          <History size={iconSize} />
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onReset(); }} disabled={isLoading} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40" title={t.hints.newSession}>
          <SquarePen size={iconSize} />
        </button>
        {isPanel && onMaximize && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={maximized ? t.hints.restorePanel : t.hints.maximizePanel}>
            {maximized ? <Minimize2 size={iconSize} /> : <Maximize2 size={iconSize} />}
          </button>
        )}
        {onModeSwitch && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onModeSwitch(); }} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={askMode === 'popup' ? t.hints.dockToSide : t.hints.openAsPopup}>
            {askMode === 'popup' ? <PanelRight size={iconSize} /> : <AppWindow size={iconSize} />}
          </button>
        )}
        {onClose && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title={t.hints.closePanel} aria-label="Close">
            <X size={isPanel ? iconSize : 15} />
          </button>
        )}
      </div>
    </div>
  );
});
