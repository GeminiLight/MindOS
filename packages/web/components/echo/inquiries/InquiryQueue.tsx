'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { INQUIRY_UPDATED } from './inquiry-events';

const copy = {
  en: {
    title: 'Continue exploring', all: 'View all questions', refresh: 'Refresh questions',
    loading: 'Checking saved questions…', empty: 'No active questions. Start from “Explore another explanation” beside a completed reply.',
    error: 'Could not refresh questions. Previously loaded entries may be out of date.',
    partial: 'Some questions could not be read. Other saved questions are still available.',
    stages: { draft: 'Draft', framed: 'Framing recorded', testing: 'Test plan recorded', decided: 'Decision recorded' },
  },
  zh: {
    title: '继续探索', all: '查看全部问题', refresh: '刷新问题',
    loading: '正在读取已保存的问题…', empty: '暂无继续中的问题。可以从已完成回复旁的“保留另一种解释”开始。',
    error: '暂时无法刷新问题。已显示的记录可能不是最新状态。',
    partial: '部分问题暂时无法读取；其他已保存的问题仍可继续。',
    stages: { draft: '草稿', framed: '已记录判断', testing: '已有检验计划', decided: '已记录决定' },
  },
};
type Summary = { id: string; title: string; updatedAt: string; archived: boolean; stage: keyof typeof copy.en.stages };
function isSummary(value: unknown): value is Summary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && /^inquiry-[a-f0-9]{24}$/.test(item.id)
    && typeof item.title === 'string' && !!item.title.trim() && item.title.length <= 4000
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
    && typeof item.archived === 'boolean' && typeof item.stage === 'string'
    && Object.hasOwn(copy.en.stages, item.stage);
}

export default function InquiryQueue() {
  const { locale } = useLocale(); const p = copy[locale];
  const [items, setItems] = useState<Summary[]>([]);
  const [unavailable, setUnavailable] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const reload = useCallback(async (invalidate = false) => {
    // Focus and visibility often arrive together; a saved write must supersede an older read.
    if (request.current && !invalidate) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const id = ++sequence.current; setLoading(true);
    try {
      const response = await fetch('/api/echo/inquiries', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.inquiries) || !Number.isSafeInteger(data.unavailableCount) || data.unavailableCount < 0) throw new Error('Invalid question list');
      const valid = new Map<string, Summary>(); let missing = data.unavailableCount;
      for (const item of data.inquiries) {
        if (!isSummary(item) || valid.has(item.id)) { missing++; continue; }
        valid.set(item.id, item);
      }
      if (controller.signal.aborted || id !== sequence.current) return;
      setItems([...valid.values()].filter(item => !item.archived).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)));
      setUnavailable(missing); setLoaded(true); setError(false);
    } catch {
      if (!controller.signal.aborted && id === sequence.current) setError(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted && id === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    const updated = () => { void reload(true); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener(INQUIRY_UPDATED, updated);
    return () => {
      ++sequence.current; request.current?.abort(); request.current = null;
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener(INQUIRY_UPDATED, updated);
    };
  }, [reload]);
  return <section aria-labelledby="echo-inquiry-queue-title" className="space-y-3 border-b border-border pb-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="echo-inquiry-queue-title" className="font-display text-base">{p.title}</h3>
      <Button variant="ghost" className="min-h-11" disabled={loading} onClick={() => void reload()}>{p.refresh}</Button>
    </div>
    {loading && !loaded ? <p role="status" className="text-sm leading-6 text-muted-foreground">{p.loading}</p> : null}
    {error ? <p role="alert" className="border-l-2 border-error pl-3 text-sm leading-6">{p.error}</p> : null}
    {unavailable > 0 ? <p role="status" className="text-sm leading-6 text-muted-foreground">{p.partial}</p> : null}
    {loaded && !error && !unavailable && !items.length ? <p className="text-sm leading-6 text-muted-foreground">{p.empty}</p> : null}
    {items.length ? <ul className="divide-y divide-border">
      {items.slice(0, 3).map(item => <li key={item.id} className="py-2">
        <Link href={'/echo/questions?inquiry=' + item.id} className="flex min-h-11 items-center rounded text-sm font-medium leading-6 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="line-clamp-2 [overflow-wrap:anywhere]">{item.title}</span></Link>
        <p className="text-xs leading-5 text-muted-foreground">{p.stages[item.stage]}</p>
      </li>)}
    </ul> : null}
    <Link href="/echo/questions" className="inline-flex min-h-11 items-center rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.all}</Link>
  </section>;
}
