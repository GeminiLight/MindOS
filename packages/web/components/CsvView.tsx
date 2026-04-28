'use client';

import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import Papa from 'papaparse';
import { ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2, Loader2 } from 'lucide-react';

interface CsvViewProps {
  content: string;
  filePath?: string;
  appendAction?: (newRow: string[]) => Promise<{ newContent: string }>;
  saveAction?: (newContent: string) => Promise<void>;
}

type SortDir = 'asc' | 'desc' | null;

function serializeRows(headers: string[], rows: string[][]): string {
  return Papa.unparse([headers, ...rows]);
}

// ─── Inline cell editor ───────────────────────────────────────────────────────

function Cell({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (newVal: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    if (!editable) return;
    setDraft(value);
    setEditing(true);
  }

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        className="w-full bg-transparent outline-none text-sm"
        style={{
          color: 'var(--foreground)',
          borderBottom: '1px solid var(--amber)',
          minWidth: 60,
        }}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={`truncate text-sm ${editable ? 'cursor-text' : ''}`}
      style={{ color: 'var(--foreground)', minWidth: 60 }}
      onClick={editable ? startEdit : undefined}
      title={value}
    >
      {value || <span style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}>—</span>}
    </div>
  );
}

// ─── Add row form ─────────────────────────────────────────────────────────────

