'use client';

import { useState, useCallback, useRef, useTransition, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { FileNode } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import {
  ChevronDown, FileText, Table, Folder, FolderOpen, Plus, Loader2,
  Trash2, Pencil, Layers, ScrollText, BookOpen,
} from 'lucide-react';
import { createFileAction, deleteFileAction, renameFileAction, renameSpaceAction, deleteSpaceAction } from '@/lib/actions';
import { useLocale } from '@/lib/LocaleContext';

const SYSTEM_FILES = new Set(['INSTRUCTION.md', 'README.md']);

interface FileTreeProps {
  nodes: FileNode[];
  depth?: number;
  onNavigate?: () => void;
  maxOpenDepth?: number | null;
  parentIsSpace?: boolean;
}

function getIcon(node: FileNode) {
  if (node.type === 'directory') return null;
  if (node.extension === '.csv') return <Table size={14} className="text-success shrink-0" />;
  return <FileText size={14} className="text-muted-foreground shrink-0" />;
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

function filterVisibleNodes(nodes: FileNode[], parentIsSpace: boolean): FileNode[] {
  return nodes.filter(node => {
    if (node.type !== 'file') return true;
    if (parentIsSpace && SYSTEM_FILES.has(node.name)) return false;
    if (!parentIsSpace && node.name === 'README.md') return false;
    return true;
  });
}

// ─── SpaceHeader ──────────────────────────────────────────────────────────────

function SpacePreviewCard({ icon, title, lines, viewAllLabel, onViewAll }: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  viewAllLabel: string;
  onViewAll: () => void;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="bg-muted/30 border border-border/40 rounded-md px-2.5 py-2">
      <div className="flex items-center gap-1 mb-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-xs text-muted-foreground/80 leading-relaxed truncate">
            · {line}
          </p>
        ))}
      </div>
      <div className="flex justify-end mt-1">
        <button
          onClick={(e) => { e.stopPropagation(); onViewAll(); }}
          className="text-xs hover:underline cursor-pointer transition-colors"
          style={{ color: 'var(--amber)' }}
        >
          {viewAllLabel}
        </button>
      </div>
    </div>
  );
}

function SpaceHeader({ preview, spacePath, depth }: {
  preview: FileNode['spacePreview'];
  spacePath: string;
  depth: number;
}) {
  const router = useRouter();
  const { t } = useLocale();

  if (!preview) return null;
  const hasRules = preview.instructionLines.length > 0;
  const hasAbout = preview.readmeLines.length > 0;
  if (!hasRules && !hasAbout) return null;

  const bothCards = hasRules && hasAbout;

  const content = (
    <div className="flex flex-col gap-1.5">
      {hasRules && (
        <SpacePreviewCard
          icon={<ScrollText size={12} className="text-muted-foreground shrink-0" />}
          title={t.fileTree.rules}
          lines={preview.instructionLines}
          viewAllLabel={t.fileTree.viewAll}
          onViewAll={() => router.push(`/view/${encodePath(`${spacePath}/INSTRUCTION.md`)}`)}
        />
      )}
      {hasAbout && (
        <SpacePreviewCard
          icon={<BookOpen size={12} className="text-muted-foreground shrink-0" />}
          title={t.fileTree.about}
          lines={preview.readmeLines}
          viewAllLabel={t.fileTree.viewAll}
          onViewAll={() => router.push(`/view/${encodePath(`${spacePath}/README.md`)}`)}
        />
      )}
    </div>
  );

  const paddingLeft = (depth + 1) * 12 + 8;

  if (!bothCards) {
    return (
      <div className="mb-1.5 pr-2" style={{ paddingLeft: `${paddingLeft}px` }}>
        {content}
      </div>
    );
  }

  return (
    <div
      className="relative mb-1.5 pr-2 group/header"
      style={{ paddingLeft: `${paddingLeft}px` }}
    >
      <div
        className="max-h-[140px] overflow-y-auto scroll-smooth"
        style={{ overscrollBehavior: 'contain' }}
      >
        {content}
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-2 pointer-events-none"
        style={{ background: 'linear-gradient(transparent, var(--card))' }}
      />
    </div>
  );
}

// ─── SpaceContextMenu ─────────────────────────────────────────────────────────

function SpaceContextMenu({ x, y, node, onClose, onRename }: {
  x: number;
  y: number;
  node: FileNode;
  onClose: () => void;
  onRename: () => void;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  const adjustedY = Math.min(y, window.innerHeight - 160);
  const adjustedX = Math.min(x, window.innerWidth - 200);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjustedY, left: adjustedX }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
        onClick={() => {
          router.push(`/view/${encodePath(`${node.path}/INSTRUCTION.md`)}`);
          onClose();
        }}
      >
        <ScrollText size={14} className="shrink-0" />
        {t.fileTree.editRules}
      </button>
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left"
        onClick={() => { onRename(); onClose(); }}
      >
        <Pencil size={14} className="shrink-0" />
        {t.fileTree.renameSpace}
      </button>
      <div className="my-1 border-t border-border/50" />
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors text-left"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.fileTree.confirmDeleteSpace(node.name))) return;
          startTransition(async () => {
            const result = await deleteSpaceAction(node.path);
            if (result.success) {
              router.push('/');
              router.refresh();
            }
            onClose();
          });
        }}
      >
        <Trash2 size={14} className="shrink-0" />
        {isPending ? <Loader2 size={14} className="animate-spin" /> : t.fileTree.deleteSpace}
      </button>
    </div>
  );
}

// ─── NewFileInline ────────────────────────────────────────────────────────────

