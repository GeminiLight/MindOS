'use client';

import { X } from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import type { CsvConfig, ViewType } from './types';
import { cn } from '@/lib/utils';

export function ConfigPanel({ headers, cfg, view, onClose, onChange }: {
  headers: string[];
  cfg: CsvConfig;
  view: ViewType;
  onClose: () => void;
  onChange: (cfg: CsvConfig) => void;
}) {
  function FieldSelect({ label, value, onChange: onCh }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.72rem] text-muted-foreground">{label}</span>
        <CustomSelect
          value={value}
          onChange={onCh}
          size="sm"
          options={[
            { value: '', label: '— none —' },
            ...headers.map(h => ({ value: h, label: h })),
          ]}
        />
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-10 z-20 flex w-72 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xl">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{view} settings</span>
        <button onClick={onClose} className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X size={13} /></button>
      </div>

      {view === 'table' && (
        <>
          <div className="h-px bg-border" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sort</p>
          <FieldSelect label="Sort by" value={cfg.table.sortField}
            onChange={v => onChange({ ...cfg, table: { ...cfg.table, sortField: v } })} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.72rem] text-muted-foreground">Direction</span>
            <div className="flex overflow-hidden rounded border border-border">
              {(['asc', 'desc'] as const).map(d => (
                <button key={d} onClick={() => onChange({ ...cfg, table: { ...cfg.table, sortDir: d } })}
                  className={cn(
                    'px-3 py-1 text-[0.72rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    cfg.table.sortDir === d
                      ? 'bg-[var(--amber)] text-[var(--amber-foreground)]'
                      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >{d}</button>
              ))}
            </div>
          </div>

          <div className="h-px bg-border" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Group</p>
          <FieldSelect label="Group by" value={cfg.table.groupField}
            onChange={v => onChange({ ...cfg, table: { ...cfg.table, groupField: v } })} />

          <div className="h-px bg-border" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Columns</p>
          <div className="flex flex-col gap-1.5">
            {headers.map(h => {
              const hidden = cfg.table.hiddenFields.includes(h);
              return (
                <div key={h} className="flex items-center justify-between">
                  <span className="text-[0.72rem] text-muted-foreground">{h}</span>
                  <button onClick={() => {
                    const next = hidden
                      ? cfg.table.hiddenFields.filter(f => f !== h)
                      : [...cfg.table.hiddenFields, h];
                    onChange({ ...cfg, table: { ...cfg.table, hiddenFields: next } });
                  }}
                    className={cn(
                      'rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      hidden
                        ? 'bg-muted text-muted-foreground hover:text-foreground'
                        : 'bg-[var(--amber-dim)] text-[var(--amber-text)]',
                    )}
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
