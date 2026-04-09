'use client';

import { useState, useCallback, useRef, useTransition, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { FileNode, SYSTEM_FILES, UNDELETABLE_FILES } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { ICON_SIZES } from '@/lib/config/icon-scale';
import {
  ChevronDown, FileText, Table, Folder, FolderOpen, Plus, Loader2,
  Trash2, Pencil, Layers, Copy, MoreHorizontal, Star, Inbox,
} from 'lucide-react';
import { createFileAction, deleteFileAction, renameFileAction, renameSpaceAction, deleteSpaceAction, deleteFolderAction, undoDeleteAction } from '@/lib/actions';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { ConfirmDialog } from '@/components/agents/AgentsPrimitives';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import { useShowHiddenFiles, setShowHiddenFiles, filterHiddenNodes } from '@/lib/stores/hidden-files';

// Re-export for backward compatibility (Panel.tsx, KnowledgeTab.tsx import from FileTree)
export { setShowHiddenFiles, useShowHiddenFiles };
import { ContextMenuShell, SpaceContextMenu, FolderContextMenu, MENU_ITEM, MENU_DANGER, MENU_DIVIDER } from '@/components/file-tree/FileTreeContextMenus';
import { useDirectoryDragDrop } from '@/lib/hooks/useDirectoryDragDrop';

function notifyFilesChanged() {
  window.dispatchEvent(new Event('mindos:files-changed'));
}

async function copyPathToClipboard(path: string) {
  try { await navigator.clipboard.writeText(path); } catch { /* noop */ }
}

interface FileTreeProps {
  nodes: FileNode[];
  depth?: number;
  onNavigate?: () => void;
  maxOpenDepth?: number | null;
  parentIsSpace?: boolean;
  onImport?: (space: string) => void;
}

function getIcon(node: FileNode) {
  if (node.type === 'directory') return null;
  if (node.extension === '.csv') return <Table size={ICON_SIZES.md} className="text-success shrink-0" />;
  return <FileText size={ICON_SIZES.md} className="text-muted-foreground shrink-0" />;
}

function getCurrentFilePath(pathname: string): string {
  const prefix = '/view/';
  if (!pathname.startsWith(prefix)) return '';
  const encoded = pathname.slice(prefix.length);
  return encoded.split('/').map(decodeURIComponent).join('/');
}

function countContentFiles(node: FileNode): number {
  if (node.type === 'file') return SYSTEM_FILES.has(node.name) ? 0 : 1;
  return (node.children ?? []).reduce((sum, c) => sum + countContentFiles(c), 0);
}

// ─── NewFileInline ────────────────────────────────────────────────────────────

function NewFileInline({ dirPath, depth, onDone }: { dirPath: string; depth: number; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const router = useRouter();
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(() => {
    const name = value.trim();
    if (!name) { setError(t.fileTree.enterFileName); return; }
    startTransition(async () => {
      const result = await createFileAction(dirPath, name);
      if (result.success && result.filePath) {
        onDone();
        router.push(`/view/${encodePath(result.filePath)}`);
        router.refresh();
        notifyFilesChanged();
      } else {
        setError(result.error || t.fileTree.failed);
      }
    });
  }, [value, dirPath, onDone, router, t]);

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

function DirectoryNode({ node, depth, currentPath, onNavigate, maxOpenDepth, onImport }: {
  node: FileNode; depth: number; currentPath: string; onNavigate?: () => void;
  maxOpenDepth?: number | null; onImport?: (space: string) => void;
}) {
  const router = useRouter();
  const isActive = currentPath.startsWith(node.path + '/') || currentPath === node.path;
  const isSpace = !!node.isSpace;
  const [open, setOpen] = useState(depth === 0 ? true : isActive);
  const [showNewFile, setShowNewFile] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isPending, startTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const { t } = useLocale();
  const [deleteConfirm, setDeleteConfirm] = useState<null | 'space' | 'folder'>(null);
  const [isPendingDelete, startDeleteTransition] = useTransition();

  // ── External file drop target (from hook) ──
  const { isDragTarget, handleRowDragOver, handleRowDragEnter, handleRowDragLeave, handleRowDrop } = useDirectoryDragDrop(node, open, setOpen, t);

  const toggle = useCallback(() => setOpen(v => !v), []);

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
      } else {
        setOpen(depth <= maxOpenDepth);
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
        router.push(`/view/${encodePath(result.newPath)}`);
        router.refresh();
        notifyFilesChanged();
      } else {
        setRenaming(false);
      }
    });
  }, [renameValue, node.name, node.path, router, isSpace]);

  const handleSingleClick = useCallback(() => {
    if (renaming) return;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      router.push(`/view/${encodePath(node.path)}`);
      onNavigate?.();
      clickTimerRef.current = null;
    }, 180);
  }, [renaming, router, node.path, onNavigate]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Double-click to toggle expand/collapse
    toggle();
  }, [toggle]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contentCount = isSpace ? countContentFiles(node) : 0;

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

  return (
    <div>
      <div
        className={`relative group/dir flex items-center transition-colors duration-100 ${
          isDragTarget ? 'bg-[var(--amber)]/10 rounded-md' : ''
        }`}
        onContextMenu={handleContextMenu}
        onDragEnter={handleRowDragEnter}
        onDragOver={handleRowDragOver}
        onDragLeave={handleRowDragLeave}
        onDrop={handleRowDrop}
      >
        <button
          onClick={toggle}
          className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
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
          className={`
            flex-1 flex items-center gap-1.5 px-1 py-1 rounded text-left min-w-0 pr-16
            text-sm transition-colors duration-100
            hover:bg-muted cursor-default
            ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}
          `}
        >
          {isSpace
            ? node.name === 'Inbox'
              ? <Inbox size={14} className="shrink-0 text-[var(--amber)]" />
              : <Layers size={14} className="shrink-0 text-[var(--amber)]" />
            : open
              ? <FolderOpen size={14} className="text-yellow-400 shrink-0" />
              : <Folder size={14} className="text-yellow-400 shrink-0" />
          }
          <span className="truncate leading-5" suppressHydrationWarning>{node.name}</span>
          {isSpace && !open && (
            <span className="ml-auto text-xs text-muted-foreground shrink-0 tabular-nums pr-1">{contentCount}</span>
          )}
        </button>
        <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/dir:flex items-center gap-0.5 z-10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setContextMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="More"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div
          className={`overflow-hidden ${showBorder ? 'border-l-2 ml-[18px]' : ''}`}
          style={showBorder ? { borderColor: 'color-mix(in srgb, var(--amber) 30%, transparent)' } : undefined}
          {...(!open && { inert: true } as React.HTMLAttributes<HTMLDivElement>)}
        >
          {node.children && (
            <FileTree
              nodes={node.children}
              depth={showBorder ? 1 : depth + 1}
              onNavigate={onNavigate}
              maxOpenDepth={maxOpenDepth}
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
          node={node}
          onClose={() => setContextMenu(null)}
          onRename={() => startRename()}
          onNewFile={() => { setOpen(true); setShowNewFile(true); }}
          onImport={onImport}
          onDelete={() => setDeleteConfirm('space')}
        />
      ) : (
        <FolderContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={node}
          onClose={() => setContextMenu(null)}
          onRename={() => startRename()}
          onNewFile={() => { setOpen(true); setShowNewFile(true); }}
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
                if (undo.success) { router.refresh(); notifyFilesChanged(); }
                else toast.error(undo.error ?? 'Undo failed');
              }, { label: t.trash?.undo ?? 'Undo' });
              router.push('/'); router.refresh(); notifyFilesChanged();
            }
          });
        }}
      />

    </div>
  );
}

