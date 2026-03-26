'use client';

import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

/* ────────── Pill / Status / Search ────────── */

export function PillButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 min-h-[28px] rounded text-xs cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'bg-[var(--amber-dim)] text-[var(--amber)] font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

export function StatusDot({ tone, label, count }: { tone: 'ok' | 'warn' | 'neutral'; label: string; count: number }) {
  const dotCls = tone === 'ok' ? 'bg-[var(--success)]' : tone === 'warn' ? 'bg-[var(--amber)]' : 'bg-muted-foreground';
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} aria-hidden="true" />
      {label} <span className="tabular-nums text-foreground">{count}</span>
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
    <label className="relative block">
      <Icon size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
        >
          <X size={14} />
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
    primary: 'bg-[var(--amber)] text-background hover:bg-[var(--amber)]/90',
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

export function EmptyState({ message, className }: { message: string; className?: string }) {
  return (
    <div className={`rounded-lg border border-dashed border-border bg-card/50 p-8 text-center ${className ?? ''}`}>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/* ────────── Agent Avatar ────────── */

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-rose-500',
  'bg-amber-600', 'bg-cyan-600', 'bg-indigo-500', 'bg-pink-500',
  'bg-teal-500', 'bg-orange-500', 'bg-sky-500', 'bg-fuchsia-500',
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
  const color = AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
  const sizeClasses = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  const dotColor = status === 'connected' ? 'bg-[var(--success)]' : status === 'detected' ? 'bg-[var(--amber)]' : 'bg-muted-foreground';

  return (
    <div className="relative group/avatar" title={name}>
      <div className={`${sizeClasses} ${color} rounded-full flex items-center justify-center text-white font-medium select-none shadow-sm`}>
        {initials(name)}
      </div>
      {status && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${dotColor}`} aria-hidden="true" />
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 scale-75 group-hover/avatar:opacity-100 group-hover/avatar:scale-100 transition-all duration-150 cursor-pointer focus-visible:opacity-100 focus-visible:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} aria-hidden="true" />
      <div className="relative bg-card border border-border rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h3 className="text-sm font-medium text-foreground mb-1.5">{title}</h3>
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
                : 'bg-[var(--amber)] text-background hover:bg-[var(--amber)]/90'
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
              <div className={`w-6 h-6 rounded-full ${AVATAR_COLORS[hashName(agent.name) % AVATAR_COLORS.length]} flex items-center justify-center text-white text-[9px] font-medium shrink-0`}>
                {initials(agent.name)}
              </div>
              {agent.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
