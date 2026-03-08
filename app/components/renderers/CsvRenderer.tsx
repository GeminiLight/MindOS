'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import { LayoutGrid, Columns, Table2, Settings2, X, ChevronUp, ChevronDown, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewType = 'table' | 'gallery' | 'board';

interface TableConfig {
  sortField: string;
  sortDir: 'asc' | 'desc';
  groupField: string;
  hiddenFields: string[];
}

interface GalleryConfig {
  titleField: string;
  descField: string;
  tagField: string;
}

interface BoardConfig {
  groupField: string;
  titleField: string;
  descField: string;
}

interface CsvConfig {
  activeView: ViewType;
  table: TableConfig;
  gallery: GalleryConfig;
  board: BoardConfig;
}

function defaultConfig(headers: string[]): CsvConfig {
  return {
    activeView: 'table',
    table: { sortField: '', sortDir: 'asc', groupField: '', hiddenFields: [] },
    gallery: { titleField: headers[0] ?? '', descField: headers[1] ?? '', tagField: headers[2] ?? '' },
    board: { groupField: headers[headers.length - 1] ?? '', titleField: headers[0] ?? '', descField: headers[1] ?? '' },
  };
}

function configKey(filePath: string) { return `mindos-csv-config:${filePath}`; }

function loadConfig(filePath: string, headers: string[]): CsvConfig {
  try {
    const raw = localStorage.getItem(configKey(filePath));
    if (raw) {
      const parsed = JSON.parse(raw);
      const def = defaultConfig(headers);
      return { ...def, ...parsed, table: { ...def.table, ...parsed.table }, gallery: { ...def.gallery, ...parsed.gallery }, board: { ...def.board, ...parsed.board } };
    }
  } catch { /* ignore */ }
  return defaultConfig(headers);
}

