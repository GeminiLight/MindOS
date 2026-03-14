'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { LayoutGrid, Columns, Table2, Settings2 } from 'lucide-react';
import type { RendererContext } from '@/lib/renderers/registry';
import type { ViewType, CsvConfig } from './types';
import { defaultConfig, loadConfig, saveConfig, parseCSV } from './types';
import { TableView } from './TableView';
import { GalleryView } from './GalleryView';
import { BoardView } from './BoardView';
import { ConfigPanel } from './ConfigPanel';

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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors font-display"
              style={{
                background: view === tab.id ? 'var(--card)' : 'transparent',
                color: view === tab.id ? 'var(--foreground)' : 'var(--muted-foreground)',
                boxShadow: view === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >{tab.icon}{tab.label}</button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-xs font-display" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }}>
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
