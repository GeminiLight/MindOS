'use client';

import { useState, useCallback, useRef, useTransition, useEffect, memo, useMemo, createContext, useContext } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { FileNode, SYSTEM_FILES, UNDELETABLE_FILES, type MindSystemNodeKey } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { ICON_SIZES } from '@/lib/config/icon-scale';
import {
  ChevronDown, FileText, Table, Folder, FolderOpen, Loader2,
  Trash2, Pencil, Layers, Copy, MoreHorizontal, Star, Inbox,
  Compass, ScrollText, Route, Wrench, MessageSquarePlus, History,
} from 'lucide-react';
import { createFileAction, deleteFileAction, renameFileAction, renameSpaceAction, deleteSpaceAction, deleteFolderAction, undoDeleteAction } from '@/lib/actions';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import {
  STABLE_ROW_DISCLOSURE_SLOT_CLASS,
  StableRowActionButton,
  StableRowDisclosureSlot,
  StableRowTrailingSlot,
} from '@/components/shared/StableRowChrome';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import { useShowHiddenFiles, setShowHiddenFiles, filterHiddenNodes } from '@/lib/stores/hidden-files';
import { notifyFilesChanged } from '@/lib/files-changed';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { requestAddAskContext } from '@/lib/ask-context-events';
import { openMindPathInFileManager } from '@/lib/open-in-file-manager';
import { ContextMenuShell, SpaceContextMenu, FolderContextMenu, MENU_ITEM, MENU_DANGER, MENU_DIVIDER, type ContextMenuAlign } from '@/components/file-tree/FileTreeContextMenus';
import { useDirectoryDragDrop } from '@/lib/hooks/useDirectoryDragDrop';
import { ActivePathContext, createActivePathStore, useIsActiveFile, useIsOnActivePath, type ActivePathStore } from '@/components/file-tree/active-path';
import { agentReviewHref } from '@/lib/agent-review-links';
import { useAgentChangeReview } from '@/hooks/useAgentChangeReview';

async function copyPathToClipboard(path: string) {
  try { await navigator.clipboard.writeText(path); } catch { /* noop */ }
}

type RowContextMenuState = { x: number; y: number; align?: ContextMenuAlign };

const EMPTY_AGENT_REVIEW_PATHS = new Set<string>();
const AgentReviewPathsContext = createContext<ReadonlySet<string>>(EMPTY_AGENT_REVIEW_PATHS);

function useHasPendingAgentReview(path: string): boolean {
  return useContext(AgentReviewPathsContext).has(path);
}

interface FileTreeProps {
  nodes: FileNode[];
  depth?: number;
  onNavigate?: () => void;
  maxOpenDepth?: number | null;
  defaultOpenDepth?: number;
  parentIsSpace?: boolean;
  onImport?: (space: string) => void;
}

function getIcon(node: FileNode) {
  if (node.type === 'directory') return null;
  if (node.extension === '.csv') return <Table size={ICON_SIZES.md} className="text-success shrink-0" />;
  return <FileText size={ICON_SIZES.md} className="text-muted-foreground shrink-0" />;
}

function getMindSystemIcon(key: MindSystemNodeKey | undefined, active = false) {
  const className = active
    ? 'shrink-0 text-[var(--amber)]'
    : 'shrink-0 text-[var(--amber)]/70';

  switch (key) {
    case 'dao':
      return <Compass size={14} strokeWidth={2.1} className={className} />;
    case 'fa':
      return <ScrollText size={14} strokeWidth={2.1} className={className} />;
    case 'shu':
      return <Route size={14} strokeWidth={2.1} className={className} />;
    case 'qi':
      return <Wrench size={14} strokeWidth={2.1} className={className} />;
    default:
      return <Layers size={14} className={className} />;
  }
}

function getCurrentFilePath(pathname: string): string {
  const prefix = '/view/';
  if (!pathname.startsWith(prefix)) return '';
  const encoded = pathname.slice(prefix.length);
  return encoded.split('/').map(decodeURIComponent).join('/');
}

function queryFileRowByPath(path: string): HTMLElement | null {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return document.querySelector(`[data-filepath="${CSS.escape(path)}"]`) as HTMLElement | null;
  }

  return Array.from(document.querySelectorAll<HTMLElement>('[data-filepath]'))
    .find(el => el.dataset.filepath === path) ?? null;
}

