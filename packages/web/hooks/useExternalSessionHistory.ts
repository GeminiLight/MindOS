'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRuntimeIdentity } from '@/lib/types';
import type { RuntimeSessionEntry } from '@/lib/runtime-session-entry';
import { listRuntimeSessionPage } from '@/lib/runtime-session-page';

export function useExternalSessionHistory(runtime: AgentRuntimeIdentity | null, cwd: string | undefined, enabled: boolean) {
  const [entries, setEntries] = useState<RuntimeSessionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'project'>('all');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const busy = useRef(false);

  const load = useCallback(async (next?: string) => {
    if (!runtime || !enabled || (next && busy.current)) return;
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    const controller = new AbortController(); request.current.controller = controller;
    busy.current = true; setLoading(true); setError(null);
    if (!next) { setEntries([]); setCursor(null); }
    const timeout = setTimeout(() => controller.abort(new Error('Session list timed out. Please retry.')), 20_000);
    try {
      const page = await listRuntimeSessionPage(runtime, { scope, cwd, cursor: next, query, archived: runtime.kind === 'codex' && archived, signal: controller.signal });
      if (generation !== request.current.generation) return;
      setEntries(previous => {
        const byId = new Map((next ? previous : []).map(entry => [entry.id, entry]));
        for (const entry of page.entries) byId.set(entry.id, entry);
        return [...byId.values()];
      });
      if (page.nextCursor && page.nextCursor === next) throw new Error('The Agent returned a repeated page. Refresh the session list.');
      setCursor(page.nextCursor);
    } catch (cause) {
      if (generation === request.current.generation) setError(cause instanceof Error ? cause.message : 'Cannot load sessions.');
    } finally {
      clearTimeout(timeout);
      if (generation === request.current.generation) { busy.current = false; setLoading(false); }
    }
  }, [runtime?.id, runtime?.kind, cwd, enabled, scope, query, archived]);

  useEffect(() => {
    // Invalidate immediately, including during debounce, so a previous Agent's
    // late result cannot populate the newly selected Agent's list.
    request.current.generation++; request.current.controller?.abort(); busy.current = false;
    setEntries([]); setCursor(null); setError(null); setLoading(enabled && !!runtime);
    const timer = query ? setTimeout(() => { void load(); }, 200) : undefined;
    if (!query) void load();
    return () => { clearTimeout(timer); request.current.generation++; request.current.controller?.abort(); };
  }, [load]);
  useEffect(() => { if (scope === 'project' && !cwd) setScope('all'); }, [cwd, scope]);

  return { entries, setEntries, loading, error, setError, cursor, scope, setScope, query, setQuery, archived, setArchived,
    refresh: useCallback(() => { void load(); }, [load]),
    loadMore: useCallback(() => { if (cursor && !busy.current) void load(cursor); }, [load, cursor]),
  };
}
