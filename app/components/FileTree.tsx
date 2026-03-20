'use client';

import { useState, useCallback, useRef, useTransition, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { FileNode } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { ChevronDown, FileText, Table, Folder, FolderOpen, Plus, Loader2, Trash2, Pencil } from 'lucide-react';
import { createFileAction, deleteFileAction, renameFileAction } from '@/lib/actions';
import { useLocale } from '@/lib/LocaleContext';

interface FileTreeProps {
  nodes: FileNode[];
  depth?: number;
  onNavigate?: () => void;
  /** When set, directories with depth <= this value open, others close. null = no override (manual control). */
  maxOpenDepth?: number | null;
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

function DirectoryNode({ node, depth, currentPath, onNavigate, maxOpenDepth }: {
  node: FileNode; depth: number; currentPath: string; onNavigate?: () => void;
  maxOpenDepth?: number | null;
}) {
  const router = useRouter();
  const isActive = currentPath.startsWith(node.path + '/') || currentPath === node.path;
  const [open, setOpen] = useState(depth === 0 ? true : isActive);
  const [showNewFile, setShowNewFile] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isPending, startTransition] = useTransition();
  const renameRef = useRef<HTMLInputElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLocale();

  const toggle = useCallback(() => setOpen(v => !v), []);

  // React to maxOpenDepth changes from parent
  const prevMaxOpenDepth = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (maxOpenDepth === null || maxOpenDepth === undefined) {
      prevMaxOpenDepth.current = maxOpenDepth;
      return;
    }
    // Only react when value actually changes
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
    startRename(e);
  }, [startRename]);

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
    <div>
      <div className="relative group/dir flex items-center">
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
          {open
            ? <FolderOpen size={14} className="text-yellow-400 shrink-0" />
            : <Folder size={14} className="text-yellow-400 shrink-0" />
          }
          <span className="truncate leading-5" suppressHydrationWarning>{node.name}</span>
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
          <button
            type="button"
            onClick={startRename}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t.fileTree.rename}
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>

      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? '9999px' : '0px' }}
      >
        {node.children && (
          <FileTree nodes={node.children} depth={depth + 1} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} />
        )}
        {showNewFile && (
          <NewFileInline
            dirPath={node.path}
            depth={depth}
            onDone={() => setShowNewFile(false)}
          />
        )}
      </div>
    </div>
  );
}

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

export default function FileTree({ nodes, depth = 0, onNavigate, maxOpenDepth }: FileTreeProps) {
  const pathname = usePathname();
  const currentPath = getCurrentFilePath(pathname);

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
      {nodes.map((node) =>
        node.type === 'directory' ? (
          <DirectoryNode key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} maxOpenDepth={maxOpenDepth} />
        ) : (
          <FileNodeItem key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} />
        )
      )}
    </div>
  );
}
