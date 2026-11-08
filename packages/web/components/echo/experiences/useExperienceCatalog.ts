'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplaySourceSummary } from '@geminilight/mindos/knowledge/branch-replay';
import { experienceSourceKey, mergeExperienceSources, type ExperienceCatalog, type ExperienceEpisode } from '@/lib/echo-experiences';
import { mergeExperienceCatalogSnapshot, restoreExperienceCatalog } from '@/lib/echo-experience-cache';
const empty: ExperienceCatalog = { sources: [], episodes: [], cursors: { codex: null, claude: null }, sourceErrors: [] };
const catalogCacheKey = 'mindos:echo-experiences:catalog:v2';
export function useExperienceCatalog() {
  const [catalog, setCatalog] = useState<ExperienceCatalog>(empty), [loading, setLoading] = useState(true), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState('');
  const current = useRef(catalog); useEffect(() => { current.current = catalog; }, [catalog]);
  const loadRequest = useRef<AbortController | null>(null), scanRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true), queryRef = useRef(''), archivedRef = useRef(false);
  const load = useCallback(async (query = '', archived = false, more = false) => {
    loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller;
    queryRef.current = query; archivedRef.current = archived; setLoading(true); setError('');
    const params = new URLSearchParams({ query, archived: archived ? '1' : '0' });
    if (more) for (const runtime of ['codex', 'claude'] as const) params.set(runtime, current.current.cursors[runtime] ?? 'done');
    try {
      const response = await fetch(`/api/echo/experiences?${params}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
      const data = await response.json() as ExperienceCatalog & { error?: string }; if (!response.ok) throw new Error(data.error || '读取经历失败，请重试。');
      if (!mounted.current || controller.signal.aborted) return;
      let known: ExperienceCatalog | null = null;
      if (!query && !archived) { try { known = restoreExperienceCatalog(JSON.parse(sessionStorage.getItem(catalogCacheKey) || 'null')); } catch { /* In-memory discovery still works. */ } }
      setCatalog(previous => ({ ...data, sources: more || (!query && !archived) ? mergeExperienceSources(mergeExperienceSources(known?.sources || [], previous.sources).filter(source => archived || !source.archived), data.sources) : mergeExperienceSources([], data.sources),
        episodes: [...new Map([...previous.episodes.filter(episode => episode.status !== 'ready' || !data.sources.some(source => experienceSourceKey(source) === experienceSourceKey(episode.source))), ...data.episodes].map(episode => [experienceSourceKey(episode.source), episode])).values()] }));
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error && failure.name === 'TimeoutError' ? '读取本地经历超时，请重试。' : '暂时无法读取本地经历，请重试。'); }
    finally { if (mounted.current && loadRequest.current === controller) setLoading(false); }
  }, []);
  const analyze = useCallback(async (sources: ReplaySourceSummary[]) => {
    if (scanRequest.current || !sources.length) return;
    const controller = new AbortController(); scanRequest.current = controller; setAnalyzing(true); setError('');
    try {
      const response = await fetch('/api/echo/experiences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sources: sources.slice(0, 8).map(source => ({ runtime: source.runtime, id: source.id })) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
      const data = await response.json() as { episodes: ExperienceEpisode[]; error?: string }; if (!response.ok) throw new Error(data.error || '整理失败，请重试。');
      if (controller.signal.aborted || !mounted.current) return;
      setCatalog(previous => ({ ...previous, episodes: [...new Map([...previous.episodes, ...data.episodes.map(episode => ({ ...episode, source: { ...episode.source, ...sources.find(source => experienceSourceKey(source) === experienceSourceKey(episode.source)) } }))].map(episode => [experienceSourceKey(episode.source), episode])).values()] }));
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : '整理失败，请重试。'); }
    finally { if (scanRequest.current === controller) { scanRequest.current = null; if (mounted.current) setAnalyzing(false); } }
  }, []);
  const cancel = useCallback(() => { scanRequest.current?.abort(); scanRequest.current = null; setAnalyzing(false); }, []);
  // Restoring browser storage and starting a remote read are external synchronization.
  useEffect(() => {
    mounted.current = true;
    try { const stored = restoreExperienceCatalog(JSON.parse(sessionStorage.getItem(catalogCacheKey) || 'null'));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (stored) setCatalog({...stored,sources:stored.sources.filter(source=>!source.archived)});
    } catch { /* Fresh discovery remains available if browser storage is blocked. */ }
    void load(); return () => { mounted.current = false; loadRequest.current?.abort(); scanRequest.current?.abort(); }; }, [load]);
  useEffect(() => { if (!loading && catalog.sources.length) { try {
    const previous = restoreExperienceCatalog(JSON.parse(sessionStorage.getItem(catalogCacheKey) || 'null'));
    const snapshot = mergeExperienceCatalogSnapshot(previous, catalog, !queryRef.current && !archivedRef.current);
    sessionStorage.setItem(catalogCacheKey, JSON.stringify(snapshot));
  } catch { /* Memory and URL navigation still work. */ } } }, [catalog, loading]);
  return { catalog, loading, analyzing, error, load, analyze, cancel, more: () => load(queryRef.current, archivedRef.current, true) };
}