function AddRowForm({
  headers,
  onAdd,
  onCancel,
}: {
  headers: string[];
  onAdd: (row: string[]) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<string[]>(() => Array(headers.length).fill(''));
  const firstRef = useRef<HTMLInputElement>(null);

  function set(i: number, v: string) {
    setValues(prev => { const next = [...prev]; next[i] = v; return next; });
  }

  function submit() {
    onAdd(values);
  }

  return (
    <tr style={{ background: 'color-mix(in srgb, var(--amber) 6%, transparent)', borderTop: '1px solid var(--amber)' }}>
      {headers.map((h, i) => (
        <td key={i} className="px-3 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <input
            ref={i === 0 ? firstRef : undefined}
            autoFocus={i === 0}
            value={values[i]}
            onChange={e => set(i, e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
            placeholder={h}
            className="w-full bg-transparent outline-none text-sm placeholder:opacity-30"
            style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--border)' }}
          />
        </td>
      ))}
      {/* spacer for delete column */}
      <td className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }} />
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CsvView({ content: initialContent, appendAction, saveAction }: CsvViewProps) {
  const [content, setContent] = useState(initialContent);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => {
    const result = Papa.parse<string[]>(content, { skipEmptyLines: true });
    return result.data as string[][];
  }, [content]);

  const headers = parsed[0] || [];
  const rows = parsed.slice(1);

  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
      const na = parseFloat(va), nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) return sortDir === 'asc' ? na - nb : nb - na;
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [rows, sortCol, sortDir]);

  function toggleSort(col: number) {
    if (sortCol !== col) { setSortCol(col); setSortDir('asc'); return; }
    if (sortDir === 'asc') { setSortDir('desc'); return; }
    setSortCol(null); setSortDir(null);
  }

  // Update a single cell and persist
  const handleCellCommit = useCallback(async (rowIdx: number, colIdx: number, newVal: string) => {
    if (!saveAction) return;
    const updatedRows = rows.map((r) => {
      const sorted = sortedRows[rowIdx];
      if (r === sorted) return r.map((cell, ci) => ci === colIdx ? newVal : cell);
      return r;
    });
    const newContent = serializeRows(headers, updatedRows);
    setContent(newContent);
    setSaving(true);
    try {
      await saveAction(newContent);
    } catch (err) {
      console.error('[CsvView] Cell save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [saveAction, rows, sortedRows, headers]);

  // Delete a row and persist
  const handleDeleteRow = useCallback(async (rowIdx: number) => {
    if (!saveAction || saving) return;
    const sorted = sortedRows[rowIdx];
    const updatedRows = rows.filter(r => r !== sorted);
    const newContent = serializeRows(headers, updatedRows);
    setContent(newContent);
    setSaving(true);
    try {
      await saveAction(newContent);
    } catch (err) {
      console.error('[CsvView] Row delete failed:', err);
    } finally {
      setSaving(false);
    }
  }, [saveAction, rows, sortedRows, headers, saving]);

  // Append a new row
  const handleAddRow = useCallback(async (newRow: string[]) => {
    setSaving(true);
    try {
      if (appendAction) {
        const result = await appendAction(newRow);
        setContent(result.newContent);
      } else if (saveAction) {
        const newContent = serializeRows(headers, [...rows, newRow]);
        setContent(newContent);
        await saveAction(newContent);
      }
      setShowAdd(false);
    } catch (err) {
      console.error('[CsvView] Add row failed:', err);
    } finally {
      setSaving(false);
    }
  }, [appendAction, saveAction, headers, rows]);

  const canEdit = !!saveAction || !!appendAction;

  if (headers.length === 0) {
    return <div className="text-sm py-4" style={{ color: 'var(--muted-foreground)' }}>Empty CSV file</div>;
  }

  return (
    <div className="w-full rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: 'var(--muted)' }}>
              {headers.map((header, i) => (
                <th
                  key={i}
                  onClick={() => toggleSort(i)}
                  className="px-4 py-2.5 text-left font-semibold cursor-pointer select-none whitespace-nowrap transition-colors hover:bg-accent"
                  style={{
                    color: 'var(--foreground)',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.75rem',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{header}</span>
                    {sortCol === i
                      ? sortDir === 'asc'
                        ? <ChevronUp size={11} style={{ color: 'var(--amber)' }} />
                        : <ChevronDown size={11} style={{ color: 'var(--amber)' }} />
                      : <ChevronsUpDown size={11} style={{ color: 'var(--muted-foreground)', opacity: 0.4 }} />
                    }
                  </div>
                </th>
              ))}
              {canEdit && <th className="w-8" style={{ borderBottom: '1px solid var(--border)', background: 'var(--muted)' }} />}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className="group transition-colors"
                style={{
                  background: rowIdx % 2 === 0 ? 'var(--background)' : 'var(--card)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--muted)')}
                onMouseLeave={e => (e.currentTarget.style.background = rowIdx % 2 === 0 ? 'var(--background)' : 'var(--card)')}
              >
                {headers.map((_, colIdx) => (
                  <td
                    key={colIdx}
                    className="px-4 py-2.5 max-w-xs"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <Cell
                      value={row[colIdx] ?? ''}
                      editable={!!saveAction}
                      onCommit={(v) => handleCellCommit(rowIdx, colIdx, v)}
                    />
                  </td>
                ))}
                {canEdit && (
                  <td className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                    {saveAction && (
                      <button
                        onClick={() => handleDeleteRow(rowIdx)}
                        disabled={saving}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 disabled:opacity-30"
                        style={{ color: 'var(--muted-foreground)' }}
                        title={saving ? 'Saving...' : 'Delete row'}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}

            {/* Add row form */}
            {showAdd && (
              <AddRowForm
                headers={headers}
                onAdd={handleAddRow}
                onCancel={() => setShowAdd(false)}
              />
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{ background: 'var(--muted)', borderTop: '1px solid var(--border)' }}
      >
        <span className="text-xs font-display flex items-center gap-1.5" style={{ color: 'var(--muted-foreground)' }}>
          {rows.length} rows · {headers.length} cols
          {saving && <Loader2 size={10} className="animate-spin" style={{ color: 'var(--amber)' }} />}
        </span>

        {canEdit && !showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors font-display"
            style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}
          >
            <Plus size={12} />
            Add row
          </button>
        )}
        {showAdd && (
          <button
            onClick={() => setShowAdd(false)}
            className="text-xs px-2.5 py-1 rounded-md transition-colors font-display"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
