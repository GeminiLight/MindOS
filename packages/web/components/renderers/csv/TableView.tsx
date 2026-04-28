'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { TableConfig } from './types';
import { serializeCSV } from './types';
import { EditableCell, AddRowTr } from './EditableCell';

export function TableView({ headers, rows, cfg, saveAction }: {
  headers: string[];
  rows: string[][];
  cfg: TableConfig;
  saveAction: (content: string) => Promise<void>;
}) {
  const [localRows, setLocalRows] = useState(rows);
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { setLocalRows(rows); }, [rows]);

  const visibleIndices = useMemo(
    () => headers.map((_, i) => i).filter(i => !cfg.hiddenFields.includes(headers[i])),
    [headers, cfg.hiddenFields],
  );

  const sortIdx = headers.indexOf(cfg.sortField);

  const processedRows = useMemo(() => {
    let result = [...localRows];
    if (sortIdx >= 0) {
      result.sort((a, b) => {
        const va = a[sortIdx] ?? '', vb = b[sortIdx] ?? '';
        const na = parseFloat(va), nb = parseFloat(vb);
        const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb);
        return cfg.sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [localRows, sortIdx, cfg.sortDir]);

  const groupIdx = headers.indexOf(cfg.groupField);

  type Section = { key: string | null; rows: { row: string[]; orig: string[] }[] };
  const sections = useMemo((): Section[] => {
    if (groupIdx < 0) return [{ key: null, rows: processedRows.map(r => ({ row: r, orig: r })) }];
    const map = new Map<string, string[][]>();
    for (const row of processedRows) {
      const k = row[groupIdx] || '(empty)';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(row);
    }
    return [...map.entries()].map(([key, rs]) => ({ key, rows: rs.map(r => ({ row: r, orig: r })) }));
  }, [processedRows, groupIdx]);

  async function commitCell(origRow: string[], colIdx: number, val: string) {
    const updated = localRows.map(r => r === origRow ? r.map((c, ci) => ci === colIdx ? val : c) : r);
    setLocalRows(updated);
    await saveAction(serializeCSV(headers, updated));
  }

  async function deleteRow(origRow: string[]) {
    const updated = localRows.filter(r => r !== origRow);
    setLocalRows(updated);
    await saveAction(serializeCSV(headers, updated));
  }

  async function addRow(newRow: string[]) {
    const updated = [...localRows, newRow];
    setLocalRows(updated);
    setShowAdd(false);
    await saveAction(serializeCSV(headers, updated));
  }

  const thStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--border)',
    fontSize: '0.72rem',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--muted-foreground)',
    fontWeight: 600,
  };

  let rowCounter = 0;

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr style={{ background: 'var(--muted)' }}>
              {visibleIndices.map(ci => (
                <th key={ci} className="px-4 py-2.5 text-left whitespace-nowrap" style={thStyle}>
                  <div className="flex items-center gap-1">
                    {headers[ci]}
                    {cfg.sortField === headers[ci] && (
                      cfg.sortDir === 'asc'
                        ? <ChevronUp size={10} style={{ color: 'var(--amber)' }} />
                        : <ChevronDown size={10} style={{ color: 'var(--amber)' }} />
                    )}
                  </div>
                </th>
              ))}
              <th className="w-8" style={{ ...thStyle, background: 'var(--muted)' }} />
            </tr>
          </thead>
          <tbody>
            {sections.map((section, si) => (
              <React.Fragment key={section.key ?? `section-${si}`}>
                {section.key !== null && (
                  <tr key={`grp-${section.key}`}>
                    <td colSpan={visibleIndices.length + 1} className="px-4 py-1.5"
                      style={{ background: 'var(--accent)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}
                    >
                      <span className="text-xs font-semibold font-display" style={{ color: 'var(--muted-foreground)' }}>
                        {section.key} · {section.rows.length}
                      </span>
                    </td>
                  </tr>
                )}
                {section.rows.map(({ row, orig }) => {
                  const ri = rowCounter++;
                  return (
                    <tr key={ri} className="group transition-colors"
                      style={{ background: ri % 2 === 0 ? 'var(--background)' : 'var(--card)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--muted)')}
                      onMouseLeave={e => (e.currentTarget.style.background = ri % 2 === 0 ? 'var(--background)' : 'var(--card)')}
                    >
                      {visibleIndices.map(ci => (
                        <td key={ci} className="px-4 py-2 max-w-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                          <EditableCell value={row[ci] ?? ''} onCommit={v => commitCell(orig, ci, v)} />
                        </td>
                      ))}
                      <td className="px-2 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                        <button onClick={() => deleteRow(orig)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
                          style={{ color: 'var(--muted-foreground)' }}
                        ><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            ))}
            {showAdd && (
              <AddRowTr headers={headers} visibleIndices={visibleIndices} onAdd={addRow} onCancel={() => setShowAdd(false)} />
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
        <span className="text-xs font-display" style={{ color: 'var(--muted-foreground)' }}>
          {localRows.length} rows · {headers.length} cols
        </span>
        {!showAdd
          ? <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md"
              style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}
            ><Plus size={12} /> Add row</button>
          : <button onClick={() => setShowAdd(false)} className="text-xs px-2.5 py-1 rounded-md"
              style={{ color: 'var(--muted-foreground)' }}
            >Cancel</button>
        }
      </div>
    </div>
  );
}
