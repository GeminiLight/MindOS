'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, FileText, Table } from 'lucide-react';
import { SearchResult } from '@/lib/types';
import { encodePath } from '@/lib/utils';
import { useLocale } from '@/lib/LocaleContext';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useLocale();

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
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
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data: SearchResult[] = await res.json();
        setResults(data);
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
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        if (results[selectedIndex]) navigate(results[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, results, selectedIndex, navigate]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            placeholder={t.search.placeholder}
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground text-sm outline-none"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-foreground rounded-full animate-spin shrink-0" />
          )}
          {!loading && query && (
            <button onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}>
              <X size={14} className="text-muted-foreground hover:text-foreground" />
            </button>
          )}
          <kbd className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && query && !loading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t.search.noResults}</div>
          )}
          {results.length === 0 && !query && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground/60">{t.search.prompt}</div>
          )}
          {results.map((result, i) => {
            const ext = result.path.endsWith('.csv') ? '.csv' : '.md';
            const parts = result.path.split('/');
            const fileName = parts[parts.length - 1];
            const dirPath = parts.slice(0, -1).join('/');
            return (
              <button
                key={result.path}
                onClick={() => navigate(result)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`
                  w-full px-4 py-3 flex items-start gap-3 text-left transition-colors duration-75
                  ${i === selectedIndex ? 'bg-muted' : 'hover:bg-muted/50'}
                  ${i < results.length - 1 ? 'border-b border-border' : ''}
                `}
              >
                {ext === '.csv'
                  ? <Table size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <FileText size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                }
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm text-foreground font-medium truncate">{fileName}</span>
                    {dirPath && (
                      <span className="text-xs text-muted-foreground truncate">{dirPath}</span>
                    )}
                  </div>
                  {result.snippet && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                      {result.snippet}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-xs text-muted-foreground/60">
            <span><kbd className="font-mono">↑↓</kbd> {t.search.navigate}</span>
            <span><kbd className="font-mono">↵</kbd> {t.search.open}</span>
            <span><kbd className="font-mono">ESC</kbd> {t.search.close}</span>
          </div>
        )}
      </div>
    </div>
  );
}
