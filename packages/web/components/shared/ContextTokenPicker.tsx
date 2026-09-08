'use client';

import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ContextPickerKind = 'spaces' | 'assistants' | string;

export interface ContextSelectableItem {
  id: string;
  label: string;
  icon: string;
  description?: string;
}

export interface ContextSelectedChip {
  id: string;
  label: string;
  icon: string;
  title: string;
  removeLabel: string;
  onRemove: () => void;
}

export interface ContextPickerAction {
  label: string;
  title?: string;
  onSelect: () => void;
}

export function contextPathLabel(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || path;
}

export function contextChipLabel(value: { label?: string; path?: string; name?: string; id?: string }): string {
  return value.label?.trim() || value.name?.trim() || value.path?.trim() || value.id?.trim() || '';
}

export function contextItemIcon(label: string, fallback = '?'): string {
  return Array.from(label.trim() || fallback)[0] ?? fallback;
}

export function addUniqueContextItem<T extends { id: string }>(items: T[], item: T): T[] {
  if (items.some((existing) => existing.id === item.id)) return items;
  return [...items, item];
}

export function ContextSelectionRow({
  kind,
  icon,
  label,
  addTitle,
  emptyLabel = 'None',
  searchLabel,
  noMatchesLabel,
  query,
  candidates,
  selectedIds,
  open,
  chips,
  footerAction,
  inlinePicker = false,
  pickerFeedback,
  onQueryChange,
  onOpenChange,
  onSelect,
}: {
  kind: ContextPickerKind;
  icon: ReactNode;
  label: string;
  addTitle: string;
  emptyLabel?: string;
  searchLabel: string;
  noMatchesLabel: string;
  query: string;
  candidates: ContextSelectableItem[];
  selectedIds: Set<string>;
  open: boolean;
  chips: ContextSelectedChip[];
  footerAction?: ContextPickerAction;
  inlinePicker?: boolean;
  pickerFeedback?: ReactNode;
  onQueryChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (candidate: ContextSelectableItem) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCandidates = candidates.filter((candidate) => {
    if (!normalizedQuery) return true;
    return `${candidate.label} ${candidate.id} ${candidate.description ?? ''}`.toLowerCase().includes(normalizedQuery);
  });

  useEffect(() => {
    if (!open) return undefined;

    const closeFromPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rowRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onOpenChange(false);
      addRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeFromPointer, true);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer, true);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rowRef} className={cn('grid items-center gap-2 py-1', inlinePicker ? 'grid-cols-[5rem_minmax(0,1fr)_2.75rem]' : 'grid-cols-[5.5rem_minmax(0,1fr)_2rem]')}
      onKeyDownCapture={event => {
        if (!open || event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation();
        onOpenChange(false); addRef.current?.focus();
      }}>
      <div className={cn('flex items-center gap-1.5 font-medium text-muted-foreground', inlinePicker ? 'min-h-11 text-xs' : 'min-h-7 text-[11px]')}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="relative min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {chips.length === 0 ? (
            <span className="min-w-0 truncate font-sans text-xs text-muted-foreground">{emptyLabel}</span>
          ) : chips.map((chip) => (
            <span
              key={chip.id}
              title={chip.title}
              className={cn('group inline-flex max-w-full items-center gap-1 rounded-md bg-muted/45 px-1.5 text-xs text-foreground transition-colors hover:bg-muted/65', inlinePicker ? 'min-h-11' : 'h-6 max-w-[180px]')}
            >
              <ContextTokenIcon value={chip.icon} label={chip.label} />
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                className={cn('shrink-0 rounded text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100', inlinePicker ? 'flex h-11 w-11 items-center justify-center' : 'opacity-0')}
                aria-label={chip.removeLabel}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        {open && !inlinePicker ? (
          <ContextPickerPopover
            kind={kind}
            searchLabel={searchLabel}
            noMatchesLabel={noMatchesLabel}
            query={query}
            candidates={filteredCandidates}
            selectedIds={selectedIds}
            onQueryChange={onQueryChange}
            onSelect={onSelect}
            footerAction={footerAction}
          />
        ) : null}
      </div>
      <button
        ref={addRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn('inline-flex shrink-0 items-center justify-center justify-self-end rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', inlinePicker ? 'h-11 w-11' : 'h-7 w-7')}
        title={addTitle}
        aria-label={addTitle}
        aria-expanded={open}
      >
        <Plus size={13} />
      </button>
      {open && inlinePicker && <div className="col-span-3 min-w-0">
        <ContextPickerPopover kind={kind} searchLabel={searchLabel} noMatchesLabel={noMatchesLabel} query={query} candidates={filteredCandidates} selectedIds={selectedIds} onQueryChange={onQueryChange} onSelect={candidate => { onSelect(candidate); addRef.current?.focus(); }} footerAction={footerAction} inline feedback={pickerFeedback} />
      </div>}
    </div>
  );
}

function ContextPickerPopover({
  kind,
  searchLabel,
  noMatchesLabel,
  query,
  candidates,
  selectedIds,
  footerAction,
  inline = false,
  feedback,
  onQueryChange,
  onSelect,
}: {
  kind: ContextPickerKind;
  searchLabel: string;
  noMatchesLabel: string;
  query: string;
  candidates: ContextSelectableItem[];
  selectedIds: Set<string>;
  footerAction?: ContextPickerAction;
  inline?: boolean;
  feedback?: ReactNode;
  onQueryChange: (value: string) => void;
  onSelect: (candidate: ContextSelectableItem) => void;
}) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-popover p-1.5', inline ? 'w-full' : 'absolute left-0 top-full z-50 mt-1 w-[min(360px,calc(100vw-2rem))] shadow-lg')}
      data-context-token-picker={kind}
      data-session-context-picker={kind}
    >
      <label className={cn('flex items-center gap-1.5 rounded-md border border-border bg-background px-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring', inline ? 'h-11' : 'h-8')}>
        <Search size={13} />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="mt-1 max-h-44 overflow-auto">
        {feedback ?? (candidates.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">{noMatchesLabel}</div>
        ) : candidates.map((candidate) => {
          const selected = selectedIds.has(candidate.id);
          return (
            <button
              key={candidate.id}
              type="button"
              disabled={selected}
              onClick={() => onSelect(candidate)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                inline && 'min-h-11',
                selected ? 'cursor-default text-muted-foreground' : 'text-foreground hover:bg-muted/55',
              )}
            >
              <ContextTokenIcon value={candidate.icon} label={candidate.label} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{candidate.label}</span>
                {candidate.description ? (
                  <span className="block truncate text-[11px] text-muted-foreground">{candidate.description}</span>
                ) : null}
              </span>
              {selected ? <Check size={13} /> : null}
            </button>
          );
        }))}
      </div>
      {footerAction ? (
        <button
          type="button"
          onClick={footerAction.onSelect}
          title={footerAction.title}
          className="mt-1 flex h-8 w-full items-center gap-2 rounded-md border border-border/45 bg-background/65 px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--amber)]/45 hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus size={13} className="text-[var(--amber)]" aria-hidden="true" />
          <span className="truncate">{footerAction.label}</span>
        </button>
      ) : null}
    </div>
  );
}

function ContextTokenIcon({ value, label }: { value: string; label?: string }) {
  const icon = contextItemIcon(value);
  if (label?.trim() === icon) return null;

  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/45 bg-background/65 text-[9px] font-semibold leading-none text-muted-foreground">
      {icon}
    </span>
  );
}
