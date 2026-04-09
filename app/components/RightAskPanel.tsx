'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import AskContent from '@/components/ask/AskContent';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useResizeDrag } from '@/hooks/useResizeDrag';
import { RIGHT_ASK_PANEL } from '@/lib/config/panel-sizes';

const DEFAULT_WIDTH = RIGHT_ASK_PANEL.DEFAULT;
const MIN_WIDTH = RIGHT_ASK_PANEL.MIN;
const MAX_WIDTH_ABS = RIGHT_ASK_PANEL.MAX_ABS;
const ENTER_SNAP_THRESHOLD = 80;
const EXIT_SNAP_THRESHOLD = 16;
const MIN_CONTENT_WIDTH = RIGHT_ASK_PANEL.MIN_CONTENT;

import type { AcpAgentSelection } from '@/hooks/useAskModal';

interface RightAskPanelProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
  initialMessage?: string;
  initialAcpAgent?: AcpAgentSelection | null;
  onFirstMessage?: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit: (w: number) => void;
  askMode?: 'panel' | 'popup';
  onModeSwitch?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
  /** Left offset (px) to avoid covering Rail + Sidebar when maximized */
  sidebarOffset?: number;
}

export default function RightAskPanel({
  open, onClose, currentFile, initialMessage, initialAcpAgent, onFirstMessage,
  width, onWidthChange, onWidthCommit, askMode, onModeSwitch,
  maximized = false, onMaximize, sidebarOffset = 0,
}: RightAskPanelProps) {
  const snapFiredRef = useRef(false);
  const justExitedMaxRef = useRef(false);

  const maxAvailable = typeof window !== 'undefined'
    ? window.innerWidth - sidebarOffset
    : 1200;

  const [isDragging, setIsDragging] = useState(false);

  const handleResize = useCallback((w: number) => {
    if (snapFiredRef.current) return;
    const clamped = Math.min(w, maxAvailable);

    // Exit maximized: user drags right even a little (16px) → exit immediately
    if (maximized && clamped < maxAvailable - EXIT_SNAP_THRESHOLD && onMaximize) {
      justExitedMaxRef.current = true;
      onMaximize();
      const maxPanelForContent = typeof window !== 'undefined'
        ? window.innerWidth - sidebarOffset - MIN_CONTENT_WIDTH
        : clamped;
      onWidthChange(Math.min(clamped, maxPanelForContent));
      return;
    }

    // Snap to fullscreen: panel near max edge OR content squeezed below minimum.
    // Suppress content-based snap while justExitedMaxRef is true (user recently
    // exited fullscreen and panel is still wide); only re-enable once the panel
    // has been shrunk enough that content is comfortable (reset in handleMouseDown).
    const contentRemaining = typeof window !== 'undefined'
      ? window.innerWidth - sidebarOffset - clamped
      : Infinity;
    const shouldSnap = clamped >= maxAvailable - ENTER_SNAP_THRESHOLD
      || (!justExitedMaxRef.current && contentRemaining < MIN_CONTENT_WIDTH);
    if (!maximized && shouldSnap && onMaximize) {
      snapFiredRef.current = true;
      onMaximize();
      return;
    }
    if (!maximized) {
      onWidthChange(clamped);
    }
  }, [maxAvailable, sidebarOffset, onMaximize, maximized, onWidthChange]);

  const handleResizeEnd = useCallback((w: number) => {
    setIsDragging(false);
    if (snapFiredRef.current) return;
    onWidthCommit(w);
  }, [onWidthCommit]);

  const rawMouseDown = useResizeDrag({
    width: maximized ? maxAvailable : width,
    minWidth: MIN_WIDTH,
    maxWidth: maxAvailable,
    maxWidthRatio: 1,
    direction: 'left',
    onResize: handleResize,
    onResizeEnd: handleResizeEnd,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    snapFiredRef.current = false;
    setIsDragging(true);
    // Only re-enable content-based snap once the panel has been shrunk enough
    // that content is comfortably above minimum. This prevents the bounce:
    // exit fullscreen → new drag → immediately re-snap because panel still wide.
    if (justExitedMaxRef.current) {
      const currentContent = typeof window !== 'undefined'
        ? window.innerWidth - sidebarOffset - width
        : Infinity;
      if (currentContent >= MIN_CONTENT_WIDTH) {
        justExitedMaxRef.current = false;
      }
    }
    rawMouseDown(e);
  }, [rawMouseDown, sidebarOffset, width]);

  const effectiveWidth = maximized
    ? `calc(100vw - ${sidebarOffset}px)`
    : `${width}px`;

  return (
    <aside
      className={`
        hidden md:flex fixed top-0 right-0 h-screen z-40
        flex-col bg-background border-l border-border/40 shadow-[-4px_0_16px_rgba(0,0,0,0.04)]
        ${isDragging ? '' : 'transition-[width,transform] duration-200 ease-out'}
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}
      style={{ width: effectiveWidth, minWidth: `${MIN_WIDTH}px` }}
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
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <AskContent
            visible={open}
            variant="panel"
            currentFile={open ? currentFile : undefined}
            initialMessage={initialMessage}
            initialAcpAgent={initialAcpAgent}
            onFirstMessage={onFirstMessage}
            onClose={onClose}
            askMode={askMode}
            onModeSwitch={onModeSwitch}
            maximized={maximized}
            onMaximize={onMaximize}
          />
        </div>
      </ErrorBoundary>

      {/* Drag resize handle — LEFT edge, always visible for bidirectional snap */}
      <div
        className="absolute top-0 -left-[3px] w-[6px] h-full cursor-col-resize z-40 group hidden md:block"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute left-[2px] top-0 w-[1px] h-full opacity-0 group-hover:opacity-100 bg-[var(--amber)]/50 transition-opacity duration-150" />
      </div>
    </aside>
  );
}

export { DEFAULT_WIDTH as RIGHT_ASK_DEFAULT_WIDTH, MIN_WIDTH as RIGHT_ASK_MIN_WIDTH, MAX_WIDTH_ABS as RIGHT_ASK_MAX_WIDTH };