// Counts are cached per node identity: the server sends a fresh tree object on
// every refresh, so a WeakMap keyed on the node is invalidated exactly when the
// data actually changes, and collapsed-space badges stop re-walking the whole
// subtree on every render.
const contentFileCounts = new WeakMap<FileNode, number>();

export function countContentFiles(node: FileNode): number {
  const cached = contentFileCounts.get(node);
  if (cached !== undefined) return cached;
  const count = node.type === 'file'
    ? (SYSTEM_FILES.has(node.name) ? 0 : 1)
    : (node.children ?? []).reduce((sum, c) => sum + countContentFiles(c), 0);
  contentFileCounts.set(node, count);
  return count;
}

/**
 * Returns a stable function identity that always calls the latest `fn`.
 * Row components are memoized; threading possibly-inline parent callbacks
 * through this keeps their props referentially stable across re-renders.
 */
function useStableHandler<Args extends unknown[]>(fn: ((...args: Args) => void) | undefined): (...args: Args) => void {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  return useCallback((...args: Args) => { ref.current?.(...args); }, []);
}

// Offscreen rows skip layout/paint entirely; 28px matches the row min-height
// (min-h-7) so the scrollbar stays accurate before rows are first rendered.
const ROW_CONTENT_VISIBILITY = '[content-visibility:auto] [contain-intrinsic-block-size:auto_28px]';

let markdownEditorWarmup: Promise<unknown> | null = null;

function shouldWarmMarkdownEditorChunk(): boolean {
  if (typeof window === 'undefined') return false;
  const mode = window.localStorage.getItem('md-view-mode');
  return mode === null || mode === 'wysiwyg';
}

function warmMarkdownEditorChunkIfNeeded() {
  if (markdownEditorWarmup || !shouldWarmMarkdownEditorChunk()) return;
  markdownEditorWarmup = import('@/components/WysiwygEditor').catch(() => {
    markdownEditorWarmup = null;
  });
}

// ─── NewFileInline ────────────────────────────────────────────────────────────

function NewFileInline({ dirPath, depth, onDone }: { dirPath: string; depth: number; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(() => {
    const name = value.trim();
    if (!name) { setError(t.fileTree.enterFileName); return; }
    startTransition(async () => {
      const result = await createFileAction(dirPath, name);
      if (result.success && result.filePath) {
        onDone();
        smoothPush(`/view/${encodePath(result.filePath)}`);
        router.refresh();
        notifyFilesChanged([result.filePath]);
      } else {
        setError(result.error || t.fileTree.failed);
      }
    });
  }, [value, dirPath, onDone, router, smoothPush, t]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onDone();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [onDone]);

  return (
    <div ref={containerRef} className="px-2 pb-1" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') onDone();
          }}
          placeholder="filename.md"
          className="
            flex-1 bg-muted border border-border rounded px-2 py-1
            text-xs text-foreground placeholder:text-muted-foreground
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
          "
        />
        {isPending
          ? <Loader2 size={13} className="text-muted-foreground animate-spin shrink-0" />
          : (
            <button
              onClick={handleSubmit}
              className="text-xs text-[var(--amber)] hover:text-foreground shrink-0 px-1"
            >
              {t.fileTree.create}
            </button>
          )
        }
      </div>
      {error && <p className="text-xs text-error mt-0.5 px-1">{error}</p>}
    </div>
  );
}

// ─── DirectoryNode ────────────────────────────────────────────────────────────

