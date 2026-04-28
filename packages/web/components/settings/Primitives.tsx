'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { ChevronDown, Check, Eye, EyeOff } from 'lucide-react';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{children}</p>;
}

export function Field({ label, hint, hintError, children }: { label: React.ReactNode; hint?: string; hintError?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-foreground font-medium">{label}</label>
      {children}
      {hint && <p className={`text-xs ${hintError ? 'text-destructive' : 'text-muted-foreground'}`}>{hint}</p>}
    </div>
  );
}

export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    />
  );
}

/**
 * Password/secret input with inline eye toggle.
 * Eye only shows when input has content. Icon sits inside the border.
 */
export function PasswordInput({ value, onChange, placeholder, disabled, className = '', size = 'md' }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [show, setShow] = useState(false);
  const sm = size === 'sm';
  return (
    <div className={`flex items-center border border-border rounded-lg bg-background focus-within:ring-1 focus-within:ring-ring overflow-hidden ${className}`}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '••••••••'}
        disabled={disabled}
        className={`flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50 ${
          sm ? 'px-2.5 py-1.5 text-xs font-mono' : 'px-3 py-2 text-sm'
        }`}
      />
      {!!value && (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setShow(v => !v)}
          disabled={disabled}
          className={`shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 ${
            sm ? 'p-1.5' : 'p-2'
          }`}
          title={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOff size={sm ? 14 : 16} /> : <Eye size={sm ? 14 : 16} />}
        </button>
      )}
    </div>
  );
}

interface SelectOption { value: string; label: string }

export function Select({ value, onChange, children, className = '', disabled, size = 'md' }: {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo<SelectOption[]>(() =>
    React.Children.toArray(children)
      .filter((c): c is React.ReactElement => React.isValidElement(c) && (c as React.ReactElement).type === 'option')
      .map(c => ({
        value: String((c as React.ReactElement<{ value?: string; children?: React.ReactNode }>).props.value ?? ''),
        label: String((c as React.ReactElement<{ value?: string; children?: React.ReactNode }>).props.children ?? (c as React.ReactElement<{ value?: string }>).props.value ?? ''),
      })),
    [children],
  );

  const selectedIdx = options.findIndex(o => o.value === value);
  const selectedLabel = options[selectedIdx]?.label ?? '';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open && listRef.current && focusIdx >= 0) {
      const el = listRef.current.children[focusIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, focusIdx]);

  const select = useCallback((idx: number) => {
    if (idx >= 0 && idx < options.length) {
      onChange?.({ target: { value: options[idx].value } });
      setOpen(false);
    }
  }, [options, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
        setFocusIdx(selectedIdx >= 0 ? selectedIdx : 0);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setFocusIdx(i => Math.min(i + 1, options.length - 1)); break;
      case 'ArrowUp':   e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0)); break;
      case 'Enter': case ' ': e.preventDefault(); select(focusIdx); break;
      case 'Escape': e.preventDefault(); setOpen(false); break;
      case 'Tab': setOpen(false); break;
    }
  }, [open, options.length, selectedIdx, focusIdx, select]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setFocusIdx(selectedIdx >= 0 ? selectedIdx : 0); }}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${size === 'sm' ? 'px-1.5 py-0.5 text-xs rounded cursor-pointer' : 'w-full px-3 py-2 text-sm rounded-lg'} bg-background border border-border text-foreground text-left flex items-center justify-between gap-2 outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate ${selectedLabel ? '' : 'text-muted-foreground'}`}>{selectedLabel || '—'}</span>
        <ChevronDown size={size === 'sm' ? 10 : 14} className={`shrink-0 text-muted-foreground transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={focusIdx >= 0 ? `${uid}-opt-${focusIdx}` : undefined}
          className={`absolute z-20 ${size === 'sm' ? 'min-w-[8rem]' : 'w-full'} mt-1 py-1 border border-border rounded-lg bg-card shadow-lg max-h-60 overflow-auto animate-in fade-in-0 zoom-in-95 duration-100`}
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isFocused = idx === focusIdx;
            return (
              <button
                key={opt.value}
                id={`${uid}-opt-${idx}`}
                role="option"
                aria-selected={isSelected}
                type="button"
                onMouseDown={e => { e.preventDefault(); select(idx); }}
                onMouseEnter={() => setFocusIdx(idx)}
                className={`w-full ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} text-left flex items-center gap-2 transition-colors ${
                  isFocused ? 'bg-accent text-accent-foreground' : 'text-foreground'
                }`}
              >
                <Check size={size === 'sm' ? 10 : 14} className={`shrink-0 ${isSelected ? 'text-[var(--amber)]' : 'invisible'}`} />
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function EnvBadge({ overridden }: { overridden: boolean }) {
  if (!overridden) return null;
  return (
    <span className="text-2xs px-1.5 py-0.5 rounded bg-[var(--amber-subtle)] text-[var(--amber-text)] font-mono ml-1.5">env</span>
  );
}

/**
 * 🟢 MINOR #6: Toggle component with aria accessibility
 * @param {boolean} checked - Toggle state
 * @param {function} onChange - Called when toggle state changes (if no onClick provided)
 * @param {string} size - 'sm' (h-4 w-7) or 'md' (h-5 w-9)
 * @param {boolean} disabled - Disable toggle
 * @param {string} title - Tooltip text
 * @param {function} onClick - Custom click handler (takes priority over onChange). Call onChange directly if needed.
 *
 * Usage:
 * - Basic: `<Toggle checked={x} onChange={setX} />`
 * - With custom handler: `<Toggle checked={x} onClick={(e) => { e.stopPropagation(); await save(); }} />`
 * - In lists: Use `onClick` to prevent event bubbling; manually call `onChange` for state sync
 */
export function Toggle({ checked, onChange, size = 'md', disabled, title, onClick }: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onClick ?? (() => onChange?.(!checked))}
      className={`relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
        sm ? 'h-4 w-7' : 'h-5 w-9'
      } ${checked ? 'bg-[var(--amber)]' : 'bg-muted'}`}
    >
      <span
        className={`pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform ${
          sm ? 'h-3 w-3' : 'h-4 w-4'
        } ${checked ? (sm ? 'translate-x-3' : 'translate-x-4') : 'translate-x-0'}`}
      />
    </button>
  );
}

/**
 * 💡 SUGGESTION #10: Unified primary button primitive for amber actions
 * Replaces inline `style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}` pattern
 */
export function PrimaryButton({ children, disabled, onClick, type = 'button', className = '', ...props }: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 text-sm font-medium rounded-lg bg-[var(--amber)] text-[var(--amber-foreground)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * SettingCard — groups related settings into a visually distinct card.
 * Provides the "breathing room" and grouping that raw Field stacks lack.
 *
 * Usage:
 *   <SettingCard icon={<Sparkles size={15} />} title="AI Provider" description="Choose your model">
 *     <Field label="Model"> ... </Field>
 *   </SettingCard>
 */
export function SettingCard({ icon, title, description, badge, children, className = '' }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border/50 bg-card/50 p-5 ${className}`}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {badge}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-4 pl-11">
        {children}
      </div>
    </div>
  );
}

/**
 * SettingRow — inline label + control on one line.
 * Replaces verbose Field + vertical stacking for simple toggle/select rows.
 */
export function SettingRow({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
