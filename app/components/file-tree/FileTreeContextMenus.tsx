'use client';

import { useRef, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FileNode } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, Layers, ScrollText, FolderInput, Copy, Star,
} from 'lucide-react';
import { convertToSpaceAction } from '@/lib/actions';
import { useLocale } from '@/lib/stores/locale-store';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import { checkAiAvailable, triggerSpaceAiInit } from '@/lib/space-ai-init';

function notifyFilesChanged() {
  window.dispatchEvent(new Event('mindos:files-changed'));
}

async function copyPathToClipboard(path: string) {
  try { await navigator.clipboard.writeText(path); } catch { /* noop */ }
}

// ─── Menu primitives ─────────────────────────────────────────────────────────

export const MENU_ITEM = "w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left";
export const MENU_DANGER = "w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors text-left";
export const MENU_DIVIDER = "my-1 border-t border-border/50";

// ─── Context Menu Shell ──────────────────────────────────────────────────────

export function ContextMenuShell({ x, y, onClose, menuHeight, children }: {
  x: number;
  y: number;
  onClose: () => void;
  menuHeight?: number;
  children: React.ReactNode;
}) {
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

  const adjustedY = Math.min(y, window.innerHeight - (menuHeight ?? 160));
  const adjustedX = Math.min(x, window.innerWidth - 200);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjustedY, left: adjustedX }}
    >
      {children}
    </div>
  );
}

// ─── Space Context Menu ──────────────────────────────────────────────────────

export function SpaceContextMenu({ x, y, node, onClose, onRename, onNewFile, onImport, onDelete }: {
  x: number; y: number; node: FileNode; onClose: () => void; onRename: () => void; onNewFile: () => void; onImport?: (space: string) => void; onDelete: () => void;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(node.path);

  return (
    <ContextMenuShell x={x} y={y} onClose={onClose}>
      <button className={MENU_ITEM} onClick={() => { onNewFile(); onClose(); }}>
        <Plus size={14} className="shrink-0" /> {t.fileTree.newFile}
      </button>
      <button className={MENU_ITEM} onClick={() => { router.push(`/view/${encodePath(`${node.path}/INSTRUCTION.md`)}`); onClose(); }}>
        <ScrollText size={14} className="shrink-0" /> {t.fileTree.viewRules}
      </button>
      {onImport && (
        <button className={MENU_ITEM} onClick={() => { onImport(node.path); onClose(); }}>
          <FolderInput size={14} className="shrink-0" /> {t.fileTree.importFile}
        </button>
      )}
      <div className={MENU_DIVIDER} />
      <button className={MENU_ITEM} onClick={() => { togglePin(node.path); onClose(); }}>
        <Star size={14} className={`shrink-0 ${pinned ? 'fill-[var(--amber)] text-[var(--amber)]' : ''}`} />
        {pinned ? t.fileTree.removeFromFavorites : t.fileTree.pinToFavorites}
      </button>
      <button className={MENU_ITEM} onClick={() => { copyPathToClipboard(node.path); onClose(); }}>
        <Copy size={14} className="shrink-0" /> {t.fileTree.copyPath}
      </button>
      <button className={MENU_ITEM} onClick={() => { onRename(); onClose(); }}>
        <Pencil size={14} className="shrink-0" /> {t.fileTree.renameSpace}
      </button>
      <div className={MENU_DIVIDER} />
      <button className={MENU_DANGER} onClick={() => { onClose(); onDelete(); }}>
        <Trash2 size={14} className="shrink-0" />
        {t.fileTree.deleteSpace}
      </button>
    </ContextMenuShell>
  );
}

// ─── Folder Context Menu ─────────────────────────────────────────────────────

export function FolderContextMenu({ x, y, node, onClose, onRename, onNewFile, onDelete }: {
  x: number; y: number; node: FileNode; onClose: () => void; onRename: () => void; onNewFile: () => void; onDelete: () => void;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(node.path);

  return (
    <ContextMenuShell x={x} y={y} onClose={onClose} menuHeight={220}>
      <button className={MENU_ITEM} onClick={() => { onNewFile(); onClose(); }}>
        <Plus size={14} className="shrink-0" /> {t.fileTree.newFile}
      </button>
      <div className={MENU_DIVIDER} />
      <button className={MENU_ITEM} onClick={() => { togglePin(node.path); onClose(); }}>
        <Star size={14} className={`shrink-0 ${pinned ? 'fill-[var(--amber)] text-[var(--amber)]' : ''}`} />
        {pinned ? t.fileTree.removeFromFavorites : t.fileTree.pinToFavorites}
      </button>
      <button className={MENU_ITEM} disabled={isPending} onClick={() => {
        startTransition(async () => {
          const result = await convertToSpaceAction(node.path);
          if (result.success) {
            router.refresh();
            notifyFilesChanged();
            const spaceName = node.name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || node.name;
            checkAiAvailable().then(ok => {
              if (ok) triggerSpaceAiInit(spaceName, node.path);
            });
          }
          onClose();
        });
      }}>
        <Layers size={14} className="shrink-0 text-[var(--amber)]" /> {t.fileTree.convertToSpace}
      </button>
      <button className={MENU_ITEM} onClick={() => { copyPathToClipboard(node.path); onClose(); }}>
        <Copy size={14} className="shrink-0" /> {t.fileTree.copyPath}
      </button>
      <button className={MENU_ITEM} onClick={() => { onRename(); onClose(); }}>
        <Pencil size={14} className="shrink-0" /> {t.fileTree.rename}
      </button>
      <div className={MENU_DIVIDER} />
      <button className={MENU_DANGER} onClick={() => { onClose(); onDelete(); }}>
        <Trash2 size={14} className="shrink-0" />
        {t.fileTree.deleteFolder}
      </button>
    </ContextMenuShell>
  );
}