const DirectoryNode = memo(function DirectoryNode({ node, depth, onNavigate, maxOpenDepth, defaultOpenDepth = 0, onImport }: {
  node: FileNode; depth: number; onNavigate?: () => void;
  maxOpenDepth?: number | null; defaultOpenDepth?: number; onImport?: (space: string) => void;
}) {
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  // Subscribed boolean: this row only re-renders when its containment of the
  // active path flips, not on every navigation (see active-path.ts).
  const isActive = useIsOnActivePath(node.path);
  const isSpace = !!node.isSpace;
  const initiallyOpen = depth <= defaultOpenDepth || isActive;
  const [open, setOpen] = useState(initiallyOpen);
  // Track whether this directory has ever been opened — only render children after first open.
  // This avoids mounting hundreds of hidden components for deep trees that haven't been explored.
  const [hasBeenOpened, setHasBeenOpened] = useState(initiallyOpen);
  const [showNewFile, setShowNewFile] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isPending, startTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<RowContextMenuState | null>(null);
  const { t } = useLocale();
  const [deleteConfirm, setDeleteConfirm] = useState<null | 'space' | 'folder'>(null);
  const [, startDeleteTransition] = useTransition();

  // ── External file drop target (from hook) ──
  // Wrap setOpen so drag-expand also marks the directory as opened for lazy rendering
  const setOpenWithTracking = useCallback((v: boolean) => {
    setOpen(v);
    if (v) setHasBeenOpened(true);
  }, []);
  const { isDragTarget, handleRowDragOver, handleRowDragEnter, handleRowDragLeave, handleRowDrop } = useDirectoryDragDrop(node, open, setOpenWithTracking, t);

  const toggle = useCallback(() => {
    setOpen(v => {
      if (!v) setHasBeenOpened(true);
      return !v;
    });
  }, []);

  const prevMaxOpenDepth = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (maxOpenDepth === null || maxOpenDepth === undefined) {
      prevMaxOpenDepth.current = maxOpenDepth;
      return;
    }
    if (prevMaxOpenDepth.current !== maxOpenDepth) {
      const enteringControlled = prevMaxOpenDepth.current === null || prevMaxOpenDepth.current === undefined;
      if (enteringControlled) {
        if (depth > maxOpenDepth) setOpen(false);
        else setHasBeenOpened(true);
      } else {
        const shouldOpen = depth <= maxOpenDepth;
        setOpen(shouldOpen);
        if (shouldOpen) setHasBeenOpened(true);
      }
      prevMaxOpenDepth.current = maxOpenDepth;
    }
  }, [maxOpenDepth, depth]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  const startRename = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setRenameValue(node.name);
    setRenaming(true);
    setTimeout(() => renameRef.current?.select(), 0);
  }, [node.name]);

  const commitRename = useCallback(() => {
    const newName = renameValue.trim();
    if (!newName || newName === node.name) { setRenaming(false); return; }
    startTransition(async () => {
      const action = isSpace ? renameSpaceAction : renameFileAction;
      const result = await action(node.path, newName);
      if (result.success && result.newPath) {
        setRenaming(false);
        smoothPush(`/view/${encodePath(result.newPath)}`);
        router.refresh();
        notifyFilesChanged([node.path, result.newPath]);
      } else {
        setRenaming(false);
      }
    });
  }, [renameValue, node.name, node.path, router, smoothPush, isSpace]);

  const handleSingleClick = useCallback(() => {
    if (renaming) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      smoothPush(`/view/${encodePath(node.path)}`);
      onNavigate?.();
      clickTimerRef.current = null;
    }, 180);
  }, [renaming, smoothPush, node.path, onNavigate]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  if (renaming) {
    return (
      <div className="relative px-2 py-0.5" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <input
          ref={renameRef}
          autoFocus
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={commitRename}
          className="w-full bg-muted border border-border rounded px-2 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {isPending && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  const showBorder = isSpace && depth === 0;
  const spaceRowActive = isSpace && isActive;
  const spaceIconClassName = spaceRowActive
    ? 'shrink-0 text-[var(--amber)]'
    : 'shrink-0 text-[var(--amber)]/70';

  return (
    <div>
      <div
        className={`relative group group/dir flex items-center transition-colors duration-100 ${ROW_CONTENT_VISIBILITY} ${
          isDragTarget ? 'bg-[var(--amber)]/10 rounded-md' : ''
        } ${
          spaceRowActive ? 'rounded-md bg-muted/70' : ''
        }`}
        onContextMenu={handleContextMenu}
        onDragEnter={handleRowDragEnter}
        onDragOver={handleRowDragOver}
        onDragLeave={handleRowDragLeave}
        onDrop={handleRowDrop}
      >
        <button
          type="button"
          onClick={toggle}
          data-stable-row-disclosure
          className={`hit-target-box inline-flex h-7 w-7 shrink-0 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-radius:var(--radius-md)] ${
            isSpace
              ? '[--hit-target-hover-bg:transparent] [--hit-target-active-bg:transparent] hover:text-[var(--amber)]'
              : '[--hit-target-hover-bg:var(--muted)] hover:text-foreground'
          } ${
            spaceRowActive ? 'text-[var(--amber)]' : 'text-muted-foreground'
          } ${STABLE_ROW_DISCLOSURE_SLOT_CLASS}`}
          style={{ marginLeft: `${depth * 12 + 4}px` }}
          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={open}
        >
          <span className="block transition-transform duration-150" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            <ChevronDown size={ICON_SIZES.xs} />
          </span>
        </button>
        <button
          type="button"
          onClick={handleSingleClick}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/mindos-path', node.path);
            e.dataTransfer.setData('text/mindos-type', 'directory');
            e.dataTransfer.effectAllowed = 'copy';
          }}
          data-filepath={node.path}
          data-hit-active={isActive ? 'true' : undefined}
          className={`
            hit-target-box flex-1 flex min-h-7 items-center gap-1.5 px-1 text-left min-w-0
            text-sm transition-colors duration-100
            cursor-default [--hit-target-radius:var(--radius-sm)]
            ${isSpace
              ? '[--hit-target-hover-bg:transparent] [--hit-target-active-bg:transparent]'
              : '[--hit-target-hover-bg:var(--muted)] [--hit-target-active-bg:var(--muted)]'
            }
            ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}
          `}
        >
          {isSpace
            ? node.isMindSystem
              ? getMindSystemIcon(node.mindSystemKey, spaceRowActive)
              : node.name === 'Inbox'
                ? <Inbox size={14} className={spaceIconClassName} />
                : <Layers size={14} className={spaceIconClassName} />
            : open
              ? <FolderOpen size={14} className="text-yellow-400 shrink-0" />
              : <Folder size={14} className="text-yellow-400 shrink-0" />
          }
          <span className="truncate leading-5" suppressHydrationWarning>{node.name}</span>
        </button>
        <StableRowTrailingSlot
          className="mr-1"
          forceActionsVisible={Boolean(contextMenu)}
          actions={(
            <StableRowActionButton
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ x: rect.right, y: rect.bottom + 6, align: 'end' });
              }}
              title="More"
            >
              <MoreHorizontal size={14} />
            </StableRowActionButton>
          )}
        />
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div
          className={`overflow-hidden ${open && hasBeenOpened ? 'pt-1' : ''} ${showBorder ? 'ml-[18px] border-l-2 border-[var(--amber)]/30' : ''}`}
          {...(!open && { inert: true } as React.HTMLAttributes<HTMLDivElement>)}
        >
          {hasBeenOpened && node.children && (
            <FileTree
              nodes={node.children}
              depth={showBorder ? 1 : depth + 1}
              onNavigate={onNavigate}
              maxOpenDepth={maxOpenDepth}
              defaultOpenDepth={defaultOpenDepth}
              parentIsSpace={isSpace}
              onImport={onImport}
            />
          )}
          {showNewFile && (
            <NewFileInline
              dirPath={node.path}
              depth={showBorder ? 0 : depth}
              onDone={() => setShowNewFile(false)}
            />
          )}
        </div>
      </div>

      {contextMenu && (isSpace ? (
        <SpaceContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          node={node}
          onClose={() => setContextMenu(null)}
          onRename={() => startRename()}
          onNewFile={() => { setOpen(true); setHasBeenOpened(true); setShowNewFile(true); }}
          onImport={onImport}
          onDelete={() => setDeleteConfirm('space')}
        />
      ) : (
        <FolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          node={node}
          onClose={() => setContextMenu(null)}
          onRename={() => startRename()}
          onNewFile={() => { setOpen(true); setHasBeenOpened(true); setShowNewFile(true); }}
          onDelete={() => setDeleteConfirm('folder')}
        />
      ))}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title={deleteConfirm === 'space' ? t.fileTree.deleteSpace : t.fileTree.deleteFolder}
        message={deleteConfirm === 'space' ? t.fileTree.confirmDeleteSpace(node.name) : t.fileTree.confirmDeleteFolder(node.name)}
        confirmLabel={deleteConfirm === 'space' ? t.fileTree.deleteSpace : t.fileTree.deleteFolder}
        cancelLabel={t.view?.cancel ?? 'Cancel'}
        variant="destructive"
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => {
          const kind = deleteConfirm;
          setDeleteConfirm(null);
          startDeleteTransition(async () => {
            const result = kind === 'space'
              ? await deleteSpaceAction(node.path)
              : await deleteFolderAction(node.path);
            if (result.success && result.trashId) {
              const trashId = result.trashId;
              const name = node.path.split('/').pop() ?? node.path;
              toast.undo(`${t.trash?.movedToTrash ?? 'Deleted'} ${name}`, async () => {
                const undo = await undoDeleteAction(trashId);
                if (undo.success) { router.refresh(); notifyFilesChanged([node.path]); }
                else toast.error(undo.error ?? 'Undo failed');
              }, { label: t.trash?.undo ?? 'Undo' });
              smoothPush('/'); router.refresh(); notifyFilesChanged([node.path]);
            }
          });
        }}
      />

    </div>
  );
});

