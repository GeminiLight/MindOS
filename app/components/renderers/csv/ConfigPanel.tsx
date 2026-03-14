'use client';

import { X } from 'lucide-react';
import type { CsvConfig, ViewType } from './types';

export function ConfigPanel({ headers, cfg, view, onClose, onChange }: {
  headers: string[];
  cfg: CsvConfig;
  view: ViewType;
  onClose: () => void;
  onChange: (cfg: CsvConfig) => void;
}) {
  const labelStyle: React.CSSProperties = { color: 'var(--muted-foreground)', fontSize: '0.72rem' };
  const selectStyle: React.CSSProperties = { background: 'var(--background)', color: 'var(--foreground)', borderColor: 'var(--border)', fontSize: '0.72rem' };

  function FieldSelect({ label, value, onChange: onCh }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="font-display" style={labelStyle}>{label}</span>
        <select value={value} onChange={e => onCh(e.target.value)}
          className="rounded px-2 py-1 outline-none border font-display" style={selectStyle}
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
                  className="px-3 py-1 text-xs transition-colors font-display"
                  style={{
                    fontSize: '0.72rem',
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
                    className="text-[11px] px-2 py-0.5 rounded transition-colors font-display"
                    style={{
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
