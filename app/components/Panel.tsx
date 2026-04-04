'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsDownUp, ChevronsUpDown, Plus, Import, FileText, Layers } from 'lucide-react';
import type { PanelId } from './ActivityBar';
import type { FileNode } from '@/lib/types';
import FileTree from './FileTree';
import SyncStatusBar from './SyncStatusBar';
import PanelHeader from './panels/PanelHeader';
import { useResizeDrag } from '@/hooks/useResizeDrag';
import { useLocale } from '@/lib/stores/locale-store';

const noop = () => {};

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
  echo: 280,
  agents: 280,
  discover: 280,
  workflows: 280,
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
  /** Callback to open import modal for a space */
  onImport?: (space?: string) => void;
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
  onImport,
  children,
}: PanelProps) {
  const open = activePanel !== null;
  const defaultWidth = activePanel ? DEFAULT_PANEL_WIDTH[activePanel] : 280;
  const width = maximized ? undefined : (panelWidth ?? defaultWidth);

  const { t } = useLocale();
  const router = useRouter();

  // File tree depth control: null = manual (no override), number = forced max open depth
  const [maxOpenDepth, setMaxOpenDepth] = useState<number | null>(null);
  const treeMaxDepth = useMemo(() => getMaxDepth(fileTree), [fileTree]);

  // "New" dropdown popover
  const [newPopover, setNewPopover] = useState(false);
  const newBtnRef = useRef<HTMLButtonElement>(null);
  const newPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!newPopover) return;
    const handler = (e: MouseEvent) => {
      if (
        newBtnRef.current && !newBtnRef.current.contains(e.target as Node) &&
        newPopoverRef.current && !newPopoverRef.current.contains(e.target as Node)
      ) {
        setNewPopover(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setNewPopover(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [newPopover]);

  // Double-click hint: show only until user has used it once.
  // Initialize false to match SSR; hydrate from localStorage in useEffect.
  const [dblHintSeen, setDblHintSeen] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('mindos-tree-dblclick-hint') === '1') setDblHintSeen(true); } catch { /* ignore */ }
  }, []);
  const markDblHintSeen = useCallback(() => {
    if (!dblHintSeen) {
      setDblHintSeen(true);
      try { localStorage.setItem('mindos-tree-dblclick-hint', '1'); } catch { /* ignore */ }
    }
  }, [dblHintSeen]);

  const handleMouseDown = useResizeDrag({
    width: panelWidth ?? defaultWidth,
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH_ABS,
    maxWidthRatio: MAX_PANEL_WIDTH_RATIO,
    direction: 'right',
    disabled: maximized,
    onResize: onWidthChange ?? noop,
    onResizeEnd: onWidthCommit ?? noop,
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
        <PanelHeader title={t.sidebar.files}>
          <div className="flex items-center gap-0.5">
            {/* New (File / Space) */}
            <div className="relative">
              <button
                ref={newBtnRef}
                type="button"
                onClick={() => setNewPopover(v => !v)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={t.sidebar.new}
                title={t.sidebar.new}
              >
                <Plus size={13} />
              </button>
              {newPopover && (
                <div
                  ref={newPopoverRef}
                  className="absolute top-full right-0 mt-1 min-w-[152px] bg-card border border-border rounded-lg shadow-lg py-1 z-50"
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                    onClick={() => { setNewPopover(false); router.push('/view/Untitled.md'); }}
                  >
                    <FileText size={14} className="shrink-0" />
                    {t.sidebar.newFile}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left"
                    onClick={() => { setNewPopover(false); window.dispatchEvent(new Event('mindos:create-space')); }}
                  >
                    <Layers size={14} className="shrink-0 text-[var(--amber)]" />
                    {t.sidebar.newSpace}
                  </button>
                </div>
              )}
            </div>
            {/* Import */}
            <button
              type="button"
              onClick={() => onImport?.()}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t.sidebar.importFile}
              title={t.sidebar.importFile}
            >
              <Import size={13} />
            </button>
            {/* Separator: create actions | view actions */}
            <div className="w-px h-3.5 bg-border mx-0.5" />
            {/* Collapse Level */}
            <button
              onClick={() => setMaxOpenDepth(prev => {
                const current = prev ?? treeMaxDepth;
                return Math.max(-1, current - 1);
              })}
              onDoubleClick={() => { setMaxOpenDepth(-1); markDblHintSeen(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t.sidebar.collapseLevel}
              title={dblHintSeen ? t.sidebar.collapseLevel : (t.sidebar.collapseLevelHint ?? t.sidebar.collapseLevel)}
            >
              <ChevronsDownUp size={13} />
            </button>
            {/* Expand Level */}
            <button
              onClick={() => setMaxOpenDepth(prev => {
                const current = prev ?? 0;
                const next = current + 1;
                if (next > treeMaxDepth) return null;
                return next;
              })}
              onDoubleClick={() => { setMaxOpenDepth(null); markDblHintSeen(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t.sidebar.expandLevel}
              title={dblHintSeen ? t.sidebar.expandLevel : (t.sidebar.expandLevelHint ?? t.sidebar.expandLevel)}
            >
              <ChevronsUpDown size={13} />
            </button>
          </div>
        </PanelHeader>
        <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
          <FileTree nodes={fileTree} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} onImport={onImport} />
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
          <div className="absolute right-[2px] top-0 w-[2px] h-full opacity-0 group-hover:opacity-100 bg-[var(--amber)]/60 transition-opacity" />
        </div>
      )}
    </aside>
  );
}

export { DEFAULT_PANEL_WIDTH as PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH_RATIO, MAX_PANEL_WIDTH_ABS };