// ─── FileNodeItem ─────────────────────────────────────────────────────────────

function FileNodeItem({ node, depth, currentPath, onNavigate }: {
  node: FileNode; depth: number; currentPath: string; onNavigate?: () => void;
}) {
  const router = useRouter();
  const isActive = currentPath === node.path;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isPending, startTransition] = useTransition();
  const [, startDeleteTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(node.path);
  const isProtected = !node.path.includes('/') && UNDELETABLE_FILES.has(node.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = useCallback(() => {
    if (renaming) return;
    router.push(`/view/${encodePath(node.path)}`);
    onNavigate?.();
  }, [router, node.path, onNavigate, renaming]);

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
        router.push(`/view/${encodePath(result.newPath)}`);
        router.refresh();
        notifyFilesChanged();
      } else {
        setRenaming(false);
      }
    });
  }, [renameValue, node.name, node.path, router]);

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
    <div className="relative group/file">
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        data-filepath={node.path}
        className={`
          w-full flex items-center gap-1.5 px-2 py-1 rounded text-left
          text-sm transition-colors duration-100 cursor-default pr-16
          ${isActive
            ? 'bg-accent text-foreground'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
          }
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {getIcon(node)}
        <span className="truncate leading-5" suppressHydrationWarning>{node.name}</span>
        {pinned && <Star size={10} className="shrink-0 fill-[var(--amber)] text-[var(--amber)] opacity-60" />}
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/file:flex items-center gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setContextMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="More"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {contextMenu && (
        <ContextMenuShell
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          menuHeight={140}
        >
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
                  if (undo.success) { router.refresh(); notifyFilesChanged(); }
                  else toast.error(undo.error ?? 'Undo failed');
                }, { label: t.trash?.undo ?? 'Undo' });
              }
              router.refresh(); notifyFilesChanged();
            }
          });
        }}
      />
    </div>
  );
}

// ─── FileTree (root) ──────────────────────────────────────────────────────────

export default function FileTree({ nodes, depth = 0, onNavigate, maxOpenDepth, parentIsSpace, onImport }: FileTreeProps) {
  const pathname = usePathname();
  const currentPath = getCurrentFilePath(pathname);
  const showHidden = useShowHiddenFiles();

  const isRoot = depth === 0;
  const filtered = showHidden ? nodes : filterHiddenNodes(nodes, isRoot);
  const visibleNodes = isRoot
    ? filtered.filter(n => !(n.type === 'directory' && n.name === 'Inbox'))
    : filtered;

  useEffect(() => {
    if (!currentPath || depth !== 0) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-filepath="${CSS.escape(currentPath)}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(timer);
  }, [currentPath, depth]);

  return (
    <div className="flex flex-col gap-0.5">
      {visibleNodes.map((node) =>
        node.type === 'directory' ? (
          <DirectoryNode key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} onImport={onImport} />
        ) : (
          <FileNodeItem key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} />
        )
      )}
    </div>
  );
}
