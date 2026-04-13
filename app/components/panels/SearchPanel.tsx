'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, FileText, Table, ChevronRight, Eye } from 'lucide-react';
import { SearchResult } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/stores/locale-store';
import PanelHeader from './PanelHeader';
import { Virtuoso } from 'react-virtuoso';
import { getSearchWarmHint, shouldStartSearchPrewarm, useSearchPrewarm } from '@/hooks/useSearchPrewarm';

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

interface SearchPanelProps {
  /** When true the panel is visible — triggers focus & reset */
  active: boolean;
  /** Called when user navigates to a result (panel host may want to close) */
  onNavigate?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
}

export { getSearchWarmHint, shouldStartSearchPrewarm } from '@/hooks/useSearchPrewarm';

export default function SearchPanel({ active, onNavigate, maximized, onMaximize }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLocale();

  // Focus input when panel becomes active
  useEffect(() => {
    if (active) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [active]);

  const warmState = useSearchPrewarm(active);

  // ── Preview state ──
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch preview content when selected result changes (debounced 150ms)
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);

    if (results.length === 0 || selectedIndex < 0 || selectedIndex >= results.length) {
      setPreviewContent(null);
      setPreviewPath(null);
      return;
    }

    const result = results[selectedIndex];
    if (result.path === previewPath && previewContent !== null) return;

    previewTimer.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const data = await apiFetch<{ content: string }>(`/api/file?path=${encodeURIComponent(result.path)}`);
        setPreviewContent(typeof data.content === 'string' ? data.content.slice(0, 2000) : null);
        setPreviewPath(result.path);
      } catch {
        setPreviewContent(null);
        setPreviewPath(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 150);

    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, selectedIndex]);

  // Clear preview when query changes
  useEffect(() => {
    setPreviewContent(null);
    setPreviewPath(null);
  }, [query]);

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
    onNavigate?.();
  }, [router, onNavigate]);

  // Keyboard navigation within the panel
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[selectedIndex]) navigate(results[selectedIndex]);
    }
  }, [results, selectedIndex, navigate]);

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

  const warmHint = getSearchWarmHint(warmState, query, {
    preparing: t.search.preparing,
    fallbackWarmHint: t.search.fallbackWarmHint,
  });

  return (
    <>
      {/* Header */}
      <PanelHeader title="Search" maximized={maximized} onMaximize={onMaximize} />

      {/* Search input */}
      <div className="px-4 py-3 border-b border-border shrink-0 overflow-hidden">
        <div className="flex items-center gap-3 overflow-hidden">
          <Search size={16} className="text-muted-foreground shrink-0 flex-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            className="flex-1 min-w-0 bg-transparent text-foreground text-base font-medium placeholder:text-muted-foreground/60 outline-none"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-foreground rounded-full animate-spin shrink-0 flex-none" />
          )}
          {!loading && query && (
            <button
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
              className="shrink-0 flex-none p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t.search.clear}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {warmHint && (
          <p className="mt-2 text-xs text-muted-foreground/70">{warmHint}</p>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto min-h-0" role="listbox" aria-label="Search results">
        {/* Empty state with prompt */}
        {results.length === 0 && !query && !loading && (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
              <Search size={20} className="text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">{t.search.emptyTitle}</h3>
            <p className="text-xs text-muted-foreground/70">
              {t.search.emptyHint}
            </p>
          </div>
        )}

        {/* No results state */}
        {results.length === 0 && query && !loading && (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-muted mb-4">
              <Search size={20} className="text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">{t.search.noResults}</h3>
            <p className="text-xs text-muted-foreground/70">
              {t.search.noResultsHint}
            </p>
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

        {/* Results list */}
        {results.length > 0 && (
          <Virtuoso
            totalCount={results.length}
            overscan={100}
            itemContent={(i) => {
              const result = results[i];
              const ext = result.path.endsWith('.csv') ? '.csv' : '.md';
              const { name, breadcrumb } = formatPath(result.path);
              const isSelected = i === selectedIndex;
              const isDragging = i === draggedIndex;

              return (
                <button
                  role="option"
                  aria-selected={isSelected}
                  draggable
                  onDragStart={(e) => handleDragStart(e, result)}
                  onDragEnd={handleDragEnd}
                  onDragEnter={() => setDraggedIndex(i)}
                  onDragLeave={() => setDraggedIndex(null)}
                  onClick={() => navigate(result)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`
                    w-full px-3 py-2.5 flex items-start gap-3 text-left transition-colors duration-100
                    border-b border-border/50
                    ${isSelected ? 'bg-[var(--amber-dim)] border-l-2 border-[var(--amber)]' : 'border-l-2 border-transparent'}
                    ${isDragging ? 'bg-muted/70' : isSelected ? '' : 'hover:bg-muted/60'}
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

                  {/* Drag hint */}
                  {isSelected && !isDragging && (
                    <div className="shrink-0 flex-none text-[10px] text-muted-foreground/50 font-mono pt-0.5">
                      ⬆ Drag
                    </div>
                  )}
                </button>
              );
            }}

          />
        )}
      </div>

      {/* Preview pane — shows content of selected result */}
      {results.length > 0 && (previewContent || previewLoading) && (
        <div className="border-t border-border shrink-0 max-h-[30%] overflow-y-auto">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border-b border-border/50 sticky top-0 bg-card z-10">
            <Eye size={12} className="shrink-0" />
            <span className="truncate">{previewPath ?? ''}</span>
          </div>
          {previewLoading && !previewContent ? (
            <div className="px-3 py-4 space-y-2 animate-pulse">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-4/6" />
            </div>
          ) : previewContent ? (
            <pre className="px-3 py-2 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words font-sans">
              {previewContent}
              {previewContent.length >= 2000 && (
                <span className="text-muted-foreground/40"> …</span>
              )}
            </pre>
          ) : null}
        </div>
      )}

      {/* Footer hints */}
      {results.length > 0 && (
        <div className="px-3 py-2 border-t border-border/50 flex items-center gap-2 text-xs text-muted-foreground/60 shrink-0">
          <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↑↓</kbd> {t.search.navigate}</span>
          <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">↵</kbd> {t.search.open}</span>
          <span className="text-muted-foreground/40 mx-0.5">•</span>
          <span><kbd className="font-mono text-[10px] px-1 py-0.5 bg-muted/40 rounded">Drag</kbd> {t.search.dragToChat}</span>
        </div>
      )}
    </>
  );
}
