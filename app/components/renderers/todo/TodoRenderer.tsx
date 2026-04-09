'use client';

import { useState, useCallback, useMemo } from 'react';
import { Circle } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';
import type { SectionMeta, FilterState } from '@/lib/parsing/parse-todos';
import {
  parseMarkdownTodos,
  setStatusInLines,
  renameInLines,
  deleteInLines,
  addInLines,
  countByStatus,
  countTotal,
  collectAllTags,
  collectAllPriorities,
} from '@/lib/parsing/parse-todos';
import FilterBar from './FilterBar';
import SectionCard from './SectionCard';

export function TodoRenderer({ content, saveAction }: RendererContext) {
  const [localContent, setLocalContent] = useState(content);
  const [filters, setFilters] = useState<FilterState>({ priority: 'all', tag: 'all', status: 'all' });

  const { sections, lines, sectionOrder } = useMemo(
    () => parseMarkdownTodos(localContent),
    [localContent],
  );

  const totalDone = useMemo(
    () => Object.values(sections).reduce((n, m) => n + countByStatus(m.items, 'done'), 0),
    [sections],
  );
  const totalInProgress = useMemo(
    () => Object.values(sections).reduce((n, m) => n + countByStatus(m.items, 'in-progress'), 0),
    [sections],
  );
  const totalItems = useMemo(
    () => Object.values(sections).reduce((n, m) => n + countTotal(m.items), 0),
    [sections],
  );
  const totalTodo = totalItems - totalDone - totalInProgress;

  const allTags = useMemo(() => collectAllTags(sections), [sections]);
  const allPriorities = useMemo(() => collectAllPriorities(sections), [sections]);

  const persist = useCallback(async (next: string) => {
    setLocalContent(next);
    await saveAction(next);
  }, [saveAction]);

  const handleCycleStatus = useCallback(async (lineIndex: number, newStatus: Parameters<typeof setStatusInLines>[2]) => {
    await persist(setStatusInLines(lines, lineIndex, newStatus));
  }, [lines, persist]);

  const handleRename = useCallback(async (lineIndex: number, newText: string) => {
    await persist(renameInLines(lines, lineIndex, newText));
  }, [lines, persist]);

  const handleDelete = useCallback(async (lineIndex: number) => {
    await persist(deleteInLines(lines, lineIndex));
  }, [lines, persist]);

  const handleAdd = useCallback(async (afterLineIndex: number, text: string) => {
    await persist(addInLines(lines, afterLineIndex, text));
  }, [lines, persist]);

  const sectionEntries = sectionOrder
    .filter(name => sections[name])
    .map(name => [name, sections[name]] as [string, SectionMeta]);

  const pct = totalItems ? Math.round((totalDone / totalItems) * 100) : 0;

  return (
    <div className="max-w-[900px] mx-auto xl:mr-[220px] px-0 py-2">
      {/* Summary header */}
      <div className="mb-5 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold font-display text-foreground tabular-nums">
              {pct}%
            </span>
            <span className="text-xs text-muted-foreground font-display">
              {totalDone}/{totalItems} completed
            </span>
            {totalInProgress > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-500">
                <Circle size={8} className="fill-amber-500/30" />
                {totalInProgress} in progress
              </span>
            )}
          </div>
          <div className="mt-2 w-full max-w-xs h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: 'var(--amber)' }}
            />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onFilterChange={setFilters}
        allTags={allTags}
        allPriorities={allPriorities}
        counts={{
          todo: totalTodo,
          inProgress: totalInProgress,
          done: totalDone,
          total: totalItems,
        }}
      />

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {sectionEntries.map(([name, meta]) => (
          <SectionCard
            key={name}
            name={name}
            meta={meta}
            filters={filters}
            defaultCollapsed={name.includes('Done')}
            onCycleStatus={handleCycleStatus}
            onRename={handleRename}
            onDelete={handleDelete}
            onAdd={handleAdd}
          />
        ))}
        {sectionEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">No TODO items found in this file.</p>
        )}
      </div>
    </div>
  );
}
