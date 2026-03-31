'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Table, Paperclip, ImageIcon, Zap, Bot } from 'lucide-react';

interface FileChipProps {
  path: string;
  onRemove: () => void;
  variant?: 'kb' | 'upload' | 'image' | 'skill' | 'agent';
  /** Base64 image data for hover preview (variant='image' only) */
  imageData?: string;
  /** MIME type for image preview */
  imageMime?: string;
}

const VARIANT_ICON = {
  kb: { icon: FileText, cls: 'text-muted-foreground' },
  upload: { icon: Paperclip, cls: 'text-muted-foreground' },
  image: { icon: ImageIcon, cls: 'text-muted-foreground' },
  skill: { icon: Zap, cls: 'text-[var(--amber)]' },
  agent: { icon: Bot, cls: 'text-muted-foreground' },
} as const;

const VARIANT_STYLE = {
  kb: 'border-border bg-muted text-foreground',
  upload: 'border-border bg-muted text-foreground',
  image: 'border-border bg-muted text-foreground',
  skill: 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-foreground',
  agent: 'border-[var(--amber)]/25 bg-[var(--amber)]/10 text-foreground',
} as const;

export default function FileChip({ path, onRemove, variant = 'kb', imageData, imageMime }: FileChipProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [mounted, setMounted] = useState(false);
  const chipRef = useRef<HTMLSpanElement>(null);
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => setMounted(true), []);

  const name = path.split('/').pop() ?? path;
  const isCsv = variant === 'kb' && name.endsWith('.csv');
  const { icon: Icon, cls: iconClass } = isCsv
    ? { icon: Table, cls: 'text-success' }
    : VARIANT_ICON[variant];
  const style = VARIANT_STYLE[variant];

  // Position preview above the chip using getBoundingClientRect
  useEffect(() => {
    if (!showPreview || !chipRef.current) { setPreviewPos(null); return; }
    const rect = chipRef.current.getBoundingClientRect();
    setPreviewPos({
      top: rect.top - 8, // 8px gap above chip
      left: rect.left,
    });
  }, [showPreview]);

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

  return (
    <>
      <span
        ref={chipRef}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border max-w-[220px] ${style}`}
        onMouseEnter={() => imageData && setShowPreview(true)}
        onMouseLeave={() => setShowPreview(false)}
      >
        <Icon size={11} className={`${iconClass} shrink-0`} />
        <span className="truncate" title={path}>{name}</span>
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
    </>
  );
}
