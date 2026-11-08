'use client';
import { learningRecordStatus } from './learning-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Search } from 'lucide-react';
import type { LearningLoop } from '@geminilight/mindos/knowledge';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import EchoLearningEditor from './EchoLearningEditor';
import EchoTransferQueue from './EchoTransferQueue';
import EchoTransferPractice from './EchoTransferPractice';
import InquiryQueue from '../inquiries/InquiryQueue';
import { transferCopy } from './transfer-copy';
import { requestLearningNavigation } from './use-learning-draft-guard';
import { LEARNING_UPDATED, learningRequest, learningErrorMessage, reviewIsDue } from './learning-client';

export default function EchoLearningPanel() {
  const { t, locale } = useLocale();
  const p = t.echoLearning;
  const w = p.workspace;
  const [search, setSearch] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [missingLink, setMissingLink] = useState(false);
  const focusSelection = useRef(false);
  const detail = useRef<HTMLDivElement>(null);
  const [loops, setLoops] = useState<LearningLoop[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    if (selected && focusSelection.current) {
      focusSelection.current = false;
      const heading = detail.current?.querySelector('h3');
      heading?.focus();
      heading?.scrollIntoView?.({ block: 'start' });
    }
  }, [selected]);
  function rememberSelection(id: string | null) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('learning') !== id) {
      url.searchParams.delete('practice');
      if (url.hash.startsWith('#echo-transfer-')) url.hash = '';
      setReturningPractice(null);
    }
    if (id) url.searchParams.set('learning', id);
    else url.searchParams.delete('learning');
    window.history.replaceState(window.history.state, '', url);
    consumedLink.current = id;
    setMissingLink(false);
  }
  function selectRecord(id: string) {
    if (selected !== id && !requestLearningNavigation()) return;
    focusSelection.current = true;
    setSelected(id); setBrowsing(false); rememberSelection(id);
    if (selected === id) detail.current?.querySelector('h3')?.focus();
  }
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const [returningPractice, setReturningPractice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search); const id = params.get('learning');
    if (params.get('practice') === '1' && id && /^learn-[a-f0-9]{24}$/.test(id)) setReturningPractice(id);
  }, []);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const consumedLink = useRef<string | null>(null);
  const updatesDuringLoad = useRef(new Map<string, LearningLoop>());
  const reload = useCallback(async () => {
    controller.current?.abort();
    const ctrl = new AbortController(); controller.current = ctrl;
    const id = ++requestId.current;
    updatesDuringLoad.current.clear();
    setLoading(true);
    try {
      const data = await learningRequest(undefined, 'GET', ctrl.signal);
      if (!Array.isArray(data.loops)) throw new Error('Missing learning records');
      if (id === requestId.current) {
        const merged = new Map(data.loops.map((loop) => [loop.id, loop]));
        // A start/save can finish before the initial read. Keep both that write and the rest of the list.
        for (const loop of updatesDuringLoad.current.values()) {
          if ((merged.get(loop.id)?.version ?? 0) <= loop.version) merged.set(loop.id, loop);
        }
        setLoops([...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        const linked = new URLSearchParams(window.location.search).get('learning');
        setMissingLink(!!linked && !merged.has(linked));
        if (linked && merged.has(linked) && consumedLink.current !== linked) {
          consumedLink.current = linked;
          if (!selectedRef.current && new URLSearchParams(window.location.search).get('practice') !== '1') focusSelection.current = true;
          setSelected((current) => current ?? linked);
          setArchived(merged.get(linked)!.archived);
        }
        setError('');
      }
    } catch (err) {
      if (!ctrl.signal.aborted && id === requestId.current) setError(learningErrorMessage(err, p));
    } finally { if (id === requestId.current) setLoading(false); }
  }, [p]);
  useEffect(() => {
    void reload();
    const update = (event: Event) => {
      const { loop, select } = (event as CustomEvent<{ loop: LearningLoop; select: boolean }>).detail;
      updatesDuringLoad.current.set(loop.id, loop);
      setLoops((current) => [loop, ...current.filter((item) => item.id !== loop.id)]);
      if (select && (selectedRef.current === loop.id || requestLearningNavigation())) { setSelected(loop.id); setArchived(loop.archived); setBrowsing(false); rememberSelection(loop.id); }
      else if (selectedRef.current === loop.id) setArchived(loop.archived);
    };
    window.addEventListener(LEARNING_UPDATED, update);
    window.addEventListener('focus', reload);
    return () => { ++requestId.current; controller.current?.abort(); window.removeEventListener(LEARNING_UPDATED, update); window.removeEventListener('focus', reload); };
  }, [reload]);
  const filtered = loops.filter((loop) => loop.archived === archived);
  const visible = filtered.filter((loop) => loop.source.title.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale)));
  function changeFilter(value: boolean) {
    if (value === archived || !requestLearningNavigation()) return;
    setArchived(value); setSelected(null); setSearch(''); rememberSelection(null);
  }
  const current = loops.find((loop) => loop.id === selected);
  return (
    <section id="echo-learning" className="@container scroll-mt-4 space-y-6" aria-labelledby="echo-learning-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="echo-learning-title" className="text-base font-medium">{w.records}</h2>
        {loops.length > 0 && <Link href="/echo/growth#echo-insight" className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}>{w.newPractice}<ArrowRight aria-hidden /></Link>}
      </header>
      {loading ? <p className="text-sm text-muted-foreground" role="status">{p.loading}</p> : null}
      {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/40 p-4 text-sm leading-6"><span>{error}</span><Button className="min-h-11" variant="outline" size="sm" onClick={() => void reload()}>{p.reload}</Button></div> : null}
      {missingLink && !loading && !error ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-border pl-3 text-sm leading-6"><p>{w.unavailable}</p><Button variant="outline" className="min-h-11" onClick={() => void reload()}>{p.reload}</Button></div> : null}
      <EchoTransferQueue loops={loops} hideWhenEmpty />
      {loops.length ? <>
        {current && <Button variant="outline" className="min-h-11 @min-[680px]:hidden" aria-expanded={browsing} aria-controls="learning-record-list" onClick={() => setBrowsing(value => !value)}>{w.browseRecords}</Button>}
        <div className="grid min-w-0 items-start gap-6 @min-[680px]:grid-cols-[210px_minmax(0,1fr)]">
          <div id="learning-record-list" className={cn('min-w-0 space-y-3 @min-[680px]:block', current && !browsing && 'hidden')}>
            <div className="flex flex-wrap gap-1 border-b border-border pb-2" role="group" aria-label={w.records}>
              {[false, true].map((value) => <Button key={String(value)} size="sm" variant="ghost" aria-pressed={archived === value}
                className={cn('min-h-11', archived === value && 'bg-muted font-medium')} onClick={() => changeFilter(value)}>{value ? p.archived : p.active}</Button>)}
            </div>
            <label className="relative block">
              <span className="sr-only">{w.search}</span><Search size={15} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" aria-hidden />
              <Input name="learningSearch" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={w.searchPlaceholder} className="min-h-11 pl-9" />
            </label>
            <ul className="space-y-1 max-h-64 overflow-y-auto @min-[680px]:max-h-[32rem] p-1 -m-1">
              {visible.map((loop) => <li key={loop.id} className={cn('rounded-lg border-l-2 px-3 py-2 transition-colors duration-150', selected === loop.id ? 'border-[var(--amber)] bg-[var(--amber-subtle)]' : 'border-transparent hover:bg-muted/50')}>
                <button type="button" aria-expanded={selected === loop.id} aria-controls="learning-record-detail" onClick={() => selectRecord(loop.id)}
                  className="min-h-11 w-full min-w-0 rounded text-left text-sm font-medium leading-6 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{loop.source.title}</button>
                <p className={cn('pb-1 text-xs leading-5', reviewIsDue(loop) ? 'font-medium text-foreground' : 'text-muted-foreground')}>{learningRecordStatus(loop, p)}</p>
              </li>)}
            </ul>
            {!visible.length && <div role="status" className="py-5 text-sm leading-6 text-muted-foreground">
              <p>{search.trim() ? w.noResults : archived ? w.noArchived : p.empty}</p>
              {search.trim() ? <Button variant="ghost" className="mt-2 min-h-11" onClick={() => setSearch('')}>{w.clearSearch}</Button> : null}
            </div>}
          </div>
          <div ref={detail} id="learning-record-detail" className="min-w-0">
            {current ? <EchoLearningEditor key={current.id} loop={current} p={p} /> : <div className="flex min-h-64 flex-col justify-center border-y border-border py-8 @min-[680px]:px-6">
              <BookOpen size={24} strokeWidth={1.5} className="mb-4 text-muted-foreground" aria-hidden />
              <h3 className="text-lg font-medium">{w.select}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{w.selectHint}</p>
            </div>}
          </div>
        </div>
      </> : null}
      {!loading && !error && loops.length === 0 ? <div className="border-y border-border py-8 sm:py-10">
        <div className="grid gap-8 @min-[680px]:grid-cols-[1fr_1fr] @min-[680px]:gap-12">
          <div className="flex flex-col items-start justify-center">
            <BookOpen size={26} strokeWidth={1.5} className="mb-5 text-[var(--amber)]" aria-hidden />
            <h3 className="text-2xl font-medium leading-9">{p.empty}</h3>
            <p className="mt-3 max-w-sm text-sm leading-7 text-muted-foreground">{p.emptyHint}</p>
            <Link href="/echo/growth#echo-insight" className={buttonVariants({ variant: 'amber', className: 'mt-6 min-h-11 px-4' })}>{p.findInsight}<ArrowRight aria-hidden /></Link>
          </div>
          <ol className="space-y-6" aria-label={p.title}>
            {p.steps.map((step, index) => <li key={step} className="flex items-start gap-4">
              <span className="pt-1 font-mono text-xs text-muted-foreground">0{index + 1}</span>
              <div><p className="text-sm font-medium leading-6">{step}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{w.stepHints[index]}</p></div>
            </li>)}
          </ol>
        </div>
      </div> : null}
      {returningPractice && !loading && !loops.some(loop => loop.id === returningPractice) ? <div className="space-y-2">
        <p className="text-sm leading-6 text-muted-foreground">{transferCopy[locale].sourceUnavailable}</p>
        <EchoTransferPractice key={returningPractice} learningId={returningPractice} locale={locale} archived />
      </div> : null}
      <details className="group border-t border-border pt-2">
        <summary className="min-h-11 cursor-pointer rounded py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{w.supporting}</summary>
        <p className="mb-5 text-sm leading-6 text-muted-foreground">{w.supportingHint}</p>
        <InquiryQueue />
      </details>
    </section>
  );
}