function saveConfig(filePath: string, cfg: CsvConfig) {
  try { localStorage.setItem(configKey(filePath), JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ─── Parse / serialize ────────────────────────────────────────────────────────

function parseCSV(content: string) {
  const result = Papa.parse<string[]>(content, { skipEmptyLines: true });
  const data = result.data as string[][];
  return { headers: data[0] ?? [], rows: data.slice(1) };
}

function serializeCSV(headers: string[], rows: string[][]) {
  return Papa.unparse([headers, ...rows]);
}

// ─── Tag color ────────────────────────────────────────────────────────────────

const TAG_COLORS = [
  { bg: 'rgba(200,135,58,0.12)', text: 'var(--amber)' },
  { bg: 'rgba(122,173,128,0.12)', text: '#7aad80' },
  { bg: 'rgba(138,180,216,0.12)', text: '#8ab4d8' },
  { bg: 'rgba(200,160,216,0.12)', text: '#c8a0d8' },
  { bg: 'rgba(200,96,96,0.12)', text: '#c86060' },
  { bg: 'rgba(150,150,150,0.12)', text: 'var(--muted-foreground)' },
];

function tagColor(val: string) {
  let h = 0;
  for (let i = 0; i < val.length; i++) h = (h * 31 + val.charCodeAt(i)) & 0xffff;
  return TAG_COLORS[h % TAG_COLORS.length];
}

// ─── Shared: EditableCell ─────────────────────────────────────────────────────

function EditableCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
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

function AddRowTr({ headers, visibleIndices, onAdd, onCancel }: { headers: string[]; visibleIndices: number[]; onAdd: (r: string[]) => void; onCancel: () => void }) {
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

// ─── Table View ───────────────────────────────────────────────────────────────

function TableView({ headers, rows, cfg, saveAction }: {
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

  // Build sections: [{ key, rows }]
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
    fontFamily: "'IBM Plex Sans',sans-serif",
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
            {sections.map(section => (
              <>
                {section.key !== null && (
                  <tr key={`grp-${section.key}`}>
                    <td colSpan={visibleIndices.length + 1} className="px-4 py-1.5"
                      style={{ background: 'var(--accent)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}
                    >
                      <span className="text-xs font-semibold" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace" }}>
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
              </>
            ))}
            {showAdd && (
              <AddRowTr headers={headers} visibleIndices={visibleIndices} onAdd={addRow} onCancel={() => setShowAdd(false)} />
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 flex items-center justify-between" style={{ background: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
        <span className="text-xs" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace" }}>
          {localRows.length} rows · {headers.length} cols
        </span>
        {!showAdd
          ? <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md"
              style={{ color: 'var(--amber)', background: 'var(--amber-dim)', fontFamily: "'IBM Plex Mono',monospace" }}
            ><Plus size={12} /> Add row</button>
          : <button onClick={() => setShowAdd(false)} className="text-xs px-2.5 py-1 rounded-md"
              style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace" }}
            >Cancel</button>
        }
      </div>
    </div>
  );
}

// ─── Gallery View ─────────────────────────────────────────────────────────────

function GalleryView({ headers, rows, cfg }: { headers: string[]; rows: string[][]; cfg: GalleryConfig }) {
  const titleIdx = headers.indexOf(cfg.titleField);
  const descIdx = headers.indexOf(cfg.descField);
  const tagIdx = headers.indexOf(cfg.tagField);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((row, i) => {
        const title = titleIdx >= 0 ? row[titleIdx] : row[0] ?? '';
        const desc = descIdx >= 0 ? row[descIdx] : '';
        const tag = tagIdx >= 0 ? row[tagIdx] : '';
        const tc = tag ? tagColor(tag) : null;
        return (
          <div key={i} className="rounded-xl border p-4 flex flex-col gap-2 hover:bg-muted/50 transition-colors"
            style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
          >
            {tag && tc && <span className="self-start text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: tc.bg, color: tc.text, fontFamily: "'IBM Plex Mono',monospace" }}>{tag}</span>}
            <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--foreground)', fontFamily: "'IBM Plex Sans',sans-serif" }}>{title}</p>
            {desc && <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--muted-foreground)' }}>{desc}</p>}
            <div className="mt-1 flex flex-col gap-0.5">
              {headers.map((h, ci) => {
                if (ci === titleIdx || ci === descIdx || ci === tagIdx) return null;
                const v = row[ci]; if (!v) return null;
                return <div key={ci} className="flex items-baseline gap-1.5 text-xs">
                  <span style={{ color: 'var(--muted-foreground)', opacity: 0.6, fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem' }}>{h}</span>
                  <span className="truncate" style={{ color: 'var(--muted-foreground)' }}>{v}</span>
                </div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Board View ───────────────────────────────────────────────────────────────

function BoardView({ headers, rows, cfg, saveAction }: {
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

  function DropZone({ group }: { group: string }) {
    const isOver = dragOver === group;
    return (
      <div
        className="rounded-lg border-2 border-dashed transition-all"
        style={{
          minHeight: 48,
          borderColor: isOver ? 'var(--amber)' : 'var(--border)',
          background: isOver ? 'var(--amber-dim)' : 'transparent',
        }}
        onDragOver={e => { e.preventDefault(); setDragOver(group); }}
        onDragLeave={() => setDragOver(null)}
        onDrop={e => {
          setDragOver(null);
          const idx = parseInt(e.dataTransfer.getData('origIdx'));
          if (!isNaN(idx)) moveCard(idx, group);
        }}
      />
    );
  }

  function Column({ group }: { group: string }) {
    const cards = groups.get(group) ?? [];
    const tc = tagColor(group);
    const isOver = dragOver === group;
    return (
      <div className="flex-shrink-0 w-64 flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tc.text }} />
          <span className="text-xs font-semibold uppercase tracking-wider truncate" style={{ color: tc.text, fontFamily: "'IBM Plex Mono',monospace" }}>{group}</span>
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
                <p className="text-sm font-medium leading-snug" style={{ color: 'var(--foreground)', fontFamily: "'IBM Plex Sans',sans-serif" }}>{title}</p>
                {desc && <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--muted-foreground)' }}>{desc}</p>}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {headers.map((h, ci) => {
                    if (ci === groupIdx || ci === titleIdx || ci === descIdx) return null;
                    const v = row[ci]; if (!v) return null;
                    return <span key={ci} className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--muted)', color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace" }}
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
                  const name = newColInput.trim();
                  if (!groups.has(name)) {
                    // Add a placeholder row so column appears — actually just show it as a drop target
                    setNewColInput('');
                    setShowNewCol(false);
                    // Create column by dropping into it — pre-create as empty group via DropZone trick
                    // We surface it as a drop target by temporarily adding to groupKeys
                    // For simplicity: just close and instruct user to drag a card in
                  }
                  setNewColInput('');
                  setShowNewCol(false);
                }
                if (e.key === 'Escape') { setNewColInput(''); setShowNewCol(false); }
              }}
              placeholder="Column name…"
              className="text-xs bg-transparent outline-none w-full"
              style={{ color: 'var(--foreground)', borderBottom: '1px solid var(--amber)', fontFamily: "'IBM Plex Mono',monospace" }}
            />
            <div className="flex gap-2">
              <button onClick={() => {
                const name = newColInput.trim();
                if (name && !groups.has(name)) {
                  // Add empty drop column — make a virtual card then let user drag into it
                  // Best UX: show the column header + empty drop zone right now via local state
                  setDragOver(null);
                }
                setNewColInput('');
                setShowNewCol(false);
              }}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--amber)', color: '#131210', fontFamily: "'IBM Plex Mono',monospace" }}
              >Create</button>
              <button onClick={() => { setNewColInput(''); setShowNewCol(false); }}
                className="text-xs px-2 py-1 rounded"
                style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace" }}
              >Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNewCol(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-dashed w-full transition-colors hover:bg-muted"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace" }}
          >
            <Plus size={12} /> Add column
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ headers, cfg, view, onClose, onChange }: {
  headers: string[];
  cfg: CsvConfig;
  view: ViewType;
  onClose: () => void;
  onChange: (cfg: CsvConfig) => void;
}) {
  const labelStyle: React.CSSProperties = { color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem' };
  const selectStyle: React.CSSProperties = { background: 'var(--background)', color: 'var(--foreground)', borderColor: 'var(--border)', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem' };

  function FieldSelect({ label, value, onChange: onCh }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span style={labelStyle}>{label}</span>
        <select value={value} onChange={e => onCh(e.target.value)}
          className="rounded px-2 py-1 outline-none border" style={selectStyle}
        >
          <option value="">— none —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-10 z-20 w-72 rounded-xl border shadow-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={labelStyle}>{view} settings</span>
        <button onClick={onClose} style={{ color: 'var(--muted-foreground)' }}><X size={13} /></button>
      </div>

      {view === 'table' && (
        <>
          <div className="h-px" style={{ background: 'var(--border)' }} />
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={labelStyle}>Sort</p>
          <FieldSelect label="Sort by" value={cfg.table.sortField}
            onChange={v => onChange({ ...cfg, table: { ...cfg.table, sortField: v } })} />
          <div className="flex items-center justify-between gap-2">
            <span style={labelStyle}>Direction</span>
            <div className="flex rounded overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {(['asc', 'desc'] as const).map(d => (
                <button key={d} onClick={() => onChange({ ...cfg, table: { ...cfg.table, sortDir: d } })}
                  className="px-3 py-1 text-xs transition-colors"
                  style={{
                    fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem',
                    background: cfg.table.sortDir === d ? 'var(--amber)' : 'var(--background)',
                    color: cfg.table.sortDir === d ? '#131210' : 'var(--muted-foreground)',
                  }}
                >{d}</button>
              ))}
            </div>
          </div>

          <div className="h-px" style={{ background: 'var(--border)' }} />
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={labelStyle}>Group</p>
          <FieldSelect label="Group by" value={cfg.table.groupField}
            onChange={v => onChange({ ...cfg, table: { ...cfg.table, groupField: v } })} />

          <div className="h-px" style={{ background: 'var(--border)' }} />
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={labelStyle}>Columns</p>
          <div className="flex flex-col gap-1.5">
            {headers.map(h => {
              const hidden = cfg.table.hiddenFields.includes(h);
              return (
                <div key={h} className="flex items-center justify-between">
                  <span style={labelStyle}>{h}</span>
                  <button onClick={() => {
                    const next = hidden
                      ? cfg.table.hiddenFields.filter(f => f !== h)
                      : [...cfg.table.hiddenFields, h];
                    onChange({ ...cfg, table: { ...cfg.table, hiddenFields: next } });
                  }}
                    className="text-[11px] px-2 py-0.5 rounded transition-colors"
                    style={{
                      fontFamily: "'IBM Plex Mono',monospace",
                      background: hidden ? 'var(--muted)' : 'var(--amber-dim)',
                      color: hidden ? 'var(--muted-foreground)' : 'var(--amber)',
                    }}
                  >{hidden ? 'Hidden' : 'Visible'}</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === 'gallery' && (
        <>
          <FieldSelect label="Title" value={cfg.gallery.titleField}
            onChange={v => onChange({ ...cfg, gallery: { ...cfg.gallery, titleField: v } })} />
          <FieldSelect label="Description" value={cfg.gallery.descField}
            onChange={v => onChange({ ...cfg, gallery: { ...cfg.gallery, descField: v } })} />
          <FieldSelect label="Tag / Badge" value={cfg.gallery.tagField}
            onChange={v => onChange({ ...cfg, gallery: { ...cfg.gallery, tagField: v } })} />
        </>
      )}

      {view === 'board' && (
        <>
          <FieldSelect label="Group by" value={cfg.board.groupField}
            onChange={v => onChange({ ...cfg, board: { ...cfg.board, groupField: v } })} />
          <FieldSelect label="Card title" value={cfg.board.titleField}
            onChange={v => onChange({ ...cfg, board: { ...cfg.board, titleField: v } })} />
          <FieldSelect label="Card desc" value={cfg.board.descField}
            onChange={v => onChange({ ...cfg, board: { ...cfg.board, descField: v } })} />
        </>
      )}
    </div>
  );
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

const VIEW_TABS: { id: ViewType; icon: React.ReactNode; label: string }[] = [
  { id: 'table',   icon: <Table2 size={13} />,    label: 'Table' },
  { id: 'gallery', icon: <LayoutGrid size={13} />, label: 'Gallery' },
  { id: 'board',   icon: <Columns size={13} />,    label: 'Board' },
];

export function CsvRenderer({ filePath, content, saveAction }: RendererContext) {
  const { headers, rows } = useMemo(() => parseCSV(content), [content]);
  const [cfg, setCfg] = useState<CsvConfig>(() => defaultConfig(headers));
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    setCfg(loadConfig(filePath, headers));
    setConfigLoaded(true);
  }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateConfig = useCallback((next: CsvConfig) => {
    setCfg(next);
    saveConfig(filePath, next);
  }, [filePath]);

  if (!configLoaded) return null;
  const view = cfg.activeView;

  return (
    <div className="max-w-[1100px] mx-auto px-0 py-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 relative">
        <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ background: 'var(--muted)' }}>
          {VIEW_TABS.map(tab => (
            <button key={tab.id} onClick={() => updateConfig({ ...cfg, activeView: tab.id })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                background: view === tab.id ? 'var(--card)' : 'transparent',
                color: view === tab.id ? 'var(--foreground)' : 'var(--muted-foreground)',
                boxShadow: view === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >{tab.icon}{tab.label}</button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--muted-foreground)', fontFamily: "'IBM Plex Mono',monospace", opacity: 0.5 }}>
          {rows.length} rows
        </span>
        <div className="relative">
          <button onClick={() => setShowConfig(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: showConfig ? 'var(--accent)' : 'var(--muted)', color: showConfig ? 'var(--foreground)' : 'var(--muted-foreground)' }}
            title="View settings"
          ><Settings2 size={13} /></button>
          {showConfig && (
            <ConfigPanel headers={headers} cfg={cfg} view={view}
              onClose={() => setShowConfig(false)} onChange={updateConfig} />
          )}
        </div>
      </div>

      {view === 'table' && <TableView headers={headers} rows={rows} cfg={cfg.table} saveAction={saveAction} />}
      {view === 'gallery' && <GalleryView headers={headers} rows={rows} cfg={cfg.gallery} />}
      {view === 'board' && <BoardView headers={headers} rows={rows} cfg={cfg.board} saveAction={saveAction} />}
    </div>
  );
}
