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
      className="w-full bg-transparent outline-none text-sm" onClick={e => e.stopPropagation()}
      style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--amber)', minWidth: 60 }}
    />
  );
  return (
    <div className="truncate text-sm cursor-text" style={{ color: 'var(--foreground)', minWidth: 60 }}
      onClick={() => setEditing(true)} title={value}
    >{value || <span style={{ color: 'var(--muted-foreground)', opacity: 0.3 }}>—</span>}</div>
  );
}

export function AddRowTr({ headers, visibleIndices, onAdd, onCancel }: { headers: string[]; visibleIndices: number[]; onAdd: (r: string[]) => void; onCancel: () => void }) {
  const [vals, setVals] = useState(() => Array(headers.length).fill(''));
  function set(i: number, v: string) { setVals(prev => { const n = [...prev]; n[i] = v; return n; }); }
  return (
    <tr style={{ background: 'color-mix(in srgb, var(--amber) 6%, transparent)', borderTop: '1px solid var(--amber)' }}>
      {visibleIndices.map((ci, pos) => (
        <td key={ci} className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <input autoFocus={pos === 0} value={vals[ci]} onChange={e => set(ci, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onAdd(vals); if (e.key === 'Escape') onCancel(); }}
            placeholder={headers[ci]} className="w-full bg-transparent outline-none text-sm placeholder:opacity-30"
            style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--border)' }}
          />
        </td>
      ))}
      <td className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }} />
    </tr>
  );
}
