'use client';

import { useMemo, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { PanelId } from './ActivityBar';
import type { FileNode } from '@/lib/types';
import FileTree from './FileTree';
import SyncStatusBar from './SyncStatusBar';
import PanelHeader from './panels/PanelHeader';
import { useResizeDrag } from '@/hooks/useResizeDrag';

/** Compute the maximum directory depth of a file tree */
function getMaxDepth(nodes: FileNode[], current = 0): number {
  let max = current;
  for (const n of nodes) {
    if (n.type === 'directory') {
      max = Math.max(max, getMaxDepth(n.children ?? [], current + 1));
    }
  }
  return max;
}

const DEFAULT_PANEL_WIDTH: Record<PanelId, number> = {
  files: 280,
  search: 280,
  plugins: 280,
  agents: 280,
};

const MIN_PANEL_WIDTH = 240;
const MAX_PANEL_WIDTH_RATIO = 0.45;
const MAX_PANEL_WIDTH_ABS = 600;

interface PanelProps {
  activePanel: PanelId | null;
  fileTree: FileNode[];
  onNavigate?: () => void;
  onOpenSyncSettings: () => void;
  railWidth?: number;
  /** Controlled panel width (from SidebarLayout) */
  panelWidth?: number;
  /** Callback when user finishes resizing */
  onWidthChange?: (width: number) => void;
  /** Callback on drag end — for persisting to localStorage */
  onWidthCommit?: (width: number) => void;
  /** Whether panel is maximized */
  maximized?: boolean;
  /** Callback to toggle maximize */
  onMaximize?: () => void;
  /** Lazy-loaded panel content for search/ask/plugins */
  children?: React.ReactNode;
}

export default function Panel({
  activePanel,
  fileTree,
  onNavigate,
  onOpenSyncSettings,
  railWidth = 48,
  panelWidth,
  onWidthChange,
  onWidthCommit,
  maximized = false,
  onMaximize,
  children,
}: PanelProps) {
  const open = activePanel !== null;
  const defaultWidth = activePanel ? DEFAULT_PANEL_WIDTH[activePanel] : 280;
  const width = maximized ? undefined : (panelWidth ?? defaultWidth);

  // File tree depth control: null = manual (no override), number = forced max open depth
  const [maxOpenDepth, setMaxOpenDepth] = useState<number | null>(null);
  const treeMaxDepth = useMemo(() => getMaxDepth(fileTree), [fileTree]);

  const handleMouseDown = useResizeDrag({
    width: panelWidth ?? defaultWidth,
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH_ABS,
    maxWidthRatio: MAX_PANEL_WIDTH_RATIO,
    direction: 'right',
    disabled: maximized,
    onResize: onWidthChange ?? (() => {}),
    onResizeEnd: onWidthCommit ?? (() => {}),
  });

  return (
    <aside
      className={`
        hidden md:flex fixed top-0 h-screen z-30
        flex-col bg-card border-r border-border
        transition-[transform,left,width] duration-200 ease-out
        ${open ? 'translate-x-0' : '-translate-x-full pointer-events-none'}
      `}
      style={{ width: maximized ? `calc(100vw - ${railWidth}px)` : `${width}px`, left: `${railWidth}px` }}
      role="region"
      aria-label={activePanel ? `${activePanel} panel` : undefined}
    >
      {/* Files panel — always mounted to preserve tree expand/collapse state */}
      <div className={`flex flex-col h-full ${activePanel === 'files' ? '' : 'hidden'}`}>
        <PanelHeader title="Files">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setMaxOpenDepth(prev => {
                const current = prev ?? treeMaxDepth;
                return Math.max(-1, current - 1);
              })}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Collapse one level"
              title="Collapse one level"
            >
              <ChevronsDownUp size={13} />
            </button>
            <button
              onClick={() => setMaxOpenDepth(prev => {
                const current = prev ?? 0;
                const next = current + 1;
                if (next > treeMaxDepth) {
                  return null; // fully expanded → release back to manual
                }
                return next;
              })}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Expand one level"
              title="Expand one level"
            >
              <ChevronsUpDown size={13} />
            </button>
          </div>
        </PanelHeader>
        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          <FileTree nodes={fileTree} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} />
        </div>
        <SyncStatusBar collapsed={false} onOpenSyncSettings={onOpenSyncSettings} />
      </div>

      {/* Other panels — always mounted via children, visibility toggled by parent */}
      {children}

      {/* Drag resize handle */}
      {!maximized && onWidthChange && (
        <div
          className="absolute top-0 -right-[3px] w-[6px] h-full cursor-col-resize z-40 group hidden md:block"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute right-[2px] top-0 w-[2px] h-full opacity-0 group-hover:opacity-100 bg-amber-500/60 transition-opacity" />
        </div>
      )}
    </aside>
  );
}

export { DEFAULT_PANEL_WIDTH as PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH_RATIO, MAX_PANEL_WIDTH_ABS };
