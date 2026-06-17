'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type StableRowTrailingSlotProps = {
  status?: ReactNode;
  actions?: ReactNode;
  forceActionsVisible?: boolean;
  hideStatus?: boolean;
  reserveClassName?: string;
  className?: string;
  statusClassName?: string;
  actionsClassName?: string;
  'data-testid'?: string;
};

/**
 * Fixed-width trailing chrome for dense rows.
 *
 * Rows may swap from state indicators to hover actions, but the title/content
 * column must never gain or lose width during hover, focus, selection, or menu
 * open states. Keep this slot mounted and change opacity only.
 */
export function StableRowTrailingSlot({
  status,
  actions,
  forceActionsVisible = false,
  hideStatus = false,
  reserveClassName = 'w-8',
  className,
  statusClassName,
  actionsClassName,
  'data-testid': dataTestId,
}: StableRowTrailingSlotProps) {
  const hasStatus = Boolean(status);

  return (
    <span
      data-stable-row-trailing
      data-testid={dataTestId}
      className={cn('relative block h-7 shrink-0', reserveClassName, className)}
    >
      <span
        data-stable-row-status
        aria-hidden={!hasStatus || hideStatus || forceActionsVisible ? 'true' : undefined}
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-end transition-opacity duration-100',
          hasStatus && !hideStatus && !forceActionsVisible
            ? 'opacity-100 group-hover:opacity-0 group-focus-within:opacity-0'
            : 'opacity-0',
          statusClassName,
        )}
      >
        {status}
      </span>
      <span
        data-stable-row-actions
        className={cn(
          'absolute inset-0 flex items-center justify-end gap-0.5 transition-opacity duration-100',
          forceActionsVisible
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          actionsClassName,
        )}
      >
        {actions}
      </span>
    </span>
  );
}

type StableRowActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'neutral' | 'amber' | 'danger';
  active?: boolean;
  size?: 'sm' | 'md';
};

export function StableRowActionButton({
  tone = 'neutral',
  active = false,
  size = 'md',
  className,
  type = 'button',
  ...props
}: StableRowActionButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'hit-target-box inline-flex shrink-0 items-center justify-center transition-colors duration-75 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-manipulation [--hit-target-radius:var(--radius-md)]',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        tone === 'amber'
          ? active
            ? 'text-[var(--amber)] [--hit-target-hover-bg:var(--muted)] hover:text-muted-foreground'
            : 'text-muted-foreground/50 [--hit-target-hover-bg:var(--amber-subtle)] hover:text-[var(--amber)]'
          : tone === 'danger'
            ? 'text-muted-foreground/45 [--hit-target-hover-bg:var(--muted)] hover:text-destructive'
            : 'text-muted-foreground/45 [--hit-target-hover-bg:var(--muted)] hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}
