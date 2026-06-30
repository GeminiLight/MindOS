'use client';

import { useCallback, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import ChatContent from '@/components/chat/ChatContent';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useResizeDrag } from '@/hooks/useResizeDrag';
import { RIGHT_ASK_PANEL } from '@/lib/config/panel-sizes';
import type { RightAskLayoutMode } from '@/lib/right-ask-layout';

const DEFAULT_WIDTH = RIGHT_ASK_PANEL.DEFAULT;
const MIN_WIDTH = RIGHT_ASK_PANEL.MIN;
const MAX_WIDTH_ABS = RIGHT_ASK_PANEL.MAX_ABS;
const ENTER_SNAP_THRESHOLD = RIGHT_ASK_PANEL.FOCUS_SNAP_LEFT_GAP;
const EXIT_SNAP_THRESHOLD = 16;

import type { AcpAgentSelection, AskAgentRuntimeSelection } from '@/hooks/useAskModal';
import type { AskContextRequest } from '@/lib/ask-context-events';

interface RightAskPanelProps {
  open: boolean;
  onClose: () => void;
  currentFile?: string;
  initialMessage?: string;
  initialAcpAgent?: AcpAgentSelection | null;
  initialAgentRuntime?: AskAgentRuntimeSelection | null;
  initialNewSession?: boolean;
  openRequestId?: number;
  contextRequest?: AskContextRequest | null;
  onFirstMessage?: () => void;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit: (w: number) => void;
  maximized?: boolean;
  onMaximize?: (restoreWidth?: number) => void;
  /** Left offset (px) to avoid covering Rail + Sidebar when maximized */
  sidebarOffset?: number;
  layoutMode?: RightAskLayoutMode;
}

export default function RightAskPanel({
  open, onClose, currentFile, initialMessage, initialAcpAgent, initialAgentRuntime, initialNewSession, openRequestId, contextRequest, onFirstMessage,
  width, onWidthChange, onWidthCommit,
  maximized = false, onMaximize, sidebarOffset = 0,
  layoutMode = maximized ? 'focus' : 'docked',
}: RightAskPanelProps) {
  const snapFiredRef = useRef(false);
  const dragStartWidthRef = useRef(width);

  const maxAvailable = Math.max(MIN_WIDTH, typeof window !== 'undefined'
    ? window.innerWidth - sidebarOffset
    : 1200);

  const [isDragging, setIsDragging] = useState(false);

  const handleResize = useCallback((w: number) => {
    if (snapFiredRef.current) return;
    const clamped = Math.min(w, maxAvailable);

    // Exit Focus when the user intentionally drags the edge back to the right.
    if (maximized && clamped < maxAvailable - EXIT_SNAP_THRESHOLD && onMaximize) {
      onMaximize();
      onWidthChange(clamped);
      return;
    }

    if (!maximized) {
      onWidthChange(clamped);
    }
  }, [maxAvailable, onMaximize, maximized, onWidthChange]);

  const handleResizeEnd = useCallback((w: number) => {
    setIsDragging(false);
    if (snapFiredRef.current) return;
    const clamped = Math.min(w, maxAvailable);
    if (!maximized && clamped >= maxAvailable - ENTER_SNAP_THRESHOLD && onMaximize) {
      snapFiredRef.current = true;
      onMaximize(dragStartWidthRef.current);
      return;
    }
    onWidthCommit(clamped);
  }, [maxAvailable, maximized, onMaximize, onWidthCommit]);

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
    dragStartWidthRef.current = width;
    setIsDragging(true);
    rawMouseDown(e);
  }, [rawMouseDown, width]);

  const effectiveWidth = maximized
    ? `calc(100vw - ${sidebarOffset}px)`
    : `${Math.min(width, maxAvailable)}px`;

  const depthClass = layoutMode === 'focus'
    ? 'border-border shadow-2xl'
    : layoutMode === 'protected'
      ? 'border-border/70 shadow-xl'
      : 'border-border/40 shadow-sm';

  return (
    <aside
      className={`
        hidden md:flex fixed top-[var(--app-titlebar-h)] right-0 h-[calc(100vh-var(--app-titlebar-h))] z-40
        flex-col bg-background border-l ${depthClass}
        ${isDragging ? '' : 'transition-[width,transform] duration-200 ease-out'}
        ${open ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}
      style={{ width: effectiveWidth, minWidth: `${MIN_WIDTH}px` }}
      role="complementary"
      aria-label="MindOS panel"
    >
      <ErrorBoundary fallback={
        <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
          <AlertCircle size={20} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">MindOS encountered an error.</p>
          <button
            onClick={() => window.location.reload()}
            className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Reload page
          </button>
        </div>
      }>
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <ChatContent
            visible={open}
            variant="panel"
            currentFile={open ? currentFile : undefined}
            initialMessage={initialMessage}
            initialAcpAgent={initialAcpAgent}
            initialAgentRuntime={initialAgentRuntime}
            initialNewSession={initialNewSession}
            openRequestId={openRequestId}
            contextRequest={contextRequest}
            onFirstMessage={onFirstMessage}
            onClose={onClose}
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
