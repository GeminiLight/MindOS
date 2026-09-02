'use client';

import Link from 'next/link';
import {
  AlertCircle,
  Bot,
  Clock3,
  FileText,
  GitBranch,
  RefreshCw,
  ShieldCheck,
  Waypoints,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AgentRunObservatory, AgentRunObservatoryTrace } from '@geminilight/mindos/server';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/lib/stores/locale-store';
import { cn } from '@/lib/utils';
import {
  agentRunStatusLabel,
  agentRunViewHref,
  fetchAgentRunObservatory,
  filterAgentRunTraces,
  type AgentRunObservatoryFilter,
} from '@/lib/agent-run-observatory';

const EMPTY_OBSERVATORY: AgentRunObservatory = {
  schemaVersion: 1,
  generatedAt: new Date(0).toISOString(),
  warnings: [],
  traces: [],
  summary: { totalTraces: 0, agentTraces: 0, automationTraces: 0, active: 0, waitingApproval: 0, completed: 0, failed: 0 },
};

const COPY = {
  en: {
    title: 'Run Observatory', subtitle: 'Follow each agent or automation from context to approval and artifact.',
    traces: 'traces', active: 'active', waiting: 'waiting', issues: 'issues', completed: 'completed', all: 'All',
    failed: 'Could not load run observability data.', retry: 'Try again', empty: 'No agent or automation runs yet.',
    emptyFilter: 'No runs match this filter.', summaryOnly: 'Summary only', live: 'Live timeline',
    agent: 'Agent', automation: 'Automation', runtime: 'Runtime', model: 'Model', thinking: 'Thinking', permission: 'Permission',
    duration: 'Duration', started: 'Started', runTree: 'Run tree', timeline: 'Timeline', approvals: 'Approvals',
    context: 'Context', artifacts: 'Artifacts', sessions: 'Sessions', input: 'Input', output: 'Output', noDetail: 'Select a run to inspect it.',
  },
  zh: {
    title: '运行观测台', subtitle: '从上下文、审批到产物，追踪每一次 Agent 与 Automation 运行。',
    traces: '次运行', active: '进行中', waiting: '待审批', issues: '异常', completed: '已完成', all: '全部',
    failed: '无法加载运行观测数据。', retry: '重试', empty: '还没有 Agent 或 Automation 运行。',
    emptyFilter: '没有符合筛选条件的运行。', summaryOnly: '仅摘要', live: '实时事件',
    agent: 'Agent', automation: 'Automation', runtime: '运行时', model: '模型', thinking: '思考', permission: '权限',
    duration: '耗时', started: '开始时间', runTree: '运行树', timeline: '事件流', approvals: '审批',
    context: '上下文', artifacts: '产物', sessions: '会话', input: '输入', output: '输出', noDetail: '请选择一条运行查看详情。',
  },
} as const;

