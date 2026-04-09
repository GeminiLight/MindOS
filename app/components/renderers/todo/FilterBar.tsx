'use client';

import { Filter, X } from 'lucide-react';
import type { Priority, FilterState } from '@/lib/parsing/parse-todos';
import { PRIORITY_STYLES } from '@/lib/parsing/parse-todos';

export default function FilterBar({ filters, onFilterChange, allTags, allPriorities, counts }: {
  filters: FilterState;
  onFilterChange: (f: FilterState) => void;
  allTags: string[];
  allPriorities: Priority[];
  counts: { todo: number; inProgress: number; done: number; total: number };
}) {
  const hasFilters = filters.priority !== 'all' || filters.tag !== 'all' || filters.status !== 'all';

  if (allTags.length === 0 && allPriorities.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Filter size={12} className="text-muted-foreground shrink-0" />

      {/* Status filter */}
      <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
        <button
          onClick={() => onFilterChange({ ...filters, status: 'all' })}
          className={`px-2.5 py-1 transition-colors ${filters.status === 'all' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
        >
          All {counts.total}
        </button>
        <button
          onClick={() => onFilterChange({ ...filters, status: 'todo' })}
          className={`px-2.5 py-1 transition-colors border-l border-border ${filters.status === 'todo' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
        >
          Todo {counts.todo}
        </button>
        <button
          onClick={() => onFilterChange({ ...filters, status: 'in-progress' })}
          className={`px-2.5 py-1 transition-colors border-l border-border ${filters.status === 'in-progress' ? 'bg-amber-500/10 text-amber-500 font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
        >
          In Progress {counts.inProgress}
        </button>
        <button
          onClick={() => onFilterChange({ ...filters, status: 'done' })}
          className={`px-2.5 py-1 transition-colors border-l border-border ${filters.status === 'done' ? 'bg-emerald-500/10 text-emerald-500 font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
        >
          Done {counts.done}
        </button>
      </div>

      {/* Priority filter */}
      {allPriorities.length > 0 && (
        <div className="flex items-center gap-1">
          {allPriorities.map(p => {
            if (!p) return null;
            const s = PRIORITY_STYLES[p];
            const active = filters.priority === p;
            return (
              <button
                key={p}
                onClick={() => onFilterChange({ ...filters, priority: active ? 'all' : p })}
                className={`px-2 py-0.5 rounded text-xs font-mono font-medium border transition-colors ${
                  active
                    ? `${s.bg} ${s.text} ${s.border}`
                    : 'border-transparent text-muted-foreground hover:bg-muted'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1">
          {allTags.map(tag => {
            const active = filters.tag === tag;
            return (
              <button
                key={tag}
                onClick={() => onFilterChange({ ...filters, tag: active ? 'all' : tag })}
                className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
                  active
                    ? 'bg-[var(--amber)]/15 text-[var(--amber)]'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}

      {hasFilters && (
        <button
          onClick={() => onFilterChange({ priority: 'all', tag: 'all', status: 'all' })}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={10} /> Clear
        </button>
      )}
    </div>
  );
}
