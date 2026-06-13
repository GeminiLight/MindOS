'use client';

import { useMemo, useState, useRef, useEffect, useCallback, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Activity, ChevronDown, ChevronsDownUp, ChevronsUpDown, Plus, Import, RefreshCw, FileText, Layers, MoreHorizontal, Eye, EyeOff, Trash2, Inbox, History } from 'lucide-react';
import type { PanelId } from '@/lib/navigation-panel';
import type { FileNode } from '@/lib/types';
import type { MindSystemSlot } from '@/lib/mind-system';
import FileTree, { setShowHiddenFiles, useShowHiddenFiles } from './FileTree';
import SyncStatusBar from './SyncStatusBar';
import PanelHeader from './panels/PanelHeader';
import { useResizeDrag } from '@/hooks/useResizeDrag';
import { useFilesChanged } from '@/hooks/useFilesChanged';
import { useLocale } from '@/lib/stores/locale-store';
import { listTrashAction } from '@/lib/actions';
import { DEFAULT_LEFT_PANEL_WIDTH, LEFT_PANEL } from '@/lib/config/panel-sizes';
import { encodePath } from '@/lib/utils';
import { fetchInboxFiles } from '@/lib/inbox-client';

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

function filterMindSystemNodes(nodes: FileNode[], slots: MindSystemSlot[]): FileNode[] {
  if (slots.length === 0) return nodes;
  const hiddenTopLevelPaths = new Set(
    slots
      .flatMap(slot => [slot.path, slot.systemId])
      .map(normalizeTopLevelPath)
      .filter(Boolean),
  );
  return nodes.filter((node) => {
    if (node.type !== 'directory') return true;
    const nodeTopLevel = normalizeTopLevelPath(node.path || node.name);
    return !nodeTopLevel || !hiddenTopLevelPaths.has(nodeTopLevel);
  });
}

function normalizeTopLevelPath(value: string): string {
  return value.replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
}

const DEFAULT_PANEL_WIDTH = DEFAULT_LEFT_PANEL_WIDTH;
const MIN_PANEL_WIDTH = LEFT_PANEL.MIN;
const MAX_PANEL_WIDTH_RATIO = LEFT_PANEL.MAX_RATIO;
const MAX_PANEL_WIDTH_ABS = LEFT_PANEL.MAX_ABS;
const MIND_SYSTEM_COLLAPSED_KEY = 'mindos.sidebar.mindSystemCollapsed';
const MIND_SYSTEM_SLOT_LIST_ID = 'mind-system-sidebar-slots';

/**
 * `mindos:files-changed` relevance for the trash badge: the count only moves
 * when content files are deleted/restored. Content paths may be deletions, so
 * they stay relevant; explicit `.trash` paths are relevant; everything else
 * under dot-directories (`.mindos/` change-log, agent state, …) is pure
 * metadata churn and can never move a file to trash → skip the refetch.
 */
function isTrashRelevant(paths: string[]): boolean {
  return paths.some((p) => {
    const normalized = p.replace(/^\/+/, '');
    return normalized === '.trash' || normalized.startsWith('.trash/') || !normalized.startsWith('.');
  });
}

interface PanelProps {
  activePanel: PanelId | null;
  fileTree: FileNode[];
  mindSystemSlots: MindSystemSlot[];
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
  /** Callback to toggle maximize for panel variants that render maximize controls */
  onMaximize?: () => void;
  /** Callback to open import modal for a space */
  onImport?: (space?: string) => void;
  /** Lazy-loaded panel content for search/ask/plugins */
  children?: React.ReactNode;
}