export default function AgentActivitySection() {
  const { locale } = useLocale();
  const copy = locale === 'zh' ? COPY.zh : COPY.en;
  const [observatory, setObservatory] = useState<AgentRunObservatory>(EMPTY_OBSERVATORY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<AgentRunObservatoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetchAgentRunObservatory(controller.signal).then((payload) => {
      setObservatory(payload);
      setSelectedId((current) => current && payload.traces.some((trace) => trace.id === current) ? current : payload.traces[0]?.id);
    }).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(true);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [reload]);

  const visible = useMemo(() => filterAgentRunTraces(observatory.traces, filter), [filter, observatory.traces]);
  const selected = visible.find((trace) => trace.id === selectedId) ?? visible[0];
  const filters: Array<{ id: AgentRunObservatoryFilter; label: string; count: number }> = [
    { id: 'all', label: copy.all, count: observatory.summary.totalTraces },
    { id: 'active', label: copy.active, count: observatory.summary.active },
    { id: 'waiting', label: copy.waiting, count: observatory.summary.waitingApproval },
    { id: 'issues', label: copy.issues, count: observatory.summary.failed },
    { id: 'completed', label: copy.completed, count: observatory.summary.completed },
  ];

  return (
    <section data-agent-run-observatory className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5">
      <header className="border-b border-border/60 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[var(--amber)]"><Waypoints size={16} aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-[0.12em]">Observability</span></div>
            <h2 className="mt-2 text-xl font-semibold text-foreground">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
          </div>
          {!loading && !error ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Metric value={observatory.summary.totalTraces} label={copy.traces} />
              <Metric value={observatory.summary.active} label={copy.active} />
              <Metric value={observatory.summary.waitingApproval} label={copy.waiting} tone={observatory.summary.waitingApproval ? 'warning' : undefined} />
              <Metric value={observatory.summary.failed} label={copy.issues} tone={observatory.summary.failed ? 'error' : undefined} />
            </div>
          ) : null}
        </div>
      </header>

      {observatory.warnings?.length ? (
        <div role="status" className="rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] px-4 py-3 text-xs text-[var(--amber-text)]">
          {observatory.warnings.join(' ')}
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-border/60 bg-muted/20 p-8 text-center">
          <AlertCircle size={22} className="text-error" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">{copy.failed}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setReload((value) => value + 1)}>
            <RefreshCw size={14} aria-hidden="true" />{copy.retry}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Run filters">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Filter runs by ${item.id}`}
                aria-pressed={filter === item.id}
                onClick={() => { setFilter(item.id); setSelectedId(undefined); }}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filter === item.id ? 'border-[var(--amber)]/35 bg-[var(--amber-subtle)] text-[var(--amber-text)]' : 'border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                {item.label} <span className="ml-1 opacity-60">{item.count}</span>
              </button>
            ))}
          </div>

          <div className="grid min-h-[32rem] gap-4 lg:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.42fr)]">
            <div className="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-background/35">
              {loading ? <LoadingRows /> : visible.length ? visible.map((trace) => (
                <TraceRow key={trace.id} trace={trace} selected={trace.id === selected?.id} onClick={() => setSelectedId(trace.id)} locale={locale} />
              )) : (
                <EmptyState text={observatory.traces.length ? copy.emptyFilter : copy.empty} />
              )}
            </div>
            <div className="min-w-0 rounded-lg border border-border/60 bg-background/35 p-5">
              {!loading && selected ? <TraceDetail trace={selected} copy={copy} locale={locale} /> : !loading ? <EmptyState text={copy.noDetail} /> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function TraceRow({ trace, selected, onClick, locale }: { trace: AgentRunObservatoryTrace; selected: boolean; onClick(): void; locale: string }) {
  return (
    <button
      type="button"
      aria-label={`Inspect run ${trace.title}`}
      onClick={onClick}
      className={cn('block w-full border-b border-border/45 px-4 py-3.5 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected ? 'bg-[var(--amber-subtle)]' : 'hover:bg-muted/25')}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {trace.source === 'automation' ? <Workflow size={14} className="shrink-0 text-[var(--amber)]" aria-hidden="true" /> : <GitBranch size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="truncate text-sm font-medium text-foreground">{trace.title}</span>
        </div>
        <StatusBadge status={trace.status} locale={locale} />
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{trace.inputSummary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span>{trace.source === 'automation' ? 'Automation' : `${trace.counts.nodes} ${trace.counts.nodes === 1 ? 'node' : 'nodes'}`}</span>
        <span aria-hidden="true">·</span><span>{trace.runtimeIds.join(', ')}</span>
        <span aria-hidden="true">·</span><span>{formatDate(trace.startedAt, locale)}</span>
      </div>
    </button>
  );
}

function TraceDetail({ trace, copy, locale }: { trace: AgentRunObservatoryTrace; copy: (typeof COPY)[keyof typeof COPY]; locale: string }) {
  return (
    <div className="space-y-7">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold text-foreground">{trace.title}</h3><StatusBadge status={trace.status} locale={locale} /></div><p className="mt-1 font-mono text-[11px] text-muted-foreground">{trace.id}</p></div>
          <span className="rounded-full border border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground">{trace.coverage === 'live' ? copy.live : copy.summaryOnly}</span>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-foreground">{trace.inputSummary}</p>
        {trace.error ? <div role="alert" className="mt-4 rounded-md border border-error/30 bg-error/5 p-3 text-sm text-error">{trace.error}</div> : null}
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <Detail label={copy.runtime} value={trace.runtimeIds.join(', ')} />
          {trace.model ? <Detail label={copy.model} value={trace.model} /> : null}
          {trace.thinkingEffort ? <Detail label={copy.thinking} value={trace.thinkingEffort} /> : null}
          <Detail label={copy.permission} value={trace.permissionMode} />
          <Detail label={copy.duration} value={formatDuration(trace.durationMs)} />
          <Detail label={copy.started} value={formatDate(trace.startedAt, locale)} />
        </dl>
      </div>

      <Section title={copy.runTree} icon={<Bot size={14} aria-hidden="true" />}>
        <div className="space-y-2">{trace.nodes.map((node) => (
          <div key={node.id} className={cn('rounded-md border border-border/55 p-3', node.parentRunId && 'ml-5')}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-foreground">{node.displayName}</span><span className="text-xs text-muted-foreground">{agentRunStatusLabel(node.status, locale)}</span></div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{node.runtimeId} · {node.agentKind}</div>
            {node.error ? <p className="mt-2 text-xs text-error">{node.error}</p> : null}
          </div>
        ))}</div>
      </Section>

      {trace.approvals.length ? <Section title={copy.approvals} icon={<ShieldCheck size={14} aria-hidden="true" />}>
        <div className="space-y-2">{trace.approvals.map((approval) => (
          <div key={approval.id} className="rounded-md border border-[var(--amber)]/25 bg-[var(--amber-subtle)] p-3">
            <div className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-semibold text-foreground">{approval.toolName}</span><StatusBadge status={approval.status === 'pending' ? 'waiting_approval' : approval.status === 'denied' ? 'failed' : 'completed'} locale={locale} /></div>
            {approval.resource ? <p className="mt-2 break-all text-xs text-muted-foreground">{approval.resource}</p> : null}
            {approval.risk?.summary ? <p className="mt-2 text-xs text-[var(--amber-text)]">{approval.risk.summary}</p> : null}
            {approval.delivery ? <p className="mt-2 text-[11px] text-muted-foreground">Feishu · {approval.delivery.status}</p> : null}
          </div>
        ))}</div>
      </Section> : null}

      {trace.events.length ? <Section title={copy.timeline} icon={<Clock3 size={14} aria-hidden="true" />}>
        <ol className="space-y-2">{trace.events.map((event) => (
          <li key={event.id} className="flex gap-3 text-xs"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--amber)]" /><div className="min-w-0"><div className="font-medium text-foreground">{event.title || event.toolName || event.category}</div><div className="mt-0.5 break-words text-muted-foreground">{event.message || eventDataSummary(event.data)}</div></div></li>
        ))}</ol>
      </Section> : null}

      {trace.receipts.length || trace.contextAssets.length ? <Section title={copy.context} icon={<Waypoints size={14} aria-hidden="true" />}>
        <div className="space-y-2">
          {trace.receipts.map((receipt) => <div key={receipt.id} className="rounded-md border border-border/55 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-foreground">{receipt.id}</span><span className="text-xs text-muted-foreground">{receipt.outcome} · {receipt.durationMs}ms</span></div><p className="mt-1 text-xs text-muted-foreground">{receipt.queryPreview}</p></div>)}
          {trace.contextAssets.map((asset) => <Link key={asset.id} href={agentRunViewHref(asset.path)} className="flex items-center justify-between gap-3 rounded-md border border-border/55 p-3 text-sm text-foreground hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="min-w-0 truncate">{asset.title}</span><span className="shrink-0 text-xs text-muted-foreground">{asset.kind}</span></Link>)}
        </div>
      </Section> : null}

      {trace.artifacts.length || trace.contextAssets.some((asset) => asset.kind === 'automation-run') ? <Section title={copy.artifacts} icon={<FileText size={14} aria-hidden="true" />}>
        <div className="space-y-2">
          {trace.artifacts.map((artifact) => artifact.path ? <Link key={artifact.id} href={agentRunViewHref(artifact.path)} className="block rounded-md border border-border/55 p-3 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="text-sm font-medium text-foreground">{artifact.title || artifact.path}</div><div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{artifact.path}</div></Link> : null)}
          {trace.contextAssets.filter((asset) => asset.kind === 'automation-run').map((asset) => <Link key={asset.id} href={agentRunViewHref(asset.path)} className="block rounded-md border border-border/55 p-3 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="text-sm font-medium text-foreground">{asset.title}</div><div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{asset.path}</div></Link>)}
        </div>
      </Section> : null}

      {trace.sessions.length ? <Section title={copy.sessions} icon={<GitBranch size={14} aria-hidden="true" />}>
        <div className="space-y-2">{trace.sessions.map((session) => <div key={`${session.runtimeId}:${session.sessionId}`} className="rounded-md border border-border/55 p-3"><div className="text-xs text-muted-foreground">{session.runtimeId}</div><div className="mt-1 break-all font-mono text-xs text-foreground">{session.sessionId}</div></div>)}</div>
      </Section> : null}

      {trace.outputSummary ? <Section title={copy.output} icon={<FileText size={14} aria-hidden="true" />}><p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{trace.outputSummary}</p></Section> : null}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section><h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</h4>{children}</section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all text-foreground">{value}</dd></div>;
}

function Metric({ value, label, tone }: { value: number; label: string; tone?: 'warning' | 'error' }) {
  return <span className={cn('rounded-md border border-border/60 px-2.5 py-1', tone === 'warning' && 'border-[var(--amber)]/30 text-[var(--amber-text)]', tone === 'error' && 'border-error/30 text-error')}><strong className="text-foreground">{value}</strong> {label}</span>;
}

function StatusBadge({ status, locale }: { status: AgentRunObservatoryTrace['status']; locale: string }) {
  const label = agentRunStatusLabel(status, locale);
  const active = status === 'queued' || status === 'running' || status === 'streaming' || status === 'waiting_approval';
  const failed = status === 'failed' || status === 'timed_out' || status === 'interrupted' || status === 'canceled';
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', active ? 'bg-[var(--amber-subtle)] text-[var(--amber-text)]' : failed ? 'bg-error/10 text-error' : 'bg-success/10 text-success')}>{label}</span>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-48 flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground"><Waypoints size={24} className="mb-3 opacity-35" aria-hidden="true" />{text}</div>;
}

function LoadingRows() {
  return <div aria-label="Loading runs" className="space-y-3 p-4">{[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-md bg-muted/60" />)}</div>;
}

function eventDataSummary(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  for (const key of ['summary', 'outputSummary', 'error', 'prompt', 'text', 'path', 'nextStatus']) {
    if (typeof record[key] === 'string' && record[key]) return String(record[key]);
  }
  return '';
}

function formatDuration(value?: number): string {
  if (value === undefined) return '—';
  if (value < 1_000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1_000)}s`;
}

function formatDate(value: number, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
