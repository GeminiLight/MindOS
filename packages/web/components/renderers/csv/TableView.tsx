'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { TableConfig } from './types';
import { serializeCSV } from './types';
import { EditableCell, AddRowTr } from './EditableCell';
import { cn } from '@/lib/utils';

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

  let rowCounter = 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted">
              {visibleIndices.map(ci => (
                <th key={ci} className="border-b border-border px-4 py-2.5 text-left text-[0.72rem] font-semibold uppercase tracking-[0.05em] text-muted-foreground whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {headers[ci]}
                    {cfg.sortField === headers[ci] && (
                      cfg.sortDir === 'asc'
                        ? <ChevronUp size={10} className="text-[var(--amber)]" />
                        : <ChevronDown size={10} className="text-[var(--amber)]" />
                    )}
                  </div>
                </th>
              ))}
              <th className="w-8 border-b border-border bg-muted" />
            </tr>
          </thead>
          <tbody>
            {sections.map((section, si) => (
              <React.Fragment key={section.key ?? `section-${si}`}>
                {section.key !== null && (
                  <tr key={`grp-${section.key}`}>
                    <td colSpan={visibleIndices.length + 1} className="border-y border-border bg-accent px-4 py-1.5">
                      <span className="font-mono text-xs font-semibold text-muted-foreground">
                        {section.key} · {section.rows.length}
                      </span>
                    </td>
                  </tr>
                )}
                {section.rows.map(({ row, orig }) => {
                  const ri = rowCounter++;
                  return (
                    <tr key={ri} className={cn('group transition-colors hover:bg-muted', ri % 2 === 0 ? 'bg-background' : 'bg-card')}>
                      {visibleIndices.map(ci => (
                        <td key={ci} className="max-w-xs border-b border-border px-4 py-2">
                          <EditableCell value={row[ci] ?? ''} onCommit={v => commitCell(orig, ci, v)} />
                        </td>
                      ))}
                      <td className="border-b border-border px-2 py-2">
                        <button onClick={() => deleteRow(orig)}
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-error group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {localRows.length} rows · {headers.length} cols
        </span>
        {!showAdd
          ? <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 rounded-md bg-[var(--amber-dim)] px-2.5 py-1 text-xs text-[var(--amber-text)] transition-colors hover:bg-[var(--amber-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Plus size={12} /> Add row</button>
          : <button onClick={() => setShowAdd(false)} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Cancel</button>
        }
      </div>
    </div>
  );
}
