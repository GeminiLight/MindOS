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
  searchLabel,
  noMatchesLabel,
  query,
  candidates,
  selectedIds,
  open,
  chips,
  footerAction,
  onQueryChange,
  onOpenChange,
  onSelect,
}: {
  kind: ContextPickerKind;
  icon: ReactNode;
  label: string;
  addTitle: string;
  searchLabel: string;
  noMatchesLabel: string;
  query: string;
  candidates: ContextSelectableItem[];
  selectedIds: Set<string>;
  open: boolean;
  chips: ContextSelectedChip[];
  footerAction?: ContextPickerAction;
  onQueryChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (candidate: ContextSelectableItem) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
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
    };

    document.addEventListener('pointerdown', closeFromPointer, true);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer, true);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rowRef} className="grid gap-1.5 sm:grid-cols-[76px_minmax(0,1fr)] sm:items-start">
      <div className="flex min-h-6 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="relative flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.id}
            title={chip.title}
            className="group inline-flex h-6 max-w-[180px] items-center gap-1 rounded-md bg-muted/45 px-1.5 text-[11px] text-foreground transition-colors hover:bg-muted/65"
          >
            <ContextTokenIcon value={chip.icon} />
            <span className="truncate">{chip.label}</span>
            <button
              type="button"
              onClick={chip.onRemove}
              className="rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              aria-label={chip.removeLabel}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border/55 text-muted-foreground transition-colors hover:border-border hover:bg-muted/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={addTitle}
          aria-label={addTitle}
          aria-expanded={open}
        >
          <Plus size={12} />
        </button>

        {open ? (
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
  onQueryChange: (value: string) => void;
  onSelect: (candidate: ContextSelectableItem) => void;
}) {
  return (
    <div
      className="absolute left-0 top-full z-50 mt-1 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border/55 bg-popover p-1.5 shadow-lg"
      data-context-token-picker={kind}
      data-session-context-picker={kind}
    >
      <label className="flex h-8 items-center gap-1.5 rounded-md border border-border/45 bg-background/70 px-2 text-muted-foreground">
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
        {candidates.length === 0 ? (
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
                selected ? 'cursor-default text-muted-foreground' : 'text-foreground hover:bg-muted/55',
              )}
            >
              <ContextTokenIcon value={candidate.icon} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{candidate.label}</span>
                {candidate.description ? (
                  <span className="block truncate text-[11px] text-muted-foreground">{candidate.description}</span>
                ) : null}
              </span>
              {selected ? <Check size={13} /> : null}
            </button>
          );
        })}
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

function ContextTokenIcon({ value }: { value: string }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border/45 bg-background/65 text-[9px] font-semibold leading-none text-muted-foreground">
      {contextItemIcon(value)}
    </span>
  );
}
