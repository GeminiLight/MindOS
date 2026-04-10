'use client';

import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, FileText, Table, Settings, RotateCcw, Moon, Sun, Bot, Compass, HelpCircle, ChevronRight } from 'lucide-react';
import { SearchResult } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import { toast } from '@/lib/toast';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

type PaletteTab = 'search' | 'actions';

interface CommandAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  execute: () => void;
}

/** Highlight matched text fragments in a snippet based on the query */
function highlightSnippet(snippet: string, query: string): React.ReactNode {
  if (!query.trim()) return snippet;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = snippet.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? <mark key={i} className="bg-[var(--amber)]/25 text-foreground rounded-sm px-0.5">{part}</mark> : part
  );
}

/** Format file path as breadcrumb for cleaner display */
function formatPath(fullPath: string): { name: string; breadcrumb: string[] } {
  const parts = fullPath.split('/').filter(Boolean);
  const name = parts[parts.length - 1];
  const breadcrumb = parts.slice(0, -1);
  return { name, breadcrumb };
}

export default function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState<PaletteTab>('search');
  const [actionIndex, setActionIndex] = useState(0);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLocale();

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent<HTMLButtonElement>, result: SearchResult) => {
    e.dataTransfer.effectAllowed = 'copy';
    // Use the same data format as MindOS knowledge base drag-drop
    e.dataTransfer.setData('text/mindos-path', result.path);
    e.dataTransfer.setData('text/mindos-type', 'file');
    const dragImg = new Image();
    e.dataTransfer.setDragImage(dragImg, 0, 0);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
  }, []);

  const actions: CommandAction[] = useMemo(() => [
    {
      id: 'settings',
      label: t.search.openSettings,
      icon: <Settings size={15} />,
      shortcut: '⌘,',
      execute: () => { router.push('/settings'); onClose(); },
    },
    {
      id: 'restart-walkthrough',
      label: t.search.restartWalkthrough,
      icon: <RotateCcw size={15} />,
      execute: () => {
        fetch('/api/setup', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walkthroughStep: 0, walkthroughDismissed: false }),
        }).then(() => {
          toast.success(t.search.walkthroughRestarted);
        }).catch(() => {
          toast.error('Failed to restart walkthrough');
        });
        onClose();
      },
    },
    {
      id: 'toggle-dark-mode',
      label: t.search.toggleDarkMode,
      icon: isDark ? <Sun size={15} /> : <Moon size={15} />,
      execute: () => {
        const html = document.documentElement;
        const nowDark = html.classList.contains('dark');
        html.classList.toggle('dark', !nowDark);
        try { localStorage.setItem('theme', nowDark ? 'light' : 'dark'); } catch { /* noop */ }
        onClose();
      },
    },
    {
      id: 'go-agents',
      label: t.search.goToAgents,
      icon: <Bot size={15} />,
      execute: () => { router.push('/agents'); onClose(); },
    },
    {
      id: 'go-discover',
      label: t.search.goToDiscover,
      icon: <Compass size={15} />,
      execute: () => { router.push('/discover'); onClose(); },
    },
    {
      id: 'go-help',
      label: t.search.goToHelp,
      icon: <HelpCircle size={15} />,
      execute: () => { router.push('/help'); onClose(); },
    },
  ], [t, router, onClose, isDark]);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTab('search');
      setActionIndex(0);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(async () => {
      try {
        const data = await apiFetch<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`);
        setResults(Array.isArray(data) ? data : []);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    doSearch(val);
  }, [doSearch]);

  const navigate = useCallback((result: SearchResult) => {
    router.push(`/view/${encodePath(result.path)}`);
    onClose();
  }, [router, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Tab') {
        // Tab switches between Search/Actions tabs
        e.preventDefault();
        setTab(prev => prev === 'search' ? 'actions' : 'search');
        setActionIndex(0);
        setSelectedIndex(0);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (tab === 'search') {
          setSelectedIndex(i => Math.min(i + 1, results.length - 1));
        } else {
          setActionIndex(i => Math.min(i + 1, actions.length - 1));
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (tab === 'search') {
          setSelectedIndex(i => Math.max(i - 1, 0));
        } else {
          setActionIndex(i => Math.max(i - 1, 0));
        }
      } else if (e.key === 'Enter') {
        if (tab === 'search') {
          if (results[selectedIndex]) navigate(results[selectedIndex]);
        } else {
          if (actions[actionIndex]) actions[actionIndex].execute();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, results, selectedIndex, navigate, tab, actions, actionIndex]);

  useLayoutEffect(() => {
    if (tab === 'search') {
      const container = resultsRef.current;
      if (!container) return;
      const selected = container.children[selectedIndex] as HTMLElement | undefined;
      selected?.scrollIntoView({ block: 'nearest' });
    } else {
      const container = actionsRef.current;
      if (!container) return;
      const selected = container.children[actionIndex] as HTMLElement | undefined;
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, actionIndex, tab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-start justify-center md:pt-[15vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full md:max-w-xl md:mx-4 bg-card border-t md:border border-border rounded-t-2xl md:rounded-xl shadow-2xl overflow-hidden max-h-[85vh] md:max-h-none flex flex-col">
        {/* Mobile drag indicator */}
        <div className="flex justify-center pt-2 pb-0 md:hidden">
          <div className="w-8 h-1 rounded-full bg-muted-foreground/20" />
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-2 pb-0">
          <button
            onClick={() => { setTab('search'); setTimeout(() => inputRef.current?.focus(), 50); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              tab === 'search'
                ? 'text-foreground border-b-2 border-[var(--amber)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.search.tabSearch}
          </button>
          <button
            onClick={() => { setTab('actions'); setActionIndex(0); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              tab === 'actions'
                ? 'text-foreground border-b-2 border-[var(--amber)]'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.search.tabActions}
          </button>
        </div>

        {/* Search tab */}
        {tab === 'search' && (
          <>
            {/* Search input - IMPROVED */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search size={16} className="text-muted-foreground shrink-0 flex-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleChange}
                placeholder={t.search.placeholder}
                className="flex-1 bg-transparent text-foreground text-base font-medium placeholder:text-muted-foreground/60 outline-none"
              />
              {loading && (
                <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin shrink-0 flex-none" />
              )}
              {!loading && query && (
                <button 
                  onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
                  className="shrink-0 flex-none p-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
              <kbd className="hidden md:inline text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5 font-mono">ESC</kbd>
            </div>

            {/* Results */}
            <div ref={resultsRef} className="max-h-[50vh] md:max-h-80 overflow-y-auto flex-1">
              {/* Empty state */}
              {results.length === 0 && !query && !loading && (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
                    <Search size={20} className="text-muted-foreground/60" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">快速查找你的笔记</h3>
                  <p className="text-xs text-muted-foreground/70">开始输入文件名或内容关键词</p>
                </div>
              )}

              {/* No results state */}
              {results.length === 0 && query && !loading && (
                <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                  <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
                    <Search size={20} className="text-muted-foreground/60" />
                  </div>
                  <h3 className="text-sm font-medium text-foreground mb-1">未找到匹配的文件</h3>
                  <p className="text-xs text-muted-foreground/70">尝试其他关键词</p>
                </div>
              )}

              {/* Loading skeleton cards */}
              {loading && results.length === 0 && (
                <div className="space-y-2 p-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="px-3 py-2.5 space-y-2 animate-pulse">
                      <div className="h-4 bg-muted rounded-md w-3/4" />
                      <div className="h-3 bg-muted rounded-md w-1/2" />
                      <div className="h-3 bg-muted rounded-md w-2/3" />
                    </div>
                  ))}
                </div>
              )}

              {/* Results list - IMPROVED */}
              {results.map((result, i) => {
                const ext = result.path.endsWith('.csv') ? '.csv' : '.md';
                const { name, breadcrumb } = formatPath(result.path);
                const isSelected = i === selectedIndex;
                const isDragging = i === draggedIndex;

                return (
                  <button
                    key={result.path}
                    draggable
                    onDragStart={(e) => handleDragStart(e, result)}
                    onDragEnd={handleDragEnd}
                    onDragEnter={() => setDraggedIndex(i)}
                    onDragLeave={() => setDraggedIndex(null)}
                    onClick={() => navigate(result)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`
                      w-full px-3 py-2.5 flex items-start gap-3 text-left transition-colors duration-100
                      ${isSelected ? 'bg-[var(--amber-dim)] border-l-2 border-[var(--amber)]' : 'border-l-2 border-transparent'}
                      ${isDragging ? 'bg-muted/70' : isSelected ? '' : 'hover:bg-muted/60'}
                      ${i < results.length - 1 ? 'border-b border-border/50' : ''}
                    `}
                  >
                    {/* File icon */}
                    <div className="shrink-0 flex-none mt-0.5">
                      {ext === '.csv'
                        ? <Table size={14} className="text-success" />
                        : <FileText size={14} className="text-muted-foreground" />
                      }
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {/* File name - elevated */}
                      <div className="text-sm font-semibold text-foreground truncate" title={name}>
                        {name}
                      </div>

                      {/* Breadcrumb path - muted */}
                      {breadcrumb.length > 0 && (
                        <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground/70 truncate">
                          {breadcrumb.map((part, idx) => (
                            <span key={idx} className="flex items-center gap-1">
                              {idx > 0 && <ChevronRight size={10} className="shrink-0 flex-none" />}
                              <span className="truncate">{part}</span>
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Content snippet - muted and small */}
                      {result.snippet && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed" title={result.snippet}>
                          {highlightSnippet(result.snippet, query)}
                        </p>
                      )}
                    </div>

                    {/* Drag hint for mobile/desktop */}
                    {isSelected && !isDragging && (
                      <div className="hidden md:flex shrink-0 flex-none text-[10px] text-muted-foreground/50 font-mono pt-0.5">
                        ⬆ Drag
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Footer — desktop only */}
            {results.length > 0 && (
              <div className="hidden md:flex px-4 py-2 border-t border-border/50 items-center gap-2 text-xs text-muted-foreground/60">
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↑↓</kbd> {t.search.navigate}</span>
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↵</kbd> {t.search.open}</span>
                <span className="text-muted-foreground/40 mx-0.5">•</span>
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">Drag</kbd> to chat</span>
                <span className="text-muted-foreground/40 mx-0.5">•</span>
                <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">ESC</kbd> {t.search.close}</span>
              </div>
            )}
          </>
        )}

        {/* Actions tab */}
        {tab === 'actions' && (
          <div ref={actionsRef} className="max-h-[50vh] md:max-h-80 overflow-y-auto flex-1 py-1">
            {actions.map((action, i) => (
              <button
                key={action.id}
                onClick={() => action.execute()}
                onMouseEnter={() => setActionIndex(i)}
                className={`
                  w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors duration-75
                  ${i === actionIndex ? 'bg-muted' : 'hover:bg-muted/50'}
                `}
              >
                <span className="text-muted-foreground shrink-0">{action.icon}</span>
                <span className="text-sm text-foreground flex-1">{action.label}</span>
                {action.shortcut && (
                  <kbd className="text-xs text-muted-foreground/60 font-mono border border-border rounded px-1.5 py-0.5">
                    {action.shortcut}
                  </kbd>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
