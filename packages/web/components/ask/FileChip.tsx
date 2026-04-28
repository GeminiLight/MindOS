'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Table, Paperclip, ImageIcon, Zap, Bot, Folder, Loader2, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';

interface FileChipProps {
  path: string;
  onRemove: () => void;
  variant?: 'kb' | 'upload' | 'image' | 'skill' | 'agent';
  /** Base64 image data for hover preview (variant='image' only) */
  imageData?: string;
  /** MIME type for image preview */
  imageMime?: string;
  /** Extraction status for uploaded files (e.g. PDF). */
  status?: 'loading' | 'success' | 'error';
  /** Human-readable error message shown on hover when status='error'. */
  error?: string;
  /** Present when the PDF text was truncated due to length. */
  truncatedInfo?: {
    totalChars: number;
    includedChars: number;
    totalPages: number;
  };
}

const VARIANT_ICON = {
  kb: { icon: FileText, cls: 'text-muted-foreground' },
  upload: { icon: Paperclip, cls: 'text-muted-foreground' },
  image: { icon: ImageIcon, cls: 'text-muted-foreground' },
  skill: { icon: Zap, cls: 'text-[var(--amber)]' },
  agent: { icon: Bot, cls: 'text-[var(--amber)]' },
} as const;

const VARIANT_STYLE = {
  kb: 'border-border/60 bg-muted/70 text-foreground shadow-sm',
  upload: 'border-border/60 bg-muted/70 text-foreground shadow-sm',
  image: 'border-border/60 bg-muted/70 text-foreground shadow-sm',
  skill: 'border-[var(--amber)]/35 bg-[var(--amber)]/12 text-foreground shadow-sm',
  agent: 'border-[var(--amber)]/35 bg-[var(--amber)]/12 text-foreground shadow-sm',
} as const;

export default function FileChip({ path, onRemove, variant = 'kb', imageData, imageMime, status, error, truncatedInfo }: FileChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [mounted, setMounted] = useState(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  const isDir = variant === 'kb' && path.endsWith('/');
  const cleanPath = isDir ? path.slice(0, -1) : path;
  const name = cleanPath.split('/').pop() ?? cleanPath;
  const isCsv = variant === 'kb' && !isDir && name.endsWith('.csv');

  // Determine the base icon from variant / file type
  const { icon: BaseIcon, cls: baseIconCls } = isDir
    ? { icon: Folder, cls: 'text-yellow-400' }
    : isCsv
    ? { icon: Table, cls: 'text-success' }
    : VARIANT_ICON[variant];

  // Determine status trailing indicator
  const isTruncated = !!truncatedInfo;
  let StatusIndicator: React.ComponentType<{ size: number; className?: string }> | null = null;
  let statusIndicatorCls = '';
  if (status === 'loading') {
    StatusIndicator = Loader2;
    statusIndicatorCls = 'text-muted-foreground animate-spin';
  } else if (status === 'error') {
    StatusIndicator = AlertCircle;
    statusIndicatorCls = 'text-destructive';
  } else if (isTruncated) {
    StatusIndicator = AlertTriangle;
    statusIndicatorCls = 'text-[var(--amber)]';
  } else if (status === 'success') {
    StatusIndicator = CheckCircle2;
    statusIndicatorCls = 'text-emerald-500';
  }

  const style = status === 'error'
    ? 'border-destructive/40 bg-destructive/8 text-foreground shadow-sm'
    : isTruncated
    ? 'border-[var(--amber)]/40 bg-[var(--amber)]/8 text-foreground shadow-sm'
    : VARIANT_STYLE[variant];

  // Build tooltip text
  let tooltipText: string | null = null;
  if (status === 'error' && error) {
    tooltipText = error;
  } else if (isTruncated) {
    const pct = truncatedInfo.totalChars > 0
      ? Math.round((truncatedInfo.includedChars / truncatedInfo.totalChars) * 100)
      : 0;
    tooltipText = `Document truncated — only ${pct}% included (${Math.round(truncatedInfo.includedChars / 1000)}K / ${Math.round(truncatedInfo.totalChars / 1000)}K chars, ${truncatedInfo.totalPages} pages total)`;
  }

  // Position image preview above the chip
  useEffect(() => {
    if (!showPreview || !chipRef.current) { setPreviewPos(null); return; }
    const rect = chipRef.current.getBoundingClientRect();
    setPreviewPos({ top: rect.top - 8, left: rect.left });
  }, [showPreview]);

  // Position tooltip above the chip
  useEffect(() => {
    if (!showTooltip || !chipRef.current) { setTooltipPos(null); return; }
    const rect = chipRef.current.getBoundingClientRect();
    setTooltipPos({ top: rect.top - 8, left: rect.left });
  }, [showTooltip]);

  const preview = showPreview && previewPos && imageData && imageMime ? (
    <div
      className="fixed z-50 p-1 rounded-lg border border-border bg-card shadow-lg pointer-events-none"
      style={{
        left: previewPos.left,
        bottom: window.innerHeight - previewPos.top,
      }}
    >
      <img
        src={`data:${imageMime};base64,${imageData}`}
        alt={name}
        className="max-h-48 max-w-64 rounded object-contain"
      />
    </div>
  ) : null;

  const tooltipBorderCls = status === 'error'
    ? 'border-destructive/20 text-destructive'
    : 'border-[var(--amber)]/20 text-[var(--amber-text)]';

  const tooltip = showTooltip && tooltipPos && tooltipText ? (
    <div
      className={`fixed z-50 px-2.5 py-1.5 rounded-lg border bg-card text-xs shadow-lg pointer-events-none max-w-[280px] ${tooltipBorderCls}`}
      style={{
        left: tooltipPos.left,
        bottom: window.innerHeight - tooltipPos.top,
      }}
    >
      {tooltipText}
    </div>
  ) : null;

  const handleMouseEnter = () => {
    if (imageData) setShowPreview(true);
    if (tooltipText) setShowTooltip(true);
  };
  const handleMouseLeave = () => {
    setShowPreview(false);
    setShowTooltip(false);
  };

  return (
    <>
      <span
        ref={chipRef}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border max-w-[220px] ${style}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <BaseIcon size={11} className={`${baseIconCls} shrink-0`} />
        <span className="truncate" title={isDir ? cleanPath : path}>{name}</span>
        {StatusIndicator && (
          <StatusIndicator size={10} className={`${statusIndicatorCls} shrink-0`} />
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="p-0.5 -mr-1 rounded hover:text-foreground transition-colors shrink-0 text-muted-foreground"
        >
          <X size={10} />
        </button>
      </span>
      {mounted && preview && createPortal(preview, document.body)}
      {mounted && tooltip && createPortal(tooltip, document.body)}
    </>
  );
}
