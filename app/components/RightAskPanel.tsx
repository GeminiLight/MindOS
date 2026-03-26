'use client';

import { AlertCircle } from 'lucide-react';
import AskContent from '@/components/ask/AskContent';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useResizeDrag } from '@/hooks/useResizeDrag';

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
const MAX_WIDTH_ABS = 700;
const MAX_WIDTH_RATIO = 0.45;

interface RightAskPanelProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
  initialMessage?: string;
  onFirstMessage?: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit: (w: number) => void;
  askMode?: 'panel' | 'popup';
  onModeSwitch?: () => void;
}

export default function RightAskPanel({
  open, onClose, currentFile, initialMessage, onFirstMessage,
  width, onWidthChange, onWidthCommit, askMode, onModeSwitch,
}: RightAskPanelProps) {
  const handleMouseDown = useResizeDrag({
    width,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH_ABS,
    maxWidthRatio: MAX_WIDTH_RATIO,
    direction: 'left',
    onResize: onWidthChange,
    onResizeEnd: onWidthCommit,
  });

  return (
    <aside
      className={`
        hidden md:flex fixed top-0 right-0 h-screen z-40
        flex-col bg-card border-l border-border
        transition-transform duration-200 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}
      style={{ width: `${width}px` }}
      role="complementary"
      aria-label="MindOS Agent panel"
    >
      <ErrorBoundary fallback={
        <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
          <AlertCircle size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">AI panel encountered an error.</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Reload page
          </button>
        </div>
      }>
        {/* Flex column + min-h-0 so MessageList flex-1 gets a bounded height (fragment children are direct flex items) */}
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <AskContent
            visible={open}
            variant="panel"
            currentFile={open ? currentFile : undefined}
            initialMessage={initialMessage}
            onFirstMessage={onFirstMessage}
            onClose={onClose}
            askMode={askMode}
            onModeSwitch={onModeSwitch}
          />
        </div>
      </ErrorBoundary>

      {/* Drag resize handle — LEFT edge */}
      <div
        className="absolute top-0 -left-[3px] w-[6px] h-full cursor-col-resize z-40 group hidden md:block"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute left-[2px] top-0 w-[2px] h-full opacity-0 group-hover:opacity-100 bg-[var(--amber)]/60 transition-opacity" />
      </div>
    </aside>
  );
}

export { DEFAULT_WIDTH as RIGHT_ASK_DEFAULT_WIDTH, MIN_WIDTH as RIGHT_ASK_MIN_WIDTH, MAX_WIDTH_ABS as RIGHT_ASK_MAX_WIDTH };