export default function Panel({
  activePanel,
  fileTree,
  mindSystemSlots,
  onNavigate,
  onOpenSyncSettings,
  railWidth = 48,
  panelWidth,
  onWidthChange,
  onWidthCommit,
  maximized = false,
  onImport,
  children,
}: PanelProps) {
  const open = activePanel !== null;
  const defaultWidth = activePanel ? DEFAULT_PANEL_WIDTH[activePanel] : 280;
  const width = maximized ? undefined : (panelWidth ?? defaultWidth);

  const { t } = useLocale();
  const [, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const isInboxActive = pathname === '/capture' || pathname === '/capture/';
  const [refreshingTree, setRefreshingTree] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File tree depth control: null = manual (no override), number = forced max open depth
  const [maxOpenDepth, setMaxOpenDepth] = useState<number | null>(null);
  const ordinaryFileTree = useMemo(
    () => filterMindSystemNodes(fileTree, mindSystemSlots),
    [fileTree, mindSystemSlots],
  );
  const treeMaxDepth = useMemo(
    () => (activePanel === 'files' ? getMaxDepth(ordinaryFileTree) : 0),
    [activePanel, ordinaryFileTree],
  );

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

  // "More" dropdown popover
  const [morePopover, setMorePopover] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const morePopoverRef = useRef<HTMLDivElement>(null);
  const showHidden = useShowHiddenFiles();
  const [trashCount, setTrashCount] = useState(0);

  useEffect(() => {
    if (!morePopover) return;
    const handler = (e: MouseEvent) => {
      if (
        moreBtnRef.current && !moreBtnRef.current.contains(e.target as Node) &&
        morePopoverRef.current && !morePopoverRef.current.contains(e.target as Node)
      ) {
        setMorePopover(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMorePopover(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [morePopover]);

  const [inboxCount, setInboxCount] = useState(0);

  const fetchTrash = useCallback(() => {
    listTrashAction().then(items => setTrashCount(items.length)).catch(() => {});
  }, []);

  useEffect(() => {
    if (activePanel !== 'files') return;

    const fetchInbox = () => {
      fetchInboxFiles(t.inbox.loadFailed)
        .then(files => setInboxCount(files.length))
        .catch(() => setInboxCount(0));
    };
    fetchTrash();
    fetchInbox();
    window.addEventListener('mindos:inbox-updated', fetchInbox);
    return () => {
      window.removeEventListener('mindos:inbox-updated', fetchInbox);
    };
  }, [activePanel, t.inbox.loadFailed, fetchTrash]);

  // Debounced + path-filtered per the mindos:files-changed listener contract.
  useFilesChanged(fetchTrash, {
    enabled: activePanel === 'files',
    isRelevant: isTrashRelevant,
  });

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

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const handleRefreshFiles = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setRefreshingTree(true);
    startTransition(() => {
      router.refresh();
      window.dispatchEvent(new Event('mindos:files-changed'));
    });
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      setRefreshingTree(false);
    }, 450);
  }, [router]);

  // Disable the width transition while dragging (same pattern as
  // RightAskPanel): otherwise every mousemove animates 200ms behind the cursor.
  const [isDragging, setIsDragging] = useState(false);

  const handleResizeEnd = useCallback((w: number) => {
    setIsDragging(false);
    (onWidthCommit ?? noop)(w);
  }, [onWidthCommit]);

  const rawMouseDown = useResizeDrag({
    width: panelWidth ?? defaultWidth,
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH_ABS,
    maxWidthRatio: MAX_PANEL_WIDTH_RATIO,
    direction: 'right',
    disabled: maximized,
    onResize: onWidthChange ?? noop,
    onResizeEnd: handleResizeEnd,
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (maximized) return;
    setIsDragging(true);
    rawMouseDown(e);
  }, [maximized, rawMouseDown]);

  return (
    <aside
      className={`
        hidden md:flex fixed top-[var(--app-titlebar-h)] h-[calc(100vh-var(--app-titlebar-h))] z-30
        flex-col bg-card border-r border-border
        ${isDragging ? '' : 'transition-[transform,left,width] duration-200 ease-out'}
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
                onClick={() => {
                  startTransition(() => {
                    setMorePopover(false);
                    setNewPopover(v => !v);
                  });
                }}
                className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
                aria-label={t.sidebar.new}
                title={t.sidebar.new}
              >
                <Plus size={13} />
              </button>
              {newPopover && (
                <div
                  ref={newPopoverRef}
                  className="absolute top-full left-0 mt-1 min-w-[152px] bg-card border border-border rounded-lg shadow-lg py-1 z-50"
                  data-panel-new-menu
                >
                  <button
                    className="hit-target-box w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:0px]"
                    onClick={() => {
                      startTransition(() => {
                        setNewPopover(false);
                        router.push('/view/Untitled.md');
                      });
                    }}
                  >
                    <FileText size={14} className="shrink-0" />
                    {t.sidebar.newFile}
                  </button>
                  <button
                    className="hit-target-box w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:0px]"
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
              className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
              aria-label={t.sidebar.importFile}
              title={t.sidebar.importFile}
            >
              <Import size={13} />
            </button>
            {/* Refresh */}
            <button
              type="button"
              onClick={handleRefreshFiles}
              className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
              aria-label={t.sidebar.refreshFiles}
              aria-busy={refreshingTree}
              title={t.sidebar.refreshFiles}
            >
              <RefreshCw size={13} className={refreshingTree ? 'motion-safe:animate-spin' : undefined} />
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
              className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
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
              className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
              aria-label={t.sidebar.expandLevel}
              title={dblHintSeen ? t.sidebar.expandLevel : (t.sidebar.expandLevelHint ?? t.sidebar.expandLevel)}
            >
              <ChevronsUpDown size={13} />
            </button>
            {/* Separator */}
            <div className="w-px h-3.5 bg-border mx-0.5" />
            {/* More */}
            <div className="relative">
              <button
                ref={moreBtnRef}
                type="button"
                onClick={() => {
                  startTransition(() => {
                    setNewPopover(false);
                    setMorePopover(v => !v);
                  });
                }}
                className="hit-target-box inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-75 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
                aria-label={t.sidebar.more}
                title={t.sidebar.more}
              >
                <MoreHorizontal size={13} />
              </button>
              {morePopover && (
                <div
                  ref={morePopoverRef}
                  className="absolute top-full right-0 mt-1 min-w-[172px] bg-card border border-border rounded-lg shadow-lg py-1 z-50"
                >
                  <button
                    className="hit-target-box w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:0px]"
                    onClick={() => {
                      startTransition(() => {
                        setMorePopover(false);
                        router.push('/capture');
                      });
                    }}
                  >
                    <Inbox size={14} className="shrink-0 text-[var(--amber)]" />
                    <span className="flex-1">{t.sidebar.capture}</span>
                    {inboxCount > 0 && (
                      <span className="text-2xs font-medium tabular-nums px-1.5 py-px rounded-full bg-[var(--amber)]/10 text-[var(--amber)]/70">{inboxCount}</span>
                    )}
                  </button>
                  <button
                    className="hit-target-box w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:0px]"
                    onClick={() => {
                      startTransition(() => {
                        setMorePopover(false);
                        router.push('/view/.mindos/change-log.json');
                      });
                    }}
                  >
                    <History size={14} className="shrink-0 text-[var(--amber)]" />
                    <span className="flex-1">{t.changes.title}</span>
                  </button>
                  <button
                    className="hit-target-box w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:0px]"
                    onClick={() => {
                      startTransition(() => {
                        setMorePopover(false);
                        router.push('/trash');
                      });
                    }}
                  >
                    <Trash2 size={14} className="shrink-0" />
                    <span className="flex-1">{t.trash.title}</span>
                    {trashCount > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">{trashCount}</span>
                    )}
                  </button>
                  <div className="my-1 border-t border-border/50" />
                  <button
                    className="hit-target-box w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground transition-colors text-left [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:0px]"
                    onClick={() => { setShowHiddenFiles(!showHidden); }}
                  >
                    {showHidden ? <EyeOff size={14} className="shrink-0" /> : <Eye size={14} className="shrink-0" />}
                    <span className="flex-1">{t.sidebar.showHiddenFiles}</span>
                    {showHidden && <span className="text-[var(--amber)] text-xs">✓</span>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </PanelHeader>
        <div
          className="flex-1 overflow-y-auto min-h-0 px-2 py-2"
          onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) e.stopPropagation(); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
          onDrop={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); } }}
        >
          <BuiltInMindSpaces
            title={t.sidebar.builtInSpacesTitle}
            slots={mindSystemSlots}
            onOpen={(path) => router.push(`/view/${encodePath(path)}`)}
          />
          <FileTree nodes={ordinaryFileTree} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} onImport={onImport} />
        </div>
        {/* Inbox quick entry — always visible above sync bar */}
        <button
          type="button"
          onClick={() => router.push('/capture')}
          data-hit-active={isInboxActive ? 'true' : undefined}
          className={`hit-target-box flex items-center gap-2 mx-2 px-2 py-1.5 text-sm transition-all duration-150 group shrink-0 [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-lg)] [--hit-target-active-bg:var(--amber-dim)] ${
            isInboxActive
              ? 'text-[var(--amber)]'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <div className={`flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-colors ${
            isInboxActive ? 'bg-[var(--amber)]/15' : 'bg-transparent'
          }`}>
            <Inbox size={13} className={`shrink-0 transition-colors ${
              isInboxActive ? 'text-[var(--amber)]' : 'text-[var(--amber)]/60 group-hover:text-[var(--amber)]'
            }`} />
          </div>
          <span className={`flex-1 text-left text-xs transition-colors ${
            isInboxActive ? 'font-medium text-[var(--amber)]' : 'text-muted-foreground group-hover:text-foreground'
          }`}>
            {t.sidebar.capture}
          </span>
          {inboxCount > 0 && (
            <span className={`text-2xs font-medium tabular-nums px-1.5 py-px rounded-full transition-colors ${
              isInboxActive
                ? 'bg-[var(--amber)]/15 text-[var(--amber)]'
                : 'bg-[var(--amber)]/10 text-[var(--amber)]/70'
            }`}>{inboxCount}</span>
          )}
        </button>
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

function BuiltInMindSpaces({
  title,
  slots,
  onOpen,
}: {
  title: string;
  slots: MindSystemSlot[];
  onOpen: (path: string) => void;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(true);
  const visibleSlots = slots.length > 0 ? slots : [];

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(MIND_SYSTEM_COLLAPSED_KEY) !== '0');
    } catch { /* localStorage unavailable */ }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(MIND_SYSTEM_COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* localStorage unavailable */ }
      return next;
    });
  }, []);

  if (visibleSlots.length === 0) return null;

  return (
    <section className="mb-2 px-1 pb-2 border-b border-border/40" aria-label={title}>
      <button
        type="button"
        onClick={toggleCollapsed}
        data-state={collapsed ? 'collapsed' : 'expanded'}
        data-hit-active={collapsed ? undefined : 'true'}
        aria-expanded={!collapsed}
        aria-controls={MIND_SYSTEM_SLOT_LIST_ID}
        className={`hit-target-box mb-1 flex w-full items-center gap-2 border border-transparent px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-border-width:1px] [--hit-target-radius:var(--radius-lg)] ${
          collapsed
            ? '[--hit-target-border:color-mix(in_srgb,var(--border)_70%,transparent)] [--hit-target-hover-border:var(--border)] [--hit-target-bg:var(--card)] [--hit-target-hover-bg:var(--muted)]'
            : '[--hit-target-active-border:color-mix(in_srgb,var(--amber)_20%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--amber)_35%,transparent)] [--hit-target-active-bg:var(--amber-subtle)] [--hit-target-hover-bg:var(--amber-dim)]'
        }`}
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors ${
          collapsed
            ? 'bg-[var(--amber)]/8 text-[var(--amber)]/70'
            : 'bg-[var(--amber)]/10 text-[var(--amber)]'
        }`}>
          <Activity size={15} strokeWidth={2.2} className="shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 py-0.5">
          <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted-foreground/60 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed && (
        <div id={MIND_SYSTEM_SLOT_LIST_ID} className="space-y-0.5">
          {visibleSlots.map((item) => {
            const copy = t.home.mindPillars[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onOpen(item.path)}
                data-mind-system-sidebar-open={item.key}
                className="hit-target-box flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [--hit-target-hover-bg:var(--muted)] [--hit-target-radius:var(--radius-md)]"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-background/40 text-[11px] font-semibold text-[var(--amber)]">
                  {item.label}
                </span>
                <span className="block min-w-0 flex-1 truncate">{copy?.desc ?? item.role}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export { DEFAULT_PANEL_WIDTH as PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH_RATIO, MAX_PANEL_WIDTH_ABS };
