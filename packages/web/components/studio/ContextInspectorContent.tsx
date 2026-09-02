'use client';

import Link from 'next/link';
import { AlertCircle, ArrowUpRight, Boxes, FileSearch, RefreshCw, Search, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ContextAsset } from '@geminilight/mindos/knowledge';
import type { RetrievalReceipt } from '@geminilight/mindos/retrieval';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import { contextAssetViewHref, fetchContextObservability } from '@/lib/context-observability';
import { StudioOverviewLink } from './StudioOverviewLink';
import { StudioShell } from './StudioShell';

const COPY = {
  en: {
    title: 'Context Inspector', subtitle: 'Inspect what MindOS can recall and why a retrieval selected it.',
    assets: 'Assets', receipts: 'Receipts', searchAssets: 'Search assets', searchReceipts: 'Search receipts',
    allStatuses: 'All statuses', allKinds: 'All kinds', allOutcomes: 'All outcomes',
    emptyAssets: 'No assets match these filters.', emptyReceipts: 'No receipts match these filters.',
    failed: 'Could not load context observability data.', retry: 'Try again', openFile: 'Open file',
    source: 'Source', version: 'Version', updated: 'Updated', linkedReceipts: 'Linked receipts',
    noLinkedReceipts: 'No retrieval receipts reference this asset yet.', query: 'Query', strategy: 'Strategy',
    duration: 'Duration', budget: 'Budget', selections: 'Selections', candidates: 'Candidates',
    inspectReceipt: 'Inspect receipt', inspectAsset: 'Inspect asset',
    tokens: 'tokens', assetsSuffix: 'assets', receiptsSuffix: 'receipts', selectedSuffix: 'selected', failedSuffix: 'failed',
  },
  zh: {
    title: '上下文检查器', subtitle: '检查 MindOS 能回忆什么，以及一次检索为何选择这些内容。',
    assets: '资产', receipts: '检索回执', searchAssets: '搜索资产', searchReceipts: '搜索回执',
    allStatuses: '全部状态', allKinds: '全部类型', allOutcomes: '全部结果',
    emptyAssets: '没有符合筛选条件的资产。', emptyReceipts: '没有符合筛选条件的检索回执。',
    failed: '无法加载上下文可观测数据。', retry: '重试', openFile: '打开文件',
    source: '来源', version: '版本', updated: '更新时间', linkedReceipts: '关联回执',
    noLinkedReceipts: '暂时没有检索回执引用这项资产。', query: '查询', strategy: '策略',
    duration: '耗时', budget: '预算', selections: '选中内容', candidates: '候选',
    inspectReceipt: '查看回执', inspectAsset: '查看资产',
    tokens: 'tokens', assetsSuffix: '项资产', receiptsSuffix: '条回执', selectedSuffix: '次命中', failedSuffix: '次失败',
  },
} as const;

type Tab = 'assets' | 'receipts';

