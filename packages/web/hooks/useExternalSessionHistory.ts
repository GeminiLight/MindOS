'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRuntimeIdentity } from '@/lib/types';
import type { RuntimeSessionEntry } from '@/lib/runtime-session-entry';
import { listRuntimeSessionPage } from '@/lib/runtime-session-page';

export const HISTORY_REOPEN_FRESH_MS = 30_000;

export function useExternalSessionHistory(runtime: AgentRuntimeIdentity | null, cwd: string | undefined, enabled: boolean) {
  const [entries, setEntries] = useState<RuntimeSessionEntry[]>([]);
  const [loading, setLoading] = useState(enabled && Boolean(runtime));
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
  const requestedCwd = scope === 'project' ? cwd : undefined;
  const viewKey = JSON.stringify([runtime?.kind, runtime?.id, scope, requestedCwd, query.trim(), runtime?.kind === 'codex' && archived]);
  const retainedView = useRef<{ key: string; loadedAt?: number }>({ key: viewKey });

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
      const page = await listRuntimeSessionPage(runtime, { scope, cwd: requestedCwd, cursor: next, query, archived: runtime.kind === 'codex' && archived, signal: controller.signal });
      if (generation !== request.current.generation) return;
      if (page.nextCursor && page.nextCursor === next) throw new Error('The Agent returned a repeated page. Refresh the session list.');
      setEntries(previous => {
        const byId = new Map((next ? previous : []).map(entry => [entry.id, entry]));
        for (const entry of page.entries) byId.set(entry.id, entry);
        return [...byId.values()];
      });
      failedPage.current = page.warning ? page.nextCursor ?? next : undefined;
      if (page.warning) { setError(page.warning); setCanRetry(true); }
      setCursor(page.nextCursor);
      if (!next) retainedView.current.loadedAt = Date.now();
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
  }, [runtime?.id, runtime?.kind, requestedCwd, enabled, scope, query, archived]);

  useEffect(() => {
    request.current.generation++; request.current.controller?.abort(); busy.current = false;
    const changed = retainedView.current.key !== viewKey;
    if (changed) {
      retainedView.current = { key: viewKey };
      failedPage.current = undefined; setCanRetry(false);
      setEntries([]); setCursor(null); setError(null);
    }
    setLoading(false);
    const fresh = retainedView.current.loadedAt !== undefined
      && Date.now() - retainedView.current.loadedAt < HISTORY_REOPEN_FRESH_MS;
    if (enabled && runtime && !fresh) {
      setLoading(true);
      debounce.current = query ? setTimeout(() => { void load(); }, 200) : undefined;
      if (!query) void load();
    }
    // Closing keeps the last successful pages, but invalidates unfinished work.
    // A different query or Agent always starts a separate view, even while hidden.
    return () => { clearTimeout(debounce.current); request.current.generation++; request.current.controller?.abort(); };
  }, [load, viewKey, enabled]);
  useEffect(() => { if (scope === 'project' && !cwd) setScope('all'); }, [cwd, scope]);

  const matchesView = retainedView.current.key === viewKey;
  return { entries: matchesView ? entries : [], setEntries, loading: matchesView ? loading : enabled && Boolean(runtime), error: matchesView ? error : null, canRetry: matchesView && canRetry,
    setError: useCallback((message: string | null) => { setCanRetry(false); setError(message); }, []), cursor: matchesView ? cursor : null, scope, setScope, query, setQuery, archived, setArchived,
    retry: useCallback(() => { if (!busy.current) void load(failedPage.current); }, [load]),
    refresh: useCallback(() => { void load(); }, [load]),
    loadMore: useCallback(() => { if (cursor && !busy.current) void load(cursor); }, [load, cursor]),
  };
}
