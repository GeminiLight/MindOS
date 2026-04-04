'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, FileText, Table } from 'lucide-react';
import { SearchResult } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/LocaleContext';
import PanelHeader from './PanelHeader';
import { Virtuoso } from 'react-virtuoso';

/** Highlight matched text fragments in a snippet based on the query */
function highlightSnippet(snippet: string, query: string): React.ReactNode {
  if (!query.trim()) return snippet;
  const words = query.trim().split(/\s+/).filter(Boolean);
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = snippet.split(pattern);
  return parts.map((part, i) =>
    pattern.test(part) ? <mark key={i} className="bg-yellow-300/40 text-foreground rounded-sm px-0.5">{part}</mark> : part
  );
}

interface SearchPanelProps {
  /** When true the panel is visible — triggers focus & reset */
  active: boolean;
  /** Called when user navigates to a result (panel host may want to close) */
  onNavigate?: () => void;
  maximized?: boolean;
  onMaximize?: () => void;
}

export default function SearchPanel({ active, onNavigate, maximized, onMaximize }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
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

  return (
    <>
      {/* Header */}
      <PanelHeader title="Search" maximized={maximized} onMaximize={onMaximize} />

      {/* Search input */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <Search size={14} className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t.search.placeholder}
          aria-label={t.search.placeholder}
          className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none"
        />
        {loading && (
          <div className="w-3.5 h-3.5 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin shrink-0" />
        )}
        {!loading && query && (
          <button onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}>
            <X size={13} className="text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto min-h-0" role="listbox" aria-label="Search results">
        {results.length === 0 && query && !loading && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t.search.noResults}</div>
        )}
        {results.length === 0 && !query && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">{t.search.prompt}</div>
        )}
        {results.length > 0 && (
          <Virtuoso
            totalCount={results.length}
            overscan={100}
            itemContent={(i) => {
              const result = results[i];
              const ext = result.path.endsWith('.csv') ? '.csv' : '.md';
              const parts = result.path.split('/');
              const fileName = parts[parts.length - 1];
              const dirPath = parts.slice(0, -1).join('/');
              return (
                <button
                  role="option"
                  aria-selected={i === selectedIndex}
                  onClick={() => navigate(result)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`
                    w-full px-4 py-2.5 flex items-start gap-3 text-left transition-colors duration-75
                    ${i === selectedIndex ? 'bg-muted' : 'hover:bg-muted/50'}
                    ${i < results.length - 1 ? 'border-b border-border' : ''}
                  `}
                >
                  {ext === '.csv'
                    ? <Table size={13} className="text-success shrink-0 mt-0.5" />
                    : <FileText size={13} className="text-muted-foreground shrink-0 mt-0.5" />
                  }
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm text-foreground font-medium truncate" title={fileName}>{fileName}</span>
                      {dirPath && (
                        <span className="text-xs text-muted-foreground truncate" title={dirPath}>{dirPath}</span>
                      )}
                    </div>
                    {result.snippet && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed" title={result.snippet}>
                        {highlightSnippet(result.snippet, query)}
                      </p>
                    )}
                  </div>
                </button>
              );
            }}
          />
        )}
      </div>

      {/* Footer hints */}
      {results.length > 0 && (
        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground/50 shrink-0">
          <span><kbd className="font-mono">↑↓</kbd> {t.search.navigate}</span>
          <span><kbd className="font-mono">↵</kbd> {t.search.open}</span>
        </div>
      )}
    </>
  );
}
