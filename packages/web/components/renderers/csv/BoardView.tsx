'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus } from 'lucide-react';
import type { BoardConfig } from './types';
import { serializeCSV, tagTone } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function BoardView({ headers, rows, cfg, saveAction }: {
  headers: string[];
  rows: string[][];
  cfg: BoardConfig;
  saveAction: (c: string) => Promise<void>;
}) {
  const [localRows, setLocalRows] = useState(rows);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [newColInput, setNewColInput] = useState('');
  const [showNewCol, setShowNewCol] = useState(false);
  useEffect(() => { setLocalRows(rows); }, [rows]);

  const groupIdx = headers.indexOf(cfg.groupField);
  const titleIdx = headers.indexOf(cfg.titleField);
  const descIdx = headers.indexOf(cfg.descField);

  const { groups, groupKeys } = useMemo(() => {
    const map = new Map<string, { row: string[]; origIdx: number }[]>();
    localRows.forEach((row, i) => {
      const key = (groupIdx >= 0 ? row[groupIdx] : '') || '(empty)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ row, origIdx: i });
    });
    return { groups: map, groupKeys: [...map.keys()] };
  }, [localRows, groupIdx]);

  async function moveCard(origIdx: number, newGroup: string) {
    const updated = localRows.map((r, i) => {
      if (i !== origIdx) return r;
      const next = [...r];
      if (groupIdx >= 0) next[groupIdx] = newGroup;
      return next;
    });
    setLocalRows(updated);
    await saveAction(serializeCSV(headers, updated));
  }

  function Column({ group }: { group: string }) {
    const cards = groups.get(group) ?? [];
    const tone = tagTone(group);
    const isOver = dragOver === group;
    return (
      <div className="flex-shrink-0 w-64 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', tone.dot)} />
          <span className={cn('truncate font-mono text-xs font-semibold uppercase tracking-wider', tone.text)}>{group}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground/50">{cards.length}</span>
        </div>
        <div
          className={cn(
            'flex min-h-[80px] flex-col gap-2 rounded-lg border p-1.5 transition-colors',
            isOver ? 'border-[var(--amber)] bg-[var(--amber-dim)]' : 'border-transparent bg-muted',
          )}
          onDragOver={e => { e.preventDefault(); setDragOver(group); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
          onDrop={e => {
            setDragOver(null);
            const idx = parseInt(e.dataTransfer.getData('origIdx'), 10);
            if (!isNaN(idx)) moveCard(idx, group);
          }}
        >
          {cards.map(({ row, origIdx }) => {
            const title = titleIdx >= 0 ? row[titleIdx] : row[0] ?? '';
            const desc = descIdx >= 0 ? row[descIdx] : '';
            return (
              <div key={origIdx} draggable
                onDragStart={e => { e.dataTransfer.setData('origIdx', String(origIdx)); setDragOver(null); }}
                onDragEnd={() => setDragOver(null)}
                className="flex cursor-grab flex-col gap-1.5 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50 active:cursor-grabbing"
              >
                <p className="text-sm font-medium leading-snug text-foreground">{title}</p>
                {desc && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {headers.map((h, ci) => {
                    if (ci === groupIdx || ci === titleIdx || ci === descIdx) return null;
                    const v = row[ci]; if (!v) return null;
                    return <span key={ci} className="rounded bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{h}: {v}</span>;
                  })}
                </div>
              </div>
            );
          })}
          {cards.length === 0 && (
            <div className="flex items-center justify-center h-12">
              <span className="text-xs text-muted-foreground/40">Drop here</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3 items-start">
      {groupKeys.map(group => <Column key={group} group={group} />)}

      {/* New column */}
      <div className="flex-shrink-0 w-64">
        {showNewCol ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <input autoFocus value={newColInput} onChange={e => setNewColInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newColInput.trim()) {
                  setNewColInput('');
                  setShowNewCol(false);
                }
                if (e.key === 'Escape') { setNewColInput(''); setShowNewCol(false); }
              }}
              placeholder="Column name…"
              className="w-full border-b border-[var(--amber)] bg-transparent font-mono text-xs text-foreground outline-none"
            />
            <div className="flex gap-2">
              <Button variant="amber" size="xs" onClick={() => {
                setNewColInput('');
                setShowNewCol(false);
              }}>Create</Button>
              <button onClick={() => { setNewColInput(''); setShowNewCol(false); }}
                className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNewCol(true)}
            className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size={12} /> Add column
          </button>
        )}
      </div>
    </div>
  );
}
