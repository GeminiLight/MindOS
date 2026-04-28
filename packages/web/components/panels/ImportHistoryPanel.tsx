'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown, FilePlus, FileEdit, ExternalLink, Trash2, FileInput,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';
import PanelHeader from './PanelHeader';
import {
  loadHistory, clearHistory,
  type OrganizeHistoryEntry,
} from '@/lib/organize-history';

interface ImportHistoryPanelProps {
  active: boolean;
  maximized?: boolean;
  onMaximize?: () => void;
  /** Incremented externally to trigger a refresh */
  refreshToken?: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function groupByDate(entries: OrganizeHistoryEntry[]): Map<string, OrganizeHistoryEntry[]> {
  const groups = new Map<string, OrganizeHistoryEntry[]>();
  const today = new Date();
  const todayStr = today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  for (const entry of entries) {
    const d = new Date(entry.timestamp).toDateString();
    let label: string;
    if (d === todayStr) label = 'Today';
    else if (d === yesterdayStr) label = 'Yesterday';
    else label = new Date(entry.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    const list = groups.get(label) ?? [];
    list.push(entry);
    groups.set(label, list);
  }
  return groups;
}

export default function ImportHistoryPanel({ active, maximized, onMaximize, refreshToken }: ImportHistoryPanelProps) {
  const { t } = useLocale();
  const router = useRouter();
  const [entries, setEntries] = useState<OrganizeHistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const hi = (t as unknown as Record<string, Record<string, unknown>>).importHistory ?? {};

  const refresh = useCallback(() => {
    setEntries(loadHistory());
  }, []);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh, refreshToken]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('mindos:organize-history-update', handler);
    return () => window.removeEventListener('mindos:organize-history-update', handler);
  }, [refresh]);

  const handleClearAll = useCallback(() => {
    clearHistory();
    setEntries([]);
  }, []);

  const handleViewFile = useCallback((path: string) => {
    router.push(`/view/${encodePath(path)}`);
  }, [router]);

  const groups = groupByDate(entries);

  return (
    <div className={`flex flex-col h-full ${active ? '' : 'hidden'}`}>
      <PanelHeader
        title={hi.title as string ?? 'Import History'}
        maximized={maximized}
        onMaximize={onMaximize}
      >
        {entries.length > 0 && (
          <button
            onClick={handleClearAll}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={hi.clearAll as string ?? 'Clear history'}
          >
            <Trash2 size={13} />
          </button>
        )}
      </PanelHeader>

      <div className="flex-1 overflow-y-auto min-h-0 px-2 py-2">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <FileInput size={28} className="text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              {hi.emptyTitle as string ?? 'No import history yet'}
            </p>
            <p className="text-2xs text-muted-foreground/60 max-w-[200px]">
              {hi.emptyDesc as string ?? 'AI organize results will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(groups.entries()).map(([label, items]) => (
              <div key={label}>
                <p className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider px-2 mb-1.5">{label}</p>
                <div className="space-y-1">
                  {items.map(entry => {
                    const isExpanded = expandedId === entry.id;
                    const createdCount = entry.files.filter(f => f.action === 'create' && f.ok && !f.undone).length;
                    const updatedCount = entry.files.filter(f => f.action === 'update' && f.ok && !f.undone).length;
                    const undoneCount = entry.files.filter(f => f.undone).length;
                    const sourceLabel = entry.sourceFiles.length === 1
                      ? entry.sourceFiles[0]
                      : `${entry.sourceFiles.length} files`;

                    return (
                      <div key={entry.id} className="rounded-lg border border-border/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                        >
                          <FileInput size={14} className="text-[var(--amber)] shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground truncate">{sourceLabel}</p>
                            <p className="text-2xs text-muted-foreground/60">
                              {formatTime(entry.timestamp)}
                              {createdCount > 0 && ` · ${createdCount} created`}
                              {updatedCount > 0 && ` · ${updatedCount} updated`}
                              {undoneCount > 0 && ` · ${undoneCount} undone`}
                            </p>
                          </div>
                          <ChevronDown
                            size={12}
                            className={`text-muted-foreground/40 shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {isExpanded && (
                          <div className="border-t border-border/30 px-2 py-1.5 space-y-0.5">
                            {entry.files.map((f, idx) => {
                              const fileName = f.path.split('/').pop() ?? f.path;
                              return (
                                <div
                                  key={`${f.path}-${idx}`}
                                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${f.undone ? 'opacity-40' : ''}`}
                                >
                                  {f.action === 'create' ? (
                                    <FilePlus size={12} className="text-success shrink-0" />
                                  ) : (
                                    <FileEdit size={12} className="text-[var(--amber)] shrink-0" />
                                  )}
                                  <span className={`truncate flex-1 ${f.undone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                                    {fileName}
                                  </span>
                                  {f.undone && (
                                    <span className="text-2xs text-muted-foreground shrink-0">undone</span>
                                  )}
                                  {f.ok && !f.undone && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleViewFile(f.path); }}
                                      className="text-muted-foreground/40 hover:text-[var(--amber)] transition-colors shrink-0"
                                      title="View file"
                                    >
                                      <ExternalLink size={11} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
