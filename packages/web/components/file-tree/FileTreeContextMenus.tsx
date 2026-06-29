'use client';

import { useRef, useLayoutEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { FileNode } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, Layers, ScrollText, FolderInput, Copy, Star, MessageSquarePlus, FolderOpen,
} from 'lucide-react';
import { convertToSpaceAction } from '@/lib/actions';
import { useLocale } from '@/lib/stores/locale-store';
import { usePinnedFiles } from '@/lib/hooks/usePinnedFiles';
import { checkAiAvailable, triggerSpaceAiInit } from '@/lib/space-ai-init';
import { toast } from '@/lib/toast';
import { notifyFilesChanged } from '@/lib/files-changed';
import { useSmoothRouterPush } from '@/hooks/useSmoothRouterPush';
import { requestAddAskContext } from '@/lib/ask-context-events';
import { openMindPathInFileManager } from '@/lib/open-in-file-manager';
import { FLOATING_CARD_SURFACE_CLASS, useDismissableFloatingLayer } from '@/components/shared/FloatingSurface';

async function copyPathToClipboard(path: string) {
  try { await navigator.clipboard.writeText(path); } catch { /* noop */ }
}

async function openPathInFileManager(path: string, onClose: () => void, errorLabel: string) {
  onClose();
  try {
    await openMindPathInFileManager(path);
  } catch {
    toast.error(errorLabel, 4000);
  }
}

// ─── Menu primitives ─────────────────────────────────────────────────────────

export const MENU_ITEM = "w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors text-left";
export const MENU_DANGER = "w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors text-left";
export const MENU_DIVIDER = "my-1 border-t border-border/50";

// ─── Context Menu Shell ──────────────────────────────────────────────────────

export type ContextMenuAlign = 'start' | 'end';

