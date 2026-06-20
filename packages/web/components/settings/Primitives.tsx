'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { ChevronDown, Check, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{children}</p>;
}

export function Field({ label, hint, hintError, htmlFor, children }: { label: React.ReactNode; hint?: string; hintError?: boolean; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm text-foreground font-medium">{label}</label>
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

export function Toggle({ checked, onChange, size = 'md', disabled, title, ariaLabel, onClick }: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
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

export function PrimaryButton({ children, disabled, onClick, type = 'button', className = '', ...props }: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant="amber"
      size="lg"
      className={cn('disabled:cursor-not-allowed disabled:opacity-40', className)}
      {...props}
    >
      {children}
    </Button>
  );
}

type SettingIconTone = 'accent' | 'muted' | 'danger';

const SETTING_SURFACE_CLASS =
  'rounded-xl border border-border/60 bg-card/65 p-5 shadow-[0_1px_2px_0_color-mix(in_srgb,var(--foreground)_5%,transparent)]';

function settingIconToneClass(tone: SettingIconTone) {
  if (tone === 'muted') return 'border-border/60 bg-muted/55 text-muted-foreground';
  if (tone === 'danger') return 'border-destructive/25 bg-destructive/10 text-destructive';
  return 'border-[var(--amber)]/20 bg-[var(--amber-subtle)] text-[var(--amber)]';
}

export function SettingIconShell({ children, tone = 'accent', className = '' }: {
  children: React.ReactNode;
  tone?: SettingIconTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--background)_52%,transparent)] [&_svg]:h-[15px] [&_svg]:w-[15px] ${settingIconToneClass(tone)} ${className}`}
    >
      {children}
    </span>
  );
}

export function SettingCardHeader({ icon, title, description, badge, actions, iconTone = 'accent', className = '' }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  iconTone?: SettingIconTone;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 sm:grid-cols-[2rem_minmax(0,1fr)_auto] ${className}`}>
      <SettingIconShell tone={iconTone} className="col-start-1 row-span-2">
        {icon}
      </SettingIconShell>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 text-sm font-semibold leading-5 text-foreground">{title}</h3>
          {badge}
        </div>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="col-start-2 row-start-2 flex shrink-0 items-center gap-2 sm:col-start-3 sm:row-start-1 sm:row-span-2 sm:self-start">
          {actions}
        </div>
      )}
    </div>
  );
}

export function SettingCardBody({ children, inset = true, className = '' }: {
  children: React.ReactNode;
  inset?: boolean;
  className?: string;
}) {
  const hasExplicitGap = /\bspace-y-/.test(className);
  return (
    <div className={`${inset ? 'pl-11' : ''} ${hasExplicitGap ? '' : 'space-y-4'} ${className}`}>
      {children}
    </div>
  );
}

/**
 * SettingCard — the shared settings content surface.
 *
 * It standardizes the top-left icon shell, title/description layout, optional
 * right-side actions, and the content indentation used by the AI settings page.
 */
export function SettingCard({ icon, title, description, badge, actions, children, className = '', bodyClassName = '', iconTone = 'accent', insetBody = true }: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  iconTone?: SettingIconTone;
  insetBody?: boolean;
}) {
  return (
    <div className={`${SETTING_SURFACE_CLASS} ${className}`}>
      <SettingCardHeader
        icon={icon}
        title={title}
        description={description}
        badge={badge}
        actions={actions}
        iconTone={iconTone}
      />
      <SettingCardBody inset={insetBody} className={`mt-4 ${bodyClassName}`}>
        {children}
      </SettingCardBody>
    </div>
  );
}

export function SettingSurface({ children, className = '' }: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${SETTING_SURFACE_CLASS} ${className}`}>
      {children}
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