// ─── FileNodeItem ─────────────────────────────────────────────────────────────

const FileNodeItem = memo(function FileNodeItem({ node, depth, onNavigate }: {
  node: FileNode; depth: number; onNavigate?: () => void;
}) {
  const router = useRouter();
  const smoothPush = useSmoothRouterPush();
  const href = useMemo(() => `/view/${encodePath(node.path)}`, [node.path]);
  // Subscribed boolean: this row only re-renders when it becomes (in)active.
  const isActive = useIsActiveFile(node.path);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isPending, startTransition] = useTransition();
  const [, startDeleteTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(node.path);
  const hasPendingAgentReview = useHasPendingAgentReview(node.path);
  const reviewLabel = t.fileTree.reviewAgentChanges ?? 'Review changes';
  const isProtected = !node.path.includes('/') && UNDELETABLE_FILES.has(node.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<RowContextMenuState | null>(null);
  const [opening, setOpening] = useState(false);
  const openingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchedHrefRef = useRef<string>('');

  useEffect(() => {
    if (!isActive || !opening) return;
    setOpening(false);
    if (openingTimerRef.current) {
      clearTimeout(openingTimerRef.current);
      openingTimerRef.current = null;
    }
  }, [isActive, opening]);

  useEffect(() => {
    return () => {
      if (openingTimerRef.current) clearTimeout(openingTimerRef.current);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, []);

  const warmRoute = useCallback(() => {
    if (prefetchedHrefRef.current === href) return;
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null;
      prefetchedHrefRef.current = href;
      router.prefetch?.(href);
      if (node.extension === '.md') warmMarkdownEditorChunkIfNeeded();
    }, 80);
  }, [href, node.extension, router]);

  const handleClick = useCallback(() => {
    if (renaming) return;
    if (!isActive) {
      setOpening(true);
      if (openingTimerRef.current) clearTimeout(openingTimerRef.current);
      openingTimerRef.current = setTimeout(() => {
        setOpening(false);
        openingTimerRef.current = null;
      }, 1200);
    }
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
    prefetchedHrefRef.current = href;
    router.prefetch?.(href);
    smoothPush(href);
    onNavigate?.();
  }, [href, isActive, router, smoothPush, onNavigate, renaming]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(node.name);
    setRenaming(true);
    setTimeout(() => renameRef.current?.select(), 0);
  }, [node.name]);

  const commitRename = useCallback(() => {
    const newName = renameValue.trim();
    if (!newName || newName === node.name) { setRenaming(false); return; }
    startTransition(async () => {
      const result = await renameFileAction(node.path, newName);
      if (result.success && result.newPath) {
        setRenaming(false);
        smoothPush(`/view/${encodePath(result.newPath)}`);
        router.refresh();
        notifyFilesChanged([node.path, result.newPath]);
      } else {
        setRenaming(false);
      }
    });
  }, [renameValue, node.name, node.path, router, smoothPush]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/mindos-path', node.path);
    e.dataTransfer.effectAllowed = 'copy';
  }, [node.path]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenInFileManager = useCallback(() => {
    setContextMenu(null);
    void openMindPathInFileManager(node.path).catch(() => {
      toast.error(t.fileTree.openInFileManagerFailed, 4000);
    });
  }, [node.path, t.fileTree.openInFileManagerFailed]);

  if (renaming) {
    return (
      <div className="relative px-2 py-0.5" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <input
          ref={renameRef}
          autoFocus
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={commitRename}
          className="w-full bg-muted border border-border rounded px-2 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {isPending && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div className="relative group group/file flex items-center">
      <StableRowDisclosureSlot
        className="text-muted-foreground"
        style={{ marginLeft: `${depth * 12 + 4}px` }}
      />
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerEnter={warmRoute}
        onFocus={warmRoute}
        draggable
        onDragStart={handleDragStart}
        data-filepath={node.path}
        data-hit-active={isActive ? 'true' : undefined}
        data-file-opening={opening ? 'true' : undefined}
        aria-busy={opening ? 'true' : undefined}
        className={`
          hit-target-box flex min-h-7 min-w-0 flex-1 items-center gap-1.5 px-2 text-left
          text-sm transition-colors duration-100 cursor-default
          ${ROW_CONTENT_VISIBILITY}
          [--hit-target-hover-bg:var(--muted)] [--hit-target-active-bg:var(--accent)] [--hit-target-radius:var(--radius-sm)]
          ${isActive || opening
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'
          }
        `}
      >
        {getIcon(node)}
        <span className="truncate leading-5" suppressHydrationWarning>{node.name}</span>
      </button>
      <StableRowTrailingSlot
        className="mr-1"
        forceActionsVisible={Boolean(contextMenu)}
        reserveClassName={hasPendingAgentReview ? 'w-14' : 'w-8'}
        status={(pinned || hasPendingAgentReview) ? (
          <span className="inline-flex items-center justify-end gap-1" title={hasPendingAgentReview ? reviewLabel : undefined}>
            {hasPendingAgentReview && (
              <span
                data-agent-review-dot
                className="h-1.5 w-1.5 rounded-full bg-[var(--amber)] shadow-[0_0_0_2px_var(--background)]"
              >
                <span className="sr-only">{reviewLabel}</span>
              </span>
            )}
            {pinned && <Star size={10} className="fill-[var(--amber)] text-[var(--amber)] opacity-70" />}
          </span>
        ) : null}
        actions={(
          <>
            {hasPendingAgentReview && (
              <StableRowActionButton
                tone="amber"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  smoothPush(agentReviewHref(node.path));
                }}
                title={reviewLabel}
              >
                <History size={14} />
              </StableRowActionButton>
            )}
            <StableRowActionButton
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setContextMenu({ x: rect.right, y: rect.bottom + 6, align: 'end' });
              }}
              title="More"
            >
              <MoreHorizontal size={14} />
            </StableRowActionButton>
          </>
        )}
      />
      {contextMenu && (
        <ContextMenuShell
          x={contextMenu.x}
          y={contextMenu.y}
          align={contextMenu.align}
          onClose={() => setContextMenu(null)}
          menuHeight={220}
        >
          <button className={MENU_ITEM} onClick={() => { requestAddAskContext({ path: node.path, type: 'file', label: node.name }); toast.success(t.fileTree.addedAsContext, 1600); setContextMenu(null); }}>
            <MessageSquarePlus size={14} className="shrink-0" /> {t.fileTree.addAsContext}
          </button>
          <button className={MENU_ITEM} onClick={handleOpenInFileManager}>
            <FolderOpen size={14} className="shrink-0" /> {t.fileTree.openInFileManager}
          </button>
          {hasPendingAgentReview && (
            <button className={MENU_ITEM} onClick={() => { setContextMenu(null); smoothPush(agentReviewHref(node.path)); }}>
              <History size={14} className="shrink-0 text-[var(--amber)]" /> {reviewLabel}
            </button>
          )}
          <button className={MENU_ITEM} onClick={() => { copyPathToClipboard(node.path); setContextMenu(null); }}>
            <Copy size={14} className="shrink-0" /> {t.fileTree.copyPath}
          </button>
          <button className={MENU_ITEM} onClick={() => { togglePin(node.path); setContextMenu(null); }}>
            <Star size={14} className={`shrink-0 ${pinned ? 'fill-[var(--amber)] text-[var(--amber)]' : ''}`} />
            {pinned ? t.fileTree.removeFromFavorites : t.fileTree.pinToFavorites}
          </button>
          {!isProtected && (
            <button className={MENU_ITEM} onClick={(e) => { setContextMenu(null); startRename(e); }}>
              <Pencil size={14} className="shrink-0" /> {t.fileTree.rename}
            </button>
          )}
          {!isProtected && <>
            <div className={MENU_DIVIDER} />
            <button className={MENU_DANGER} onClick={(e) => { setContextMenu(null); handleDelete(e); }}>
              <Trash2 size={14} className="shrink-0" /> {t.fileTree.delete}
            </button>
          </>}
        </ContextMenuShell>
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t.fileTree.delete}
        message={t.fileTree.confirmDelete(node.name)}
        confirmLabel={t.fileTree.delete}
        cancelLabel={t.view?.cancel ?? 'Cancel'}
        variant="destructive"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          startDeleteTransition(async () => {
            const result = await deleteFileAction(node.path);
            if (result.success) {
              if (result.trashId) {
                const trashId = result.trashId;
                const name = node.path.split('/').pop() ?? node.path;
                toast.undo(`${t.trash?.movedToTrash ?? 'Deleted'} ${name}`, async () => {
                  const undo = await undoDeleteAction(trashId);
                  if (undo.success) { router.refresh(); notifyFilesChanged([node.path]); }
                  else toast.error(undo.error ?? 'Undo failed');
                }, { label: t.trash?.undo ?? 'Undo' });
              }
              router.refresh(); notifyFilesChanged([node.path]);
            }
          });
        }}
      />
    </div>
  );
});