export default function ContextInspectorContent() {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [tab, setTab] = useState<Tab>('assets');
  const [assets, setAssets] = useState<ContextAsset[]>([]);
  const [receipts, setReceipts] = useState<RetrievalReceipt[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [selectedReceiptId, setSelectedReceiptId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetchContextObservability(controller.signal).then((payload) => {
      setAssets(payload.assets.assets);
      setReceipts(payload.receipts.receipts);
      setSelectedAssetId((current) => current ?? payload.assets.assets[0]?.id);
      setSelectedReceiptId((current) => current ?? payload.receipts.receipts[0]?.id);
    }).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(true);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [reload]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAssets = useMemo(() => assets.filter((asset) => {
    if (status !== 'all' && asset.status !== status) return false;
    if (kind !== 'all' && asset.kind !== kind) return false;
    return !normalizedQuery || [asset.title, asset.path, asset.id, asset.source.ref]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }), [assets, kind, normalizedQuery, status]);
  const filteredReceipts = useMemo(() => receipts.filter((receipt) => {
    if (outcome !== 'all' && receipt.outcome !== outcome) return false;
    return !normalizedQuery || [receipt.id, receipt.queryPreview, receipt.strategy, receipt.error ?? '', ...receipt.selections.map((item) => item.path)]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }), [normalizedQuery, outcome, receipts]);
  const selectedAsset = filteredAssets.find((asset) => asset.id === selectedAssetId) ?? filteredAssets[0];
  const selectedReceipt = filteredReceipts.find((receipt) => receipt.id === selectedReceiptId) ?? filteredReceipts[0];
  const selectReceipt = (receiptId: string) => {
    setTab('receipts');
    setQuery('');
    setOutcome('all');
    setSelectedReceiptId(receiptId);
  };
  const selectAsset = (assetId: string) => {
    setTab('assets');
    setQuery('');
    setStatus('all');
    setKind('all');
    setSelectedAssetId(assetId);
  };

  return (
    <StudioShell contentMaxWidth="full">
      <div data-context-inspector className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5">
        <header className="border-b border-border/60 pb-5">
          <StudioOverviewLink locale={locale} />
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
            </div>
            {!error && !loading ? (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Metric value={assets.length} label={copy.assetsSuffix} />
                <Metric value={receipts.length} label={copy.receiptsSuffix} />
                <Metric value={receipts.filter((item) => item.outcome === 'selected').length} label={copy.selectedSuffix} />
                <Metric value={receipts.filter((item) => item.outcome === 'error' || item.outcome === 'timeout').length} label={copy.failedSuffix} />
              </div>
            ) : null}
          </div>
        </header>

        {error ? (
          <div role="alert" className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-border/60 bg-muted/20 p-8 text-center">
            <AlertCircle size={22} className="text-error" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">{copy.failed}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setReload((value) => value + 1)}>
              <RefreshCw size={14} />{copy.retry}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div role="tablist" className="inline-flex rounded-md border border-border/60 bg-muted/20 p-1">
                <TabButton active={tab === 'assets'} onClick={() => { setTab('assets'); setQuery(''); }}>{copy.assets}</TabButton>
                <TabButton active={tab === 'receipts'} onClick={() => { setTab('receipts'); setQuery(''); }}>{copy.receipts}</TabButton>
              </div>
              <label className="relative min-w-48 flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'assets' ? copy.searchAssets : copy.searchReceipts} className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
              </label>
              {tab === 'assets' ? (
                <>
                  <FilterSelect value={status} onChange={setStatus} label={copy.allStatuses} options={['active', 'draft', 'deprecated']} />
                  <FilterSelect value={kind} onChange={setKind} label={copy.allKinds} options={['knowledge', 'echo-playbook', 'echo-practice', 'skill', 'workflow', 'automation-run']} />
                </>
              ) : <FilterSelect value={outcome} onChange={setOutcome} label={copy.allOutcomes} options={['selected', 'empty', 'timeout', 'error', 'skipped']} />}
            </div>

            <div className="grid min-h-[28rem] gap-4 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
              <div className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-background/35">
                {loading ? <LoadingRows /> : tab === 'assets' ? (
                  filteredAssets.length ? filteredAssets.map((asset) => (
                    <AssetRow key={asset.id} asset={asset} selected={asset.id === selectedAsset?.id} onClick={() => setSelectedAssetId(asset.id)} />
                  )) : <EmptyState icon={<Boxes size={20} />} text={copy.emptyAssets} />
                ) : filteredReceipts.length ? filteredReceipts.map((receipt) => (
                  <ReceiptRow key={receipt.id} receipt={receipt} selected={receipt.id === selectedReceipt?.id} onClick={() => setSelectedReceiptId(receipt.id)} />
                )) : <EmptyState icon={<Waypoints size={20} />} text={copy.emptyReceipts} />}
              </div>
              <div className="min-w-0 rounded-lg border border-border/60 bg-background/35 p-5">
                {!loading && tab === 'assets' && selectedAsset ? <AssetDetail asset={selectedAsset} receipts={receipts} copy={copy} locale={locale} onSelectReceipt={selectReceipt} /> : null}
                {!loading && tab === 'receipts' && selectedReceipt ? <ReceiptDetail receipt={selectedReceipt} availableAssetIds={new Set(assets.map((asset) => asset.id))} copy={copy} locale={locale} onSelectAsset={selectAsset} /> : null}
              </div>
            </div>
          </>
        )}
      </div>
    </StudioShell>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <span className="rounded-md border border-border/60 px-2.5 py-1"><strong className="text-foreground">{value}</strong> {label}</span>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick(): void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={cn('rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{children}</button>;
}

function FilterSelect({ value, onChange, label, options }: { value: string; onChange(value: string): void; label: string; options: string[] }) {
  return <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">{label}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function AssetRow({ asset, selected, onClick }: { asset: ContextAsset; selected: boolean; onClick(): void }) {
  return <button type="button" onClick={onClick} className={cn('block w-full border-b border-border/45 px-4 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected ? 'bg-[var(--amber-subtle)]' : 'hover:bg-muted/25')}><div className="truncate text-sm font-medium text-foreground">{asset.title}</div><div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span>{asset.kind}</span><span aria-hidden="true">·</span><span>{asset.status}</span></div><div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{asset.path}</div></button>;
}

function ReceiptRow({ receipt, selected, onClick }: { receipt: RetrievalReceipt; selected: boolean; onClick(): void }) {
  return <button type="button" onClick={onClick} className={cn('block w-full border-b border-border/45 px-4 py-3 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected ? 'bg-[var(--amber-subtle)]' : 'hover:bg-muted/25')}><div className="flex items-center justify-between gap-3"><span className="truncate font-mono text-xs text-foreground">{receipt.id}</span><StatusBadge value={receipt.outcome} /></div><div className="mt-1 truncate text-xs text-muted-foreground">{receipt.queryPreview || '—'}</div><div className="mt-1 text-[11px] text-muted-foreground">{receipt.totals.selectedCount}/{receipt.totals.candidateCount} · {receipt.durationMs}ms</div></button>;
}

function AssetDetail({ asset, receipts, copy, locale, onSelectReceipt }: { asset: ContextAsset; receipts: RetrievalReceipt[]; copy: (typeof COPY)[keyof typeof COPY]; locale: string; onSelectReceipt(receiptId: string): void }) {
  const linked = receipts.filter((receipt) => receipt.selections.some((selection) => selection.assetId === asset.id));
  return <div><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-foreground">{asset.title}</h2><StatusBadge value={asset.status} /></div><p className="mt-1 font-mono text-xs text-muted-foreground">{asset.id}</p></div><Button render={<Link href={contextAssetViewHref(asset.path)} />} nativeButton={false} variant="outline" size="sm">{copy.openFile}<ArrowUpRight size={13} /></Button></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><Detail label={copy.source} value={`${asset.source.kind} · ${asset.source.ref}`} /><Detail label={copy.version} value={String(asset.version)} /><Detail label={copy.updated} value={formatDate(asset.updatedAt, locale)} /><Detail label="Content hash" value={asset.contentHash.slice(0, 12)} mono /></dl><h3 className="mt-7 text-sm font-semibold text-foreground">{copy.linkedReceipts}</h3>{linked.length ? <div className="mt-2 space-y-2">{linked.map((receipt) => { const selection = receipt.selections.find((item) => item.assetId === asset.id); return <button type="button" key={receipt.id} aria-label={`${copy.inspectReceipt} ${receipt.id}`} onClick={() => onSelectReceipt(receipt.id)} className="block w-full rounded-md border border-border/55 p-3 text-left hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-foreground">{receipt.id}</span><StatusBadge value={receipt.outcome} /></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{selection?.reason}</p><div className="mt-2 text-[11px] text-muted-foreground">score {selection?.score.toFixed(2)} · {selection?.estimatedTokens} {copy.tokens}</div></button>; })}</div> : <p className="mt-2 text-sm text-muted-foreground">{copy.noLinkedReceipts}</p>}</div>;
}

function ReceiptDetail({ receipt, availableAssetIds, copy, locale, onSelectAsset }: { receipt: RetrievalReceipt; availableAssetIds: ReadonlySet<string>; copy: (typeof COPY)[keyof typeof COPY]; locale: string; onSelectAsset(assetId: string): void }) {
  return <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-mono text-sm font-semibold text-foreground">{receipt.id}</h2><StatusBadge value={receipt.outcome} /></div><p className="mt-2 text-sm leading-relaxed text-foreground">{receipt.queryPreview || '—'}</p>{receipt.error ? <div className="mt-4 rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">{receipt.error}</div> : null}<dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><Detail label={copy.strategy} value={receipt.strategy} /><Detail label={copy.duration} value={`${receipt.durationMs}ms`} /><Detail label={copy.candidates} value={String(receipt.totals.candidateCount)} /><Detail label={copy.budget} value={`${receipt.totals.usedTokens}/${receipt.budget.maxTokens} ${copy.tokens}`} /><Detail label={copy.updated} value={formatDate(receipt.startedAt, locale)} /></dl><h3 className="mt-7 text-sm font-semibold text-foreground">{copy.selections}</h3>{receipt.selections.length ? <div className="mt-2 space-y-2">{receipt.selections.map((selection) => <div key={`${selection.assetId}:${selection.path}`} className="rounded-md border border-border/55 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><Link href={contextAssetViewHref(selection.path)} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{selection.path}</Link><span className="text-xs text-muted-foreground">{selection.score.toFixed(2)}</span></div><p className="mt-1 text-xs text-muted-foreground">{selection.reason}</p>{availableAssetIds.has(selection.assetId) ? <button type="button" aria-label={`${copy.inspectAsset} ${selection.assetId}`} onClick={() => onSelectAsset(selection.assetId)} className="mt-2 text-xs font-medium text-[var(--amber)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{copy.inspectAsset}</button> : null}</div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">—</p>}</div>;
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={cn('mt-1 break-all text-foreground', mono && 'font-mono text-xs')}>{value}</dd></div>; }
function StatusBadge({ value }: { value: string }) { const positive = value === 'active' || value === 'selected'; const negative = value === 'error' || value === 'timeout' || value === 'deprecated'; return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', positive ? 'bg-success/10 text-success' : negative ? 'bg-error/10 text-error' : 'bg-muted text-muted-foreground')}>{value}</span>; }
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground"><span className="mb-3">{icon}</span>{text}</div>; }
function LoadingRows() { return <div aria-label="Loading" className="space-y-3 p-4">{[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-muted/60" />)}</div>; }
function formatDate(value: string, locale: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