function NewFileInline({ dirPath, depth, onDone }: { dirPath: string; depth: number; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const router = useRouter();
  const { t } = useLocale();

  const handleSubmit = useCallback(() => {
    const name = value.trim();
    if (!name) { setError(t.fileTree.enterFileName); return; }
    startTransition(async () => {
      const result = await createFileAction(dirPath, name);
      if (result.success && result.filePath) {
        onDone();
        router.push(`/view/${encodePath(result.filePath)}`);
        router.refresh();
      } else {
        setError(result.error || t.fileTree.failed);
      }
    });
  }, [value, dirPath, onDone, router, t]);

  return (
    <div className="px-2 pb-1" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
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
          ? <Loader2 size={13} className="text-zinc-500 animate-spin shrink-0" />
          : (
            <button
              onClick={handleSubmit}
              className="text-xs text-blue-400 hover:text-blue-300 shrink-0 px-1"
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

function DirectoryNode({ node, depth, currentPath, onNavigate, maxOpenDepth }: {
  node: FileNode; depth: number; currentPath: string; onNavigate?: () => void;
  maxOpenDepth?: number | null;
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

  const toggle = useCallback(() => setOpen(v => !v), []);

  const prevMaxOpenDepth = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (maxOpenDepth === null || maxOpenDepth === undefined) {
      prevMaxOpenDepth.current = maxOpenDepth;
      return;
    }
    if (prevMaxOpenDepth.current !== maxOpenDepth) {
      setOpen(depth <= maxOpenDepth);
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
    if (isSpace) return;
    startRename(e);
  }, [startRename, isSpace]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isSpace) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [isSpace]);

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
        {isPending && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-500" />}
      </div>
    );
  }

  const showBorder = isSpace && depth === 0;

  return (
    <div>
      <div
        className="relative group/dir flex items-center"
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={toggle}
          className="shrink-0 p-1 rounded hover:bg-muted text-zinc-500 transition-colors"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <span className="block transition-transform duration-150" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
            <ChevronDown size={13} />
          </span>
        </button>
        <button
          type="button"
          onClick={handleSingleClick}
          onDoubleClick={handleDoubleClick}
          className={`
            flex-1 flex items-center gap-1.5 px-1 py-1 rounded text-left min-w-0 pr-16
            text-sm transition-colors duration-100
            hover:bg-muted
            ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}
          `}
        >
          {isSpace
            ? <Layers size={14} className="shrink-0" style={{ color: 'var(--amber)' }} />
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
              setOpen(true);
              setShowNewFile(true);
            }}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t.fileTree.newFileTitle}
          >
            <Plus size={13} />
          </button>
          {isSpace ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(`/view/${encodePath(`${node.path}/INSTRUCTION.md`)}`);
                onNavigate?.();
              }}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={t.fileTree.editRules}
            >
              <ScrollText size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRename}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={t.fileTree.rename}
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      </div>

      <div
        className={`overflow-hidden transition-all duration-200 ${showBorder ? 'border-l-2 ml-[18px]' : ''}`}
        style={{
          maxHeight: open ? '9999px' : '0px',
          ...(showBorder ? { borderColor: 'color-mix(in srgb, var(--amber) 30%, transparent)' } : {}),
        }}
      >
        {open && isSpace && node.spacePreview && (
          <SpaceHeader preview={node.spacePreview} spacePath={node.path} depth={showBorder ? 0 : depth} />
        )}
        {node.children && (
          <FileTree
            nodes={node.children}
            depth={showBorder ? 1 : depth + 1}
            onNavigate={onNavigate}
            maxOpenDepth={maxOpenDepth}
            parentIsSpace={isSpace}
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

      {contextMenu && (
        <SpaceContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={node}
          onClose={() => setContextMenu(null)}
          onRename={() => startRename()}
        />
      )}
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
  const renameRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();

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
      } else {
        setRenaming(false);
      }
    });
  }, [renameValue, node.name, node.path, router]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t.fileTree.confirmDelete(node.name))) return;
    startTransition(async () => {
      await deleteFileAction(node.path);
      if (currentPath === node.path) router.push('/');
      router.refresh();
    });
  }, [node.name, node.path, currentPath, router, t]);

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
        {isPending && <Loader2 size={12} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-zinc-500" />}
      </div>
    );
  }

  return (
    <div className="relative group/file">
      <button
        onClick={handleClick}
        onDoubleClick={startRename}
        data-filepath={node.path}
        className={`
          w-full flex items-center gap-1.5 px-2 py-1 rounded text-left
          text-sm transition-colors duration-100 cursor-pointer pr-16
          ${isActive
            ? 'bg-accent text-foreground'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
          }
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {getIcon(node)}
        <span className="truncate leading-5" suppressHydrationWarning>{node.name}</span>
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/file:flex items-center gap-0.5">
        <button onClick={startRename} className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={t.fileTree.rename}>
          <Pencil size={12} />
        </button>
        <button onClick={handleDelete} className="p-0.5 rounded text-muted-foreground hover:text-error hover:bg-muted transition-colors" title={t.fileTree.delete}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── FileTree (root) ──────────────────────────────────────────────────────────

export default function FileTree({ nodes, depth = 0, onNavigate, maxOpenDepth, parentIsSpace }: FileTreeProps) {
  const pathname = usePathname();
  const currentPath = getCurrentFilePath(pathname);

  const isInsideDir = depth > 0;
  const visibleNodes = isInsideDir ? filterVisibleNodes(nodes, !!parentIsSpace) : nodes;

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
          <DirectoryNode key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} />
        ) : (
          <FileNodeItem key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} />
        )
      )}
    </div>
  );
}
