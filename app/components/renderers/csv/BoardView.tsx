'use client';

import { useState, useMemo, useEffect } from 'react';
import { Plus } from 'lucide-react';
import type { BoardConfig } from './types';
import { serializeCSV, tagColor } from './types';

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
    const tc = tagColor(group);
    const isOver = dragOver === group;
    return (
      <div className="flex-shrink-0 w-64 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tc.text }} />
          <span className="text-xs font-semibold uppercase tracking-wider truncate font-display" style={{ color: tc.text }}>{group}</span>
          <span className="text-xs ml-auto shrink-0" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}>{cards.length}</span>
        </div>
        <div
          className="flex flex-col gap-2 rounded-xl p-1.5 min-h-[80px] transition-colors"
          style={{ background: isOver ? 'var(--amber-dim)' : 'var(--muted)', border: `1px solid ${isOver ? 'var(--amber)' : 'transparent'}` }}
          onDragOver={e => { e.preventDefault(); setDragOver(group); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
          onDrop={e => {
            setDragOver(null);
            const idx = parseInt(e.dataTransfer.getData('origIdx'));
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
                className="rounded-lg border p-3 flex flex-col gap-1.5 cursor-grab active:cursor-grabbing hover:bg-muted/50 transition-colors"
                style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
              >
                <p className="text-sm font-medium leading-snug" style={{ color: 'var(--foreground)' }}>{title}</p>
                {desc && <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>{desc}</p>}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {headers.map((h, ci) => {
                    if (ci === groupIdx || ci === titleIdx || ci === descIdx) return null;
                    const v = row[ci]; if (!v) return null;
                    return <span key={ci} className="text-2xs px-1.5 py-0.5 rounded font-display"
                      style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
                    >{h}: {v}</span>;
                  })}
                </div>
              </div>
            );
          })}
          {cards.length === 0 && (
            <div className="flex items-center justify-center h-12">
              <span className="text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}>Drop here</span>
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
          <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
            <input autoFocus value={newColInput} onChange={e => setNewColInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newColInput.trim()) {
                  setNewColInput('');
                  setShowNewCol(false);
                }
                if (e.key === 'Escape') { setNewColInput(''); setShowNewCol(false); }
              }}
              placeholder="Column name…"
              className="text-xs bg-transparent outline-none w-full font-display"
              style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--amber)' }}
            />
            <div className="flex gap-2">
              <button onClick={() => {
                setNewColInput('');
                setShowNewCol(false);
              }}
                className="text-xs px-2 py-1 rounded font-display"
                style={{ background: 'var(--amber)', color: 'var(--amber-foreground)' }}
              >Create</button>
              <button onClick={() => { setNewColInput(''); setShowNewCol(false); }}
                className="text-xs px-2 py-1 rounded font-display"
                style={{ color: 'var(--muted-foreground)' }}
              >Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNewCol(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-dashed w-full transition-colors hover:bg-muted font-display"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            <Plus size={12} /> Add column
          </button>
        )}
      </div>
    </div>
  );
}