export function ContextMenuShell({ x, y, onClose, menuHeight, menuWidth = 220, align = 'start', children }: {
  x: number;
  y: number;
  onClose: () => void;
  menuHeight?: number;
  menuWidth?: number;
  align?: ContextMenuAlign;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(menuHeight ?? 160);

  useDismissableFloatingLayer({ enabled: true, refs: [menuRef], onClose });

  useLayoutEffect(() => {
    const nextHeight = menuRef.current?.offsetHeight;
    if (!nextHeight || Math.abs(nextHeight - measuredHeight) < 1) return;
    setMeasuredHeight(nextHeight);
  }, [children, measuredHeight]);

  const viewportPadding = 8;
  const effectiveHeight = Math.max(menuHeight ?? 0, measuredHeight);
  const adjustedY = Math.max(
    viewportPadding,
    Math.min(y, window.innerHeight - effectiveHeight - viewportPadding),
  );
  const anchoredX = align === 'end' ? x - menuWidth : x;
  const adjustedX = Math.max(
    viewportPadding,
    Math.min(anchoredX, window.innerWidth - menuWidth - viewportPadding),
  );

  const menu = (
    <div
      ref={menuRef}
      className={`${FLOATING_CARD_SURFACE_CLASS} py-1`}
      style={{ top: adjustedY, left: adjustedX, minWidth: menuWidth }}
    >
      {children}
    </div>
  );

  return typeof document === 'undefined' ? menu : createPortal(menu, document.body);
}

// ─── Space Context Menu ──────────────────────────────────────────────────────

export function SpaceContextMenu({ x, y, align, node, onClose, onRename, onNewFile, onImport, onDelete }: {
  x: number; y: number; align?: ContextMenuAlign; node: FileNode; onClose: () => void; onRename: () => void; onNewFile: () => void; onImport?: (space: string) => void; onDelete: () => void;
}) {
  const smoothPush = useSmoothRouterPush();
  const { t } = useLocale();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(node.path);
  const mutable = !node.isMindSystem;

  return (
    <ContextMenuShell x={x} y={y} align={align} onClose={onClose} menuHeight={340}>
      <button className={MENU_ITEM} onClick={() => { onNewFile(); onClose(); }}>
        <Plus size={14} className="shrink-0" /> {t.fileTree.newFile}
      </button>
      <button className={MENU_ITEM} onClick={() => { onClose(); smoothPush(`/view/${encodePath(`${node.path}/INSTRUCTION.md`)}`); }}>
        <ScrollText size={14} className="shrink-0" /> {t.fileTree.viewRules}
      </button>
      {onImport && (
        <button className={MENU_ITEM} onClick={() => { onImport(node.path); onClose(); }}>
          <FolderInput size={14} className="shrink-0" /> {t.fileTree.importFile}
        </button>
      )}
      <div className={MENU_DIVIDER} />
      <button className={MENU_ITEM} onClick={() => { requestAddAskContext({ path: node.path, type: 'space', label: node.name }); toast.success(t.fileTree.addedAsContext, 1600); onClose(); }}>
        <MessageSquarePlus size={14} className="shrink-0" /> {t.fileTree.addAsContext}
      </button>
      <button className={MENU_ITEM} onClick={() => { void openPathInFileManager(node.path, onClose, t.fileTree.openInFileManagerFailed); }}>
        <FolderOpen size={14} className="shrink-0" /> {t.fileTree.openInFileManager}
      </button>
      <button className={MENU_ITEM} onClick={() => { togglePin(node.path); onClose(); }}>
        <Star size={14} className={`shrink-0 ${pinned ? 'fill-[var(--amber)] text-[var(--amber)]' : ''}`} />
        {pinned ? t.fileTree.removeFromFavorites : t.fileTree.pinToFavorites}
      </button>
      <button className={MENU_ITEM} onClick={() => { copyPathToClipboard(node.path); onClose(); }}>
        <Copy size={14} className="shrink-0" /> {t.fileTree.copyPath}
      </button>
      {mutable && (
        <>
          <button className={MENU_ITEM} onClick={() => { onRename(); onClose(); }}>
            <Pencil size={14} className="shrink-0" /> {t.fileTree.renameSpace}
          </button>
          <div className={MENU_DIVIDER} />
          <button className={MENU_DANGER} onClick={() => { onClose(); onDelete(); }}>
            <Trash2 size={14} className="shrink-0" />
            {t.fileTree.deleteSpace}
          </button>
        </>
      )}
    </ContextMenuShell>
  );
}

// ─── Folder Context Menu ─────────────────────────────────────────────────────

export function FolderContextMenu({ x, y, align, node, onClose, onRename, onNewFile, onDelete }: {
  x: number; y: number; align?: ContextMenuAlign; node: FileNode; onClose: () => void; onRename: () => void; onNewFile: () => void; onDelete: () => void;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();
  const { isPinned, togglePin } = usePinnedFiles();
  const pinned = isPinned(node.path);

  return (
    <ContextMenuShell x={x} y={y} align={align} onClose={onClose} menuHeight={300}>
      <button className={MENU_ITEM} onClick={() => { onNewFile(); onClose(); }}>
        <Plus size={14} className="shrink-0" /> {t.fileTree.newFile}
      </button>
      <div className={MENU_DIVIDER} />
      <button className={MENU_ITEM} onClick={() => { requestAddAskContext({ path: node.path, type: 'folder', label: node.name }); toast.success(t.fileTree.addedAsContext, 1600); onClose(); }}>
        <MessageSquarePlus size={14} className="shrink-0" /> {t.fileTree.addAsContext}
      </button>
      <button className={MENU_ITEM} onClick={() => { void openPathInFileManager(node.path, onClose, t.fileTree.openInFileManagerFailed); }}>
        <FolderOpen size={14} className="shrink-0" /> {t.fileTree.openInFileManager}
      </button>
      <button className={MENU_ITEM} onClick={() => { togglePin(node.path); onClose(); }}>
        <Star size={14} className={`shrink-0 ${pinned ? 'fill-[var(--amber)] text-[var(--amber)]' : ''}`} />
        {pinned ? t.fileTree.removeFromFavorites : t.fileTree.pinToFavorites}
      </button>
      <button className={MENU_ITEM} disabled={isPending} onClick={() => {
        startTransition(async () => {
          const aiReady = await checkAiAvailable();
          if (!aiReady) {
            toast.error(t.fileTree.convertToSpaceAiRequired, 5000);
            onClose();
            return;
          }

          const result = await convertToSpaceAction(node.path);
          if (result.success) {
            router.refresh();
            notifyFilesChanged([node.path]);
            const spaceName = node.name.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, '') || node.name;
            triggerSpaceAiInit(spaceName, node.path);
          } else {
            toast.error(result.error ?? t.fileTree.failed, 4000);
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