// ─── FileTree ─────────────────────────────────────────────────────────────────
//
// Split into three layers so navigation stays O(changed rows):
//   FileTree (dispatcher) → FileTreeRoot (depth 0: pathname subscription,
//   active-path store, scroll-into-view) → FileTreeList (pure row mapping,
//   also used directly for nested levels so they never subscribe to pathname).

export default function FileTree(props: FileTreeProps) {
  if ((props.depth ?? 0) > 0) return <FileTreeList {...props} />;
  return <FileTreeRoot {...props} />;
}

function FileTreeRoot(props: FileTreeProps) {
  const pathname = usePathname();
  const currentPath = getCurrentFilePath(pathname);
  const agentReview = useAgentChangeReview({ limit: 200 });

  // The store lives for the lifetime of the tree; rows subscribe to derived
  // booleans so only the rows affected by a navigation re-render.
  const [store] = useState<ActivePathStore>(() => createActivePathStore(currentPath));
  useEffect(() => { store.set(currentPath); }, [store, currentPath]);

  // Parent callbacks may be inline; stabilize them once at the root so the
  // memoized rows below never see a changed function identity.
  const onNavigate = useStableHandler(props.onNavigate);
  const onImport = useStableHandler(props.onImport);

  useEffect(() => {
    if (!currentPath) return;
    const timer = setTimeout(() => {
      const el = queryFileRowByPath(currentPath);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(timer);
  }, [currentPath]);

  return (
    <ActivePathContext.Provider value={store}>
      <AgentReviewPathsContext.Provider value={agentReview.unreviewedPaths}>
        <FileTreeList {...props} onNavigate={onNavigate} onImport={onImport} />
      </AgentReviewPathsContext.Provider>
    </ActivePathContext.Provider>
  );
}

const FileTreeList = memo(function FileTreeList({ nodes, depth = 0, onNavigate, maxOpenDepth, defaultOpenDepth, onImport }: FileTreeProps) {
  const showHidden = useShowHiddenFiles();
  const isRoot = depth === 0;

  // Memoize filtering to avoid re-computing on every render
  const visibleNodes = useMemo(() => {
    const filtered = showHidden ? nodes : filterHiddenNodes(nodes, isRoot);
    return isRoot
      ? filtered.filter(n => !(n.type === 'directory' && n.name === 'Inbox'))
      : filtered;
  }, [nodes, showHidden, isRoot]);

  return (
    <div className="flex flex-col gap-0.5">
      {visibleNodes.map((node) =>
        node.type === 'directory' ? (
          <DirectoryNode key={node.path} node={node} depth={depth} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} defaultOpenDepth={defaultOpenDepth} onImport={onImport} />
        ) : (
          <FileNodeItem key={node.path} node={node} depth={depth} onNavigate={onNavigate} />
        )
      )}
    </div>
  );
});
