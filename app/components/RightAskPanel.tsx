'use client';

import AskContent from '@/components/ask/AskContent';
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
        hidden md:flex fixed top-0 right-0 h-screen z-30
        flex-col bg-card border-l border-border
        transition-transform duration-200 ease-out
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}
      style={{ width: `${width}px` }}
      role="complementary"
      aria-label="MindOS Agent panel"
    >
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

      {/* Drag resize handle — LEFT edge */}
      <div
        className="absolute top-0 -left-[3px] w-[6px] h-full cursor-col-resize z-40 group hidden md:block"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute left-[2px] top-0 w-[2px] h-full opacity-0 group-hover:opacity-100 bg-amber-500/60 transition-opacity" />
      </div>
    </aside>
  );
}

export { DEFAULT_WIDTH as RIGHT_ASK_DEFAULT_WIDTH, MIN_WIDTH as RIGHT_ASK_MIN_WIDTH, MAX_WIDTH_ABS as RIGHT_ASK_MAX_WIDTH };
