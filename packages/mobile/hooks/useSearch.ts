import { useCallback, useEffect, useRef, useState } from 'react';
import { mindosClient } from '@/lib/api-client';
import { canRunSearch, getNormalizedSearchQuery, getSearchErrorMessage } from '@/lib/search-state';
import type { SearchResult } from '@/lib/types';

/** Invalidate immediately on input, including the interval before the next request starts. */
export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    request.current?.abort(); request.current = null;
  }, []);
  const run = useCallback(async (text: string) => {
    cancel();
    const normalized = getNormalizedSearchQuery(text);
    if (!canRunSearch(normalized)) { setLoading(false); return; }
    const id = generation.current;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setSearched(true); setError('');
    try {
      const data = await mindosClient.search(normalized, controller.signal);
      if (id === generation.current) setResults(data);
    } catch (e) {
      if (id === generation.current) { setResults([]); setError(getSearchErrorMessage(e)); }
    } finally { if (id === generation.current) setLoading(false); }
  }, [cancel]);
  const changeQuery = useCallback((text: string) => {
    cancel(); setQuery(text); setResults([]); setError(''); setSearched(false);
    setLoading(canRunSearch(text));
    if (canRunSearch(text)) timer.current = setTimeout(() => void run(text), 400);
  }, [cancel, run]);
  useEffect(() => cancel, [cancel]);
  const submit = useCallback(() => run(query), [query, run]);
  return { query, results, loading, searched, error, changeQuery, submit };
}
