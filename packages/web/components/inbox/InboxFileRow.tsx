'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Table,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import { SourceIcon, getInboxSourceLabel } from '@/components/inbox/SourceIcon';
import type { InboxFile } from '@/components/inbox/InboxViewTypes';
import {
  EXT_STYLES,
  formatRelativeTime,
  formatSize,
  getFileBaseName,
  getFileExt,
} from '@/components/inbox/InboxViewFormat';

export function InboxFileRow({
  file,
  onDelete,
  index,
  animate,
  selected,
  multiSelect = false,
  checked = false,
  onSelect,
  onToggleChecked,
  secondaryAction,
}: {
  file: InboxFile;
  onDelete: (name: string) => void;
  index: number;
  animate: boolean;
  selected: boolean;
  multiSelect?: boolean;
  checked?: boolean;
  onSelect: () => void;
  onToggleChecked?: () => void;
  secondaryAction?: {
    label: string;
    icon: ComponentType<{ size?: number; className?: string }>;
    onClick: () => void;
  };
}) {
  const { t } = useLocale();
  const router = useRouter();
  const ext = getFileExt(file.name);
  const baseName = getFileBaseName(file.name);
  const extStyle = EXT_STYLES[ext];
  const age = formatRelativeTime(file.modifiedAt, t.home.relativeTime);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const sizeLabel = formatSize(file.size);

  const FileIcon = ext === 'csv' ? Table
    : ext === 'json' ? FileCode
      : FileText;
  const SecondaryIcon = secondaryAction?.icon;
  const iconColor = ext === 'csv' ? 'text-emerald-500/70'
    : ext === 'json' ? 'text-violet-500/70'
      : ext === 'pdf' ? 'text-error/60'
        : 'text-muted-foreground/60';
  const actionColumnWidth = secondaryAction ? 'md:w-[184px]' : 'md:w-[118px]';
  const actionColumnVisibility = selected
    ? 'pointer-events-auto opacity-100'
    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100';

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        aria-pressed={selected}
        aria-label={file.name}
        className={`group flex items-center gap-3 px-4 py-3 transition-colors duration-100 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          selected ? 'bg-[var(--amber-subtle)]/45' : 'bg-card hover:bg-accent'
        }${animate ? ' animate-[fadeSlideUp_0.22s_ease_both]' : ''}`}
        style={animate ? { animationDelay: `${index * 30}ms` } : undefined}
      >
        <span className={`h-8 w-[2px] rounded-full ${selected ? 'bg-[var(--amber)]' : 'bg-transparent'}`} />
        {multiSelect && (
          <button
            type="button"
            aria-pressed={checked}
            aria-label={t.inbox.selectItem(file.name)}
            data-inbox-row-select-control
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleChecked?.();
            }}
            className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring ${
              checked
                ? 'border-[var(--amber)] bg-[var(--amber)] text-[var(--amber-foreground)] shadow-[0_0_0_3px_var(--amber-subtle)]'
                : 'border-muted-foreground/25 bg-transparent text-transparent opacity-70 hover:border-[var(--amber)]/55 hover:bg-[var(--amber-subtle)]/55 hover:opacity-100'
            }`}
          >
            <Check size={11} strokeWidth={2.5} />
          </button>
        )}

        {file.source ? (
          <SourceIcon source={file.source} size="md" />
        ) : (
          <FileIcon size={15} className={`shrink-0 ${iconColor}`} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-foreground truncate" title={file.name}>
              {baseName}
            </span>
            {extStyle && (
              <span className={`text-2xs font-mono px-1.5 py-px rounded shrink-0 ${extStyle.bg} ${extStyle.text}`}>
                .{ext}
              </span>
            )}
            {file.isAging && (
              <span className="text-2xs px-1.5 py-px rounded shrink-0 bg-[var(--amber)]/10 text-[var(--amber)]/70" title={t.inbox.agingHint}>
                {t.inbox.agingHint}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {file.source && (
              <>
                <span className="max-w-[180px] truncate rounded-md bg-muted/45 px-1.5 py-px text-2xs text-muted-foreground" title={getInboxSourceLabel(file.source) ?? undefined}>
                  {getInboxSourceLabel(file.source)}
                </span>
                <span className="text-2xs text-muted-foreground/30">·</span>
              </>
            )}
            <span className="text-2xs text-muted-foreground/40 tabular-nums">{sizeLabel}</span>
            <span className="text-2xs text-muted-foreground/30">·</span>
            <span className="text-2xs text-muted-foreground/40 tabular-nums">{age}</span>
          </div>
        </div>

        <div
          data-inbox-row-actions
          className={`hidden shrink-0 items-center justify-end gap-1 transition-opacity duration-100 md:flex ${actionColumnWidth} ${actionColumnVisibility}`}
        >
          {secondaryAction && SecondaryIcon && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                secondaryAction.onClick();
              }}
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground/55 transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              title={secondaryAction.label}
            >
              <SecondaryIcon size={12} />
              {secondaryAction.label}
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              router.push(`/view/${encodePath(file.path)}`);
            }}
            className="inline-flex items-center justify-center rounded-md px-2 py-1 text-2xs font-medium text-muted-foreground/55 transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            title={t.inbox.openFile}
          >
            {t.inbox.openFile}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDelete(file.name);
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
            title={t.inbox.removeFile}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          file={file}
          onDelete={() => {
            setCtxMenu(null);
            onDelete(file.name);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  );
}

function FileContextMenu({
  x,
  y,
  file,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  file: InboxFile;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const adjX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 200) : x;
  const adjY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 120) : y;
  const itemCls = 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors text-left';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-card border border-border rounded-lg shadow-lg py-1"
      style={{ top: adjY, left: adjX }}
    >
      <button type="button" className={itemCls} onClick={() => { router.push(`/view/${encodePath(file.path)}`); onClose(); }}>
        <ExternalLink size={14} className="shrink-0" /> {t.inbox.openFile}
      </button>
      <button type="button" className={itemCls} onClick={() => { navigator.clipboard.writeText(file.name); toast.copy(); onClose(); }}>
        <Copy size={14} className="shrink-0" /> {t.inbox.copyName}
      </button>
      <div className="border-t border-border my-1" />
      <button type="button" className={`${itemCls} text-destructive hover:text-destructive`} onClick={onDelete}>
        <Trash2 size={14} className="shrink-0" /> {t.inbox.removeFile}
      </button>
    </div>
  );
}
