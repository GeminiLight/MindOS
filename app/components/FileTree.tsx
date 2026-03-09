'use client';

import { useState, useCallback, useRef, useTransition, useEffect } from 'react';
import Link from 'next/link';
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
}

function getIcon(node: FileNode) {
  if (node.type === 'directory') return null;
  if (node.extension === '.csv') return <Table size={14} className="text-emerald-400 shrink-0" />;
  return <FileText size={14} className="text-zinc-400 shrink-0" />;
}

function getCurrentFilePath(pathname: string): string {
  const prefix = '/view/';
  if (!pathname.startsWith(prefix)) return '';
  const encoded = pathname.slice(prefix.length);
  return encoded.split('/').map(decodeURIComponent).join('/');
}

function NewFileInline({ dirPath, onDone }: { dirPath: string; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
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
    <div className="px-2 pb-1" style={{ paddingLeft: '20px' }}>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
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
            focus:outline-none focus:border-blue-500/60
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
      {error && <p className="text-xs text-red-400 mt-0.5 px-1">{error}</p>}
    </div>
  );
}

// Wrapper to inject t into DirectoryNode and FileNodeItem via props
// We need to use the hook at top-level components, so we pass t down

function DirectoryNode({ node, depth, currentPath, onNavigate }: {
  node: FileNode; depth: number; currentPath: string; onNavigate?: () => void;
}) {
  const isActive = currentPath.startsWith(node.path + '/') || currentPath === node.path;
  const [open, setOpen] = useState(depth === 0 ? true : isActive);
  const [showNewFile, setShowNewFile] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const { t } = useLocale();

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
        <Link
          href={`/view/${encodePath(node.path)}`}
          onClick={onNavigate}
          className={`
            flex-1 flex items-center gap-1.5 px-1 py-1 rounded text-left min-w-0
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
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true); setShowNewFile(true); }}
          className="
            absolute right-1 top-1/2 -translate-y-1/2
            p-0.5 rounded
            opacity-0 group-hover/dir:opacity-100
            text-muted-foreground hover:text-foreground hover:bg-muted
            transition-all duration-100
          "
          title={t.fileTree.newFileTitle}
        >
          <Plus size={13} />
        </button>
      </div>

      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: open ? '9999px' : '0px' }}
      >
        {node.children && (
          <FileTree nodes={node.children} depth={depth + 1} onNavigate={onNavigate} />
        )}
        {showNewFile && (
          <NewFileInline
            dirPath={node.path}
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
          className="w-full bg-muted border border-blue-500/60 rounded px-2 py-0.5 text-xs text-foreground focus:outline-none"
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
        <button onClick={handleDelete} className="p-0.5 rounded text-muted-foreground hover:text-red-400 hover:bg-muted transition-colors" title={t.fileTree.delete}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export default function FileTree({ nodes, depth = 0, onNavigate }: FileTreeProps) {
  const pathname = usePathname();
  const currentPath = getCurrentFilePath(pathname);

  // Scroll active file into view in the sidebar
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
          <DirectoryNode key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} />
        ) : (
          <FileNodeItem key={node.path} node={node} depth={depth} currentPath={currentPath} onNavigate={onNavigate} />
        )
      )}
    </div>
  );
}
