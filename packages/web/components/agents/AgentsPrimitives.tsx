'use client';

import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

/* ────────── Pill / Status / Search ────────── */

export function PillButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative px-2.5 min-h-[28px] rounded text-xs cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active
          ? 'bg-[var(--amber-dim)] text-[var(--amber-text)] font-medium shadow-[0_1px_2px_rgba(200,135,58,0.08)]'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
      }`}
    >
      {label}
    </button>
  );
}

export function StatusDot({ tone, label, count }: { tone: 'ok' | 'warn' | 'neutral'; label: string; count: number }) {
  const dotCls = tone === 'ok' ? 'bg-[var(--success)]' : tone === 'warn' ? 'bg-[var(--amber)]' : 'bg-muted-foreground/60';
  const countCls = tone === 'ok' ? 'text-foreground' : tone === 'warn' ? 'text-[var(--amber)]' : 'text-muted-foreground';
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`w-2 h-2 rounded-full ${dotCls}`} aria-hidden="true" />
      <span className="text-xs">{label}</span>
      <span className={`tabular-nums font-medium ${countCls}`}>{count}</span>
    </span>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  icon: Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <label className="relative block group/search">
      <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 group-focus-within/search:text-[var(--amber)] pointer-events-none transition-colors duration-150" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full h-9 rounded-lg border border-border bg-background pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amber)]/30 focus-visible:border-[var(--amber)]/40 transition-all duration-150"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}

/* ────────── Action / Bulk / Empty ────────── */

export function ActionButton({
  onClick,
  disabled,
  busy,
  label,
  busyLabel,
  variant = 'default',
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  label: string;
  busyLabel?: string;
  variant?: 'default' | 'primary';
}) {
  const base = 'inline-flex items-center justify-center gap-1.5 text-2xs min-h-[28px] px-2.5 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150';
  const variants = {
    default: 'border border-border hover:bg-muted',
    primary: 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className={`${base} ${variants[variant]}`}
    >
      {busy && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
      {busy ? (busyLabel ?? label) : label}
    </button>
  );
}

export function BulkMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span role="status" aria-live="polite" className="text-2xs text-muted-foreground animate-in fade-in duration-200">
      {message}
    </span>
  );
}

export function EmptyState({ message, icon, className }: { message: string; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border/40 bg-card/30 p-10 text-center ${className ?? ''}`}>
      {icon && (
        <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3 text-muted-foreground/40">
          {icon}
        </div>
      )}
      <p className="text-sm text-muted-foreground/70 leading-relaxed max-w-xs mx-auto">{message}</p>
    </div>
  );
}

/* ────────── Agent Avatar ────────── */

/** Dual-mode palette: soft pastels in light, muted tones in dark — [bg, border, text] */
const AVATAR_PALETTES: [string, string, string][] = [
  ['bg-rose-100/70 dark:bg-rose-900/30',       'border-rose-300/50 dark:border-rose-700/40',      'text-rose-600/80 dark:text-rose-400/80'],
  ['bg-violet-100/70 dark:bg-violet-900/30',   'border-violet-300/50 dark:border-violet-700/40',  'text-violet-600/80 dark:text-violet-400/80'],
  ['bg-emerald-100/70 dark:bg-emerald-900/30', 'border-emerald-300/50 dark:border-emerald-700/40','text-emerald-600/80 dark:text-emerald-400/80'],
  ['bg-sky-100/70 dark:bg-sky-900/30',         'border-sky-300/50 dark:border-sky-700/40',        'text-sky-600/80 dark:text-sky-400/80'],
  ['bg-amber-100/70 dark:bg-amber-900/30',     'border-amber-300/50 dark:border-amber-700/40',    'text-amber-700/80 dark:text-amber-400/80'],
  ['bg-teal-100/70 dark:bg-teal-900/30',       'border-teal-300/50 dark:border-teal-700/40',      'text-teal-600/80 dark:text-teal-400/80'],
  ['bg-pink-100/70 dark:bg-pink-900/30',       'border-pink-300/50 dark:border-pink-700/40',      'text-pink-600/80 dark:text-pink-400/80'],
  ['bg-indigo-100/70 dark:bg-indigo-900/30',   'border-indigo-300/50 dark:border-indigo-700/40',  'text-indigo-600/80 dark:text-indigo-400/80'],
  ['bg-lime-100/70 dark:bg-lime-900/30',       'border-lime-300/50 dark:border-lime-700/40',      'text-lime-700/80 dark:text-lime-400/80'],
  ['bg-fuchsia-100/70 dark:bg-fuchsia-900/30', 'border-fuchsia-300/50 dark:border-fuchsia-700/40','text-fuchsia-600/80 dark:text-fuchsia-400/80'],
  ['bg-cyan-100/70 dark:bg-cyan-900/30',       'border-cyan-300/50 dark:border-cyan-700/40',      'text-cyan-600/80 dark:text-cyan-400/80'],
  ['bg-orange-100/70 dark:bg-orange-900/30',   'border-orange-300/50 dark:border-orange-700/40',  'text-orange-600/80 dark:text-orange-400/80'],
];

