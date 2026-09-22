'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRuntimeIdentity } from '@/lib/types';
import type { RuntimeSessionEntry } from '@/lib/runtime-session-entry';
import { listRuntimeSessionPage } from '@/lib/runtime-session-page';

export function useExternalSessionHistory(runtime: AgentRuntimeIdentity | null, cwd: string | undefined, enabled: boolean) {
  const [entries, setEntries] = useState<RuntimeSessionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'project'>('all');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const busy = useRef(false);
  const failedPage = useRef<string | undefined>(undefined);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (next?: string) => {
    if (!runtime || !enabled || (next && busy.current)) return;
    clearTimeout(debounce.current);
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    const controller = new AbortController(); request.current.controller = controller;
    busy.current = true; setLoading(true); setError(null); setCanRetry(false);
    // Refresh is transactional: keep the last successful pages until replacement succeeds.
    const timeout = setTimeout(() => controller.abort(new Error('Session list timed out. Please retry.')), 20_000);
    try {
      const page = await listRuntimeSessionPage(runtime, { scope, cwd, cursor: next, query, archived: runtime.kind === 'codex' && archived, signal: controller.signal });
      if (generation !== request.current.generation) return;
      if (page.nextCursor && page.nextCursor === next) throw new Error('The Agent returned a repeated page. Refresh the session list.');
      setEntries(previous => {
        const byId = new Map((next ? previous : []).map(entry => [entry.id, entry]));
        for (const entry of page.entries) byId.set(entry.id, entry);
        return [...byId.values()];
      });
      failedPage.current = undefined;
      setCursor(page.nextCursor);
    } catch (cause) {
      if (generation === request.current.generation) {
        failedPage.current = next;
        setCanRetry(true);
        setError(cause instanceof Error ? cause.message : 'Cannot load sessions.');
      }
    } finally {
      clearTimeout(timeout);
      if (generation === request.current.generation) { busy.current = false; setLoading(false); }
    }
  }, [runtime?.id, runtime?.kind, cwd, enabled, scope, query, archived]);

  useEffect(() => {
    // Invalidate immediately, including during debounce, so a previous Agent's
    // late result cannot populate the newly selected Agent's list.
    request.current.generation++; request.current.controller?.abort(); busy.current = false;
    failedPage.current = undefined;
    setCanRetry(false);
    setEntries([]); setCursor(null); setError(null); setLoading(enabled && !!runtime);
    debounce.current = query ? setTimeout(() => { void load(); }, 200) : undefined;
    if (!query) void load();
    return () => { clearTimeout(debounce.current); request.current.generation++; request.current.controller?.abort(); };
  }, [load]);
  useEffect(() => { if (scope === 'project' && !cwd) setScope('all'); }, [cwd, scope]);

  return { entries, setEntries, loading, error, canRetry,
    setError: useCallback((message: string | null) => { setCanRetry(false); setError(message); }, []), cursor, scope, setScope, query, setQuery, archived, setArchived,
    retry: useCallback(() => { if (!busy.current) void load(failedPage.current); }, [load]),
    refresh: useCallback(() => { void load(); }, [load]),
    loadMore: useCallback(() => { if (cursor && !busy.current) void load(cursor); }, [load, cursor]),
  };
}
