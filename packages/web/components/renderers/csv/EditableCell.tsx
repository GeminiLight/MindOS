'use client';

import { useState, useEffect, useRef } from 'react';

export function EditableCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  function commit() { setEditing(false); if (draft !== value) onCommit(draft); else setDraft(value); }
  if (editing) return (
    <input ref={ref} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
      className="min-w-[60px] w-full border-b border-[var(--amber)] bg-transparent text-sm text-foreground outline-none" onClick={e => e.stopPropagation()}
    />
  );
  return (
    <div className="min-w-[60px] truncate text-sm text-foreground cursor-text"
      onClick={() => setEditing(true)} title={value}
    >{value || <span className="text-muted-foreground/30">—</span>}</div>
  );
}

export function AddRowTr({ headers, visibleIndices, onAdd, onCancel }: { headers: string[]; visibleIndices: number[]; onAdd: (r: string[]) => void; onCancel: () => void }) {
  const [vals, setVals] = useState(() => Array(headers.length).fill(''));
  function set(i: number, v: string) { setVals(prev => { const n = [...prev]; n[i] = v; return n; }); }
  return (
    <tr className="border-t border-[var(--amber)] bg-[var(--amber-subtle)]">
      {visibleIndices.map((ci, pos) => (
        <td key={ci} className="border-b border-border px-3 py-2">
          <input autoFocus={pos === 0} value={vals[ci]} onChange={e => set(ci, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAdd(vals); if (e.key === 'Escape') onCancel(); }}
            placeholder={headers[ci]} className="w-full border-b border-border bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/30"
          />
        </td>
      ))}
      <td className="border-b border-border px-2 py-2" />
    </tr>
  );
}
