'use client';

import { useCallback, useEffect, useRef, useState, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type DropdownPos = {
  top: number;
  left: number;
  maxHeight: number;
  direction: 'up' | 'down';
};

export interface AskOptionCapsuleOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface AskOptionCapsuleProps<T extends string> {
  title: string;
  ariaLabel?: string;
  icon: ReactNode;
  label: string;
  tooltip?: string;
  value?: T;
  options?: ReadonlyArray<AskOptionCapsuleOption<T>>;
  onChange?: (value: T) => void;
  children?: (helpers: { close: () => void }) => ReactNode;
  disabled?: boolean;
  active?: boolean;
  dropdownWidthClassName?: string;
  triggerClassName?: string;
}

export default function AskOptionCapsule<T extends string>({
  title,
  ariaLabel,
  icon,
  label,
  tooltip,
  value,
  options,
  onChange,
  children,
  disabled = false,
  active = false,
  dropdownWidthClassName = 'min-w-[220px] max-w-[280px]',
  triggerClassName,
}: AskOptionCapsuleProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const direction: DropdownPos['direction'] = spaceAbove > spaceBelow ? 'up' : 'down';
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - (dropdownRef.current?.getBoundingClientRect().width || 320) - 8)),
      maxHeight: Math.max(0, (direction === 'up' ? spaceAbove : spaceBelow) - 14),
      top: direction === 'up' ? rect.top - 6 : rect.bottom + 6,
      direction,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  useLayoutEffect(() => {
    if (!open || !pos) return;
    reposition();
    const menu = dropdownRef.current;
    const selected = menu?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)');
    (selected ?? menu?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'))?.focus();
    // Position becoming available marks the first portal mount, not subsequent scrolling.
  }, [open, Boolean(pos), reposition]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const selectedActive = active || open;

  const dropdown = open && !disabled && pos ? (
    <div
      ref={dropdownRef}
      role={options ? 'listbox' : 'dialog'}
      aria-label={ariaLabel ?? title}
      onKeyDown={event => {
        if (!options || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      }}
      className={cn(
        'fixed z-50 overflow-y-auto overscroll-contain pointer-events-auto rounded-lg border border-border bg-card py-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100',
        dropdownWidthClassName,
      )}
      style={{
        left: pos.left,
        maxWidth: 'calc(100vw - 16px)',
        minWidth: 'min(220px, calc(100vw - 16px))',
        maxHeight: pos.maxHeight,
        ...(pos.direction === 'up'
          ? { bottom: window.innerHeight - pos.top }
          : { top: pos.top }),
      }}
    >
      <div className="border-b border-border/40 px-3 py-2">
        <div className="text-xs font-semibold text-foreground">{title}</div>
      </div>
      {children ? (
        children({ close })
      ) : (
        <div className="py-1">
          {(options ?? []).map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onClick={() => {
                  if (disabled || option.disabled) return;
                  onChange?.(option.value);
                  close();
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  option.disabled
                    ? 'cursor-not-allowed opacity-45'
                    : 'hover:bg-muted',
                )}
              >
                {option.icon && (
                  <span className={cn('mt-0.5 shrink-0', selected ? 'text-[var(--amber)]' : 'text-muted-foreground')}>
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                {selected && <Check size={12} className="mt-0.5 shrink-0 text-[var(--amber)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        data-hit-active={selectedActive ? 'true' : undefined}
        title={tooltip}
        aria-label={ariaLabel}
        aria-expanded={open && !disabled}
        aria-haspopup={options ? 'listbox' : 'dialog'}
        className={cn(
          'hit-target-box relative z-10 inline-flex min-h-6 items-center gap-1 px-2.5 py-0.5',
          'max-w-[260px] select-none border border-transparent text-2xs font-medium transition-colors',
          'pointer-events-auto touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40',
          '[--hit-target-border-width:1px] [--hit-target-radius:9999px]',
          selectedActive
            ? 'text-foreground [--hit-target-active-bg:color-mix(in_srgb,var(--amber)_10%,transparent)] [--hit-target-active-border:color-mix(in_srgb,var(--amber)_25%,transparent)] [--hit-target-hover-bg:color-mix(in_srgb,var(--amber)_15%,transparent)] [--hit-target-hover-border:color-mix(in_srgb,var(--amber)_35%,transparent)]'
            : 'text-muted-foreground hover:text-foreground [--hit-target-bg:color-mix(in_srgb,var(--muted)_50%,transparent)] [--hit-target-border:color-mix(in_srgb,var(--border)_50%,transparent)] [--hit-target-hover-bg:var(--muted)] [--hit-target-hover-border:color-mix(in_srgb,var(--border)_65%,transparent)]',
          triggerClassName,
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate max-w-[110px]">{label}</span>
        <ChevronDown size={10} className="shrink-0 text-muted-foreground" />
      </button>
      {typeof document !== 'undefined' && dropdown && createPortal(dropdown, document.body)}
    </>
  );
}