function hashName(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const parts = name.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function AgentAvatar({
  name,
  status,
  size = 'md',
  onRemove,
  href,
}: {
  name: string;
  status?: 'connected' | 'detected' | 'notFound';
  size?: 'sm' | 'md';
  onRemove?: () => void;
  href?: string;
}) {
  const [bg, border, text] = AVATAR_PALETTES[hashName(name) % AVATAR_PALETTES.length];
  const sizeClasses = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  const dotColor = status === 'connected' ? 'bg-[var(--success)]' : status === 'detected' ? 'bg-[var(--amber)]' : 'bg-muted-foreground';

  return (
    <div className="relative group/avatar" title={name}>
      <div className={`${sizeClasses} ${bg} ${border} ${text} border rounded-full flex items-center justify-center font-semibold select-none`}>
        {initials(name)}
      </div>
      {status && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${dotColor}`} aria-hidden="true" />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 scale-75 group-hover/avatar:opacity-100 group-hover/avatar:scale-100 transition-all duration-150 cursor-pointer focus-visible:opacity-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Remove ${name}`}
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
}

export function AddAvatarButton({
  onClick,
  label,
  size = 'md',
}: {
  onClick: () => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const sizeClasses = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${sizeClasses} rounded-full border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-muted cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      <Plus size={14} />
    </button>
  );
}

/* ────────── Confirm Dialog ────────── */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = 'destructive',
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'destructive' | 'default';
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="absolute inset-0 overlay-backdrop" onClick={onCancel} aria-hidden="true" />
      <div ref={dialogRef} className="relative bg-card border border-border rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h3 id="confirm-dialog-title" className="text-sm font-medium text-foreground mb-1.5">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-3 min-h-[32px] text-sm rounded-md border border-border hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 min-h-[32px] text-sm rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150 ${
              variant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-[var(--amber)] text-[var(--amber-foreground)] hover:bg-[var(--amber)]/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────── Agent Picker Popover ────────── */

export function AgentPickerPopover({
  open,
  agents,
  emptyLabel,
  onSelect,
  onClose,
}: {
  open: boolean;
  agents: Array<{ key: string; name: string }>;
  emptyLabel: string;
  onSelect: (agentKey: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 z-30 w-56 rounded-lg border border-border bg-card shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
      {agents.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="py-1 max-h-48 overflow-y-auto">
          {agents.map((agent) => (
            <button
              key={agent.key}
              type="button"
              onClick={() => onSelect(agent.key)}
              className="w-full text-left px-3 py-2 text-xs text-foreground hover:bg-muted cursor-pointer flex items-center gap-2 transition-colors duration-100"
            >
              {(() => { const [bg, bdr, txt] = AVATAR_PALETTES[hashName(agent.name) % AVATAR_PALETTES.length]; return (
              <div className={`w-6 h-6 rounded-full border ${bg} ${bdr} ${txt} flex items-center justify-center text-[9px] font-semibold shrink-0`}>
                {initials(agent.name)}
              </div>
              ); })()}
              {agent.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
