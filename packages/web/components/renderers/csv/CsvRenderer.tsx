'use client';

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGrid, Columns, Table2, Settings2 } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';
import type { ViewType, CsvConfig } from './types';
import { defaultConfig, parseCSV } from './types';
import { useRendererState } from '@/lib/renderers/useRendererState';
import { TableView } from './TableView';
import { GalleryView } from './GalleryView';
import { BoardView } from './BoardView';
import { ConfigPanel } from './ConfigPanel';
import { cn } from '@/lib/utils';

const VIEW_TABS: { id: ViewType; icon: React.ReactNode; label: string }[] = [
  { id: 'table',   icon: <Table2 size={13} />,    label: 'Table' },
  { id: 'gallery', icon: <LayoutGrid size={13} />, label: 'Gallery' },
  { id: 'board',   icon: <Columns size={13} />,    label: 'Board' },
];

export function CsvRenderer({ filePath, content, saveAction }: RendererContext) {
  const { headers, rows } = useMemo(() => parseCSV(content), [content]);
  const def = useMemo(() => defaultConfig(headers), [headers]);
  const [cfg, setCfg] = useRendererState<CsvConfig>('csv', filePath, def);
  const [showConfig, setShowConfig] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const resetSaveStateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetSaveStateRef.current) clearTimeout(resetSaveStateRef.current);
    };
  }, []);

  const updateConfig = useCallback((next: CsvConfig) => {
    setCfg(next);
  }, [setCfg]);

  const updateTableSort = useCallback((field: string, dir: CsvConfig['table']['sortDir']) => {
    setCfg(current => ({
      ...current,
      table: {
        ...current.table,
        sortField: field,
        sortDir: dir,
      },
    }));
  }, [setCfg]);

  const persistCsv = useCallback(async (nextContent: string) => {
    if (resetSaveStateRef.current) clearTimeout(resetSaveStateRef.current);
    setSaveState('saving');
    try {
      await saveAction(nextContent);
      setSaveState('saved');
      resetSaveStateRef.current = setTimeout(() => setSaveState('idle'), 1800);
    } catch (err) {
      setSaveState('error');
      throw err;
    }
  }, [saveAction]);

  const view = cfg.activeView;
  const saveStatusLabel = saveState === 'saving'
    ? 'Saving...'
    : saveState === 'saved'
      ? 'Saved'
      : saveState === 'error'
        ? 'Save failed'
        : null;

  return (
    <div className="w-full py-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 relative">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-1">
          {VIEW_TABS.map(tab => (
            <button key={tab.id} onClick={() => updateConfig({ ...cfg, activeView: tab.id })}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                view === tab.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-card/50 hover:text-foreground',
              )}
            >{tab.icon}{tab.label}</button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground/50">
          {rows.length} rows
        </span>
        {saveStatusLabel && (
          <span
            className={cn(
              'text-xs tabular-nums',
              saveState === 'error' ? 'text-error' : 'text-muted-foreground',
            )}
            role={saveState === 'error' ? 'alert' : 'status'}
          >
            {saveStatusLabel}
          </span>
        )}
        <div className="relative">
          <button onClick={() => setShowConfig(v => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              showConfig ? 'bg-accent text-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
            aria-label="View settings"
            title="View settings"
          ><Settings2 size={13} /></button>
          {showConfig && (
            <ConfigPanel headers={headers} cfg={cfg} view={view}
              onClose={() => setShowConfig(false)} onChange={updateConfig} />
          )}
        </div>
      </div>

      {view === 'table' && <TableView headers={headers} rows={rows} cfg={cfg.table} saveAction={persistCsv} onSortChange={updateTableSort} />}
      {view === 'gallery' && <GalleryView headers={headers} rows={rows} cfg={cfg.gallery} />}
      {view === 'board' && <BoardView headers={headers} rows={rows} cfg={cfg.board} saveAction={persistCsv} />}
    </div>
  );
}
