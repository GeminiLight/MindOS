'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningLoop, TransferSummary } from '@geminilight/mindos/knowledge';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { TRANSFER_UPDATED } from './transfer-events';

const copy = {
  en: { title: 'Continue a practice', empty: 'No pending practice. You can start an optional practice from a learning record.', due: 'Ready to return', continue: 'Continue where you left off', scheduled: 'Scheduled', sample: 'Illustrative practice', open: 'Continue practice', schedule: 'View return date', refresh: 'Refresh practices', loading: 'Checking saved practices…', error: 'Could not refresh. Previously loaded entries may be out of date.', partial: 'Some records could not be read. Your other practices are still available.', all: 'Show all', less: 'Show fewer', source: 'From record' },
  zh: { title: '继续一次练习', empty: '暂无待继续的练习。你可以从学习记录中自选开始。', due: '可以回来再试了', continue: '继续上次的步骤', scheduled: '等待回看', sample: '示例练习', open: '继续练习', schedule: '查看回看安排', refresh: '刷新练习', loading: '正在检查已保存的练习…', error: '暂时无法刷新。已显示的记录可能不是最新状态。', partial: '部分记录暂时无法读取；其他练习仍可继续。', all: '展开全部', less: '收起', source: '来自记录' },
};
export default function EchoTransferQueue({ loops = [] }: { loops?: LearningLoop[] }) {
  const { locale } = useLocale(); const p = copy[locale];
  const [items, setItems] = useState<TransferSummary[]>([]);
  const [unavailable, setUnavailable] = useState(0); const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false); const [loading, setLoading] = useState(false); const [expanded, setExpanded] = useState(false);
  const request = useRef<AbortController | null>(null); const sequence = useRef(0);
  const reload = useCallback(async () => {
    request.current?.abort(); const ctrl = new AbortController(); request.current = ctrl; const id = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch('/api/echo/transfer?list=pending', { cache: 'no-store', signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.practices) || !Number.isInteger(data.unavailableCount)) throw new Error('Invalid pending list');
      if (id === sequence.current && !ctrl.signal.aborted) { setItems(data.practices); setUnavailable(data.unavailableCount); setLoaded(true); setError(false); }
    } catch { if (id === sequence.current && !ctrl.signal.aborted) setError(true); }
    finally { if (id === sequence.current && !ctrl.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    void reload(); const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', reload); window.addEventListener(TRANSFER_UPDATED, reload); document.addEventListener('visibilitychange', visible);
    return () => { ++sequence.current; request.current?.abort(); window.removeEventListener('focus', reload); window.removeEventListener(TRANSFER_UPDATED, reload); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  const hasScheduled = items.some(item => item.status === 'scheduled');
  useEffect(() => {
    if (!hasScheduled) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [hasScheduled, reload]);
  const titles = new Map(loops.map(loop => [loop.id, loop.source.title]));
  return <section aria-labelledby="echo-transfer-queue-title" className="space-y-3 border-b border-border pb-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id="echo-transfer-queue-title" className="font-display text-base">{p.title}{items.length ? ` · ${items.length}` : ''}</h3>
      <Button variant="ghost" className="min-h-11" disabled={loading} onClick={() => void reload()}>{p.refresh}</Button>
    </div>
    {loading && !loaded ? <p role="status" className="text-sm text-muted-foreground">{p.loading}</p> : null}
    {error ? <p role="alert" className="border-l-2 border-error pl-3 text-sm leading-6">{p.error}</p> : null}
    {unavailable > 0 ? <p role="status" className="text-sm leading-6 text-muted-foreground">{p.partial}</p> : null}
    {loaded && !items.length && !error && !unavailable ? <p className="text-sm leading-6 text-muted-foreground">{p.empty}</p> : null}
    {items.length ? <ul className="divide-y divide-border">
      {(expanded ? items : items.slice(0, 5)).map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium leading-6">{p[item.status]}</p>
          <p className="break-words text-xs leading-5 text-muted-foreground">{item.title} · {p.sample}{item.dueAt ? ` · ${new Date(item.dueAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}` : ''}</p>
          {titles.has(item.learningId) ? <p className="break-words text-xs leading-5 text-muted-foreground">{p.source} · {titles.get(item.learningId)}</p> : null}
        </div>
        <a href={'/echo/growth?learning=' + encodeURIComponent(item.learningId) + '&practice=1#echo-transfer-' + encodeURIComponent(item.learningId)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.status === 'scheduled' ? p.schedule : p.open}</a>
      </li>)}
    </ul> : null}
    {items.length > 5 ? <Button variant="ghost" className="min-h-11" onClick={() => setExpanded(value => !value)}>{expanded ? p.less : `${p.all} (${items.length})`}</Button> : null}
  </section>;
}
