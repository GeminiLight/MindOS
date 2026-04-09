'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, CheckCircle2, AlertCircle, ChevronDown, Clock,
  FileEdit, FilePlus, Loader2, Search, Terminal, Trash2,
} from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { encodePath } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface AuditEvent {
  id: string;
  ts: string;
  tool: string;
  params: Record<string, unknown>;
  result: 'ok' | 'error';
  message?: string;
  durationMs?: number;
}

type InteractionKind = 'read' | 'write' | 'create' | 'delete' | 'search' | 'other';

function classifyTool(tool: string): InteractionKind {
  if (/search/.test(tool)) return 'search';
  if (/read|list|get/.test(tool)) return 'read';
  if (/create|batch_create/.test(tool)) return 'create';
  if (/delete/.test(tool)) return 'delete';
  if (/write|update|insert|append|edit|rename|move/.test(tool)) return 'write';
  return 'other';
}

const INTERACTION_ICON: Record<InteractionKind, { icon: typeof Clock; color: string }> = {
  read: { icon: Clock, color: 'text-blue-400' },
  write: { icon: FileEdit, color: 'text-[var(--amber)]' },
  create: { icon: FilePlus, color: 'text-[var(--success)]' },
  delete: { icon: Trash2, color: 'text-[var(--error)]' },
  search: { icon: Search, color: 'text-purple-400' },
  other: { icon: Terminal, color: 'text-muted-foreground' },
};

function interactionAge(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return `${h}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

const VISIBLE_EVENTS = 5;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeInteractionSection() {
  const { t } = useLocale();
  const d = t.agentsContent?.detail;
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      fetch('/api/agent-activity?limit=50')
        .then(r => r.json())
        .then(data => { if (!cancelled) setEvents(data.events ?? []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    doFetch();
    const onVisible = () => { if (document.visibilityState === 'visible') doFetch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const stats = useMemo(() => {
    if (events.length === 0) return null;
    const reads = events.filter(e => classifyTool(e.tool) === 'read').length;
    const writes = events.filter(e => ['write', 'create', 'delete'].includes(classifyTool(e.tool))).length;
    const errors = events.filter(e => e.result === 'error').length;
    const durations = events.filter(e => typeof e.durationMs === 'number').map(e => e.durationMs!);
    const avgMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const files = new Set<string>();
    for (const e of events) {
      const p = e.params.path;
      if (typeof p === 'string') files.add(p);
    }
    const errorRate = events.length > 0 ? Math.round((errors / events.length) * 100) : 0;
    return { total: events.length, reads, writes, errors, errorRate, avgMs, filesCount: files.size };
  }, [events]);

  const meaningful = useMemo(() => {
    const writeOps = events.filter(e => {
      const k = classifyTool(e.tool);
      return k === 'write' || k === 'create' || k === 'delete';
    });
    return writeOps.length >= 3 ? writeOps : events;
  }, [events]);

  const visible = showAll ? meaningful : meaningful.slice(0, VISIBLE_EVENTS);
  const hiddenCount = meaningful.length - VISIBLE_EVENTS;

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex justify-center py-6">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  if (events.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><BookOpen size={13} className="text-[var(--amber)]" /></div>
          {d?.knowledgeInteraction ?? 'Knowledge Interaction'}
        </h2>
        <div className="rounded-lg border border-border/40 bg-card/30 px-4 py-6 text-center">
          <BookOpen size={20} className="text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-2xs text-muted-foreground/50">{d?.knowledgeNoData ?? 'No interactions yet. Agents will show activity here once they start working with your knowledge base.'}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><BookOpen size={13} className="text-[var(--amber)]" /></div>
          {d?.knowledgeInteraction ?? 'Knowledge Interaction'}
        </h2>
        <Link
          href={`/view/${encodePath('.mindos/agent-audit-log.json')}`}
          className="text-2xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity"
        >
          {d?.viewFullLog ?? 'View log'} →
        </Link>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-px mx-4 mb-3 rounded-lg overflow-hidden border border-border/40">
          <div className="flex-1 px-3 py-2 bg-muted/20">
            <p className="text-2xs text-muted-foreground/50 leading-none mb-1">{d?.statTotalCalls ?? 'Calls'}</p>
            <p className="text-sm font-semibold text-foreground font-mono tabular-nums leading-none">{stats.total}</p>
          </div>
          <div className="flex-1 px-3 py-2 bg-muted/20 border-l border-border/30">
            <p className="text-2xs text-muted-foreground/50 leading-none mb-1">{d?.statFilesTouched ?? 'Files'}</p>
            <p className="text-sm font-semibold text-foreground font-mono tabular-nums leading-none">{stats.filesCount}</p>
          </div>
          <div className="flex-1 px-3 py-2 bg-muted/20 border-l border-border/30">
            <p className="text-2xs text-muted-foreground/50 leading-none mb-1">{d?.statReadWrite ?? 'R / W'}</p>
            <p className="text-sm font-semibold text-foreground font-mono tabular-nums leading-none">
              <span className="text-blue-400">{stats.reads}</span>
              <span className="text-muted-foreground/30 mx-0.5">/</span>
              <span className="text-[var(--amber)]">{stats.writes}</span>
            </p>
          </div>
          <div className="flex-1 px-3 py-2 bg-muted/20 border-l border-border/30">
            <p className="text-2xs text-muted-foreground/50 leading-none mb-1">{d?.statHealth ?? 'Health'}</p>
            <p className="text-sm font-semibold font-mono tabular-nums leading-none">
              {stats.errors > 0 ? (
                <span className="text-[var(--error)]">{stats.errorRate}% err</span>
              ) : (
                <span className="text-[var(--success)]">100%</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="border-t border-border/40">
        <div className="px-4 py-2 flex items-center justify-between">
          <p className="text-2xs text-muted-foreground/40 uppercase tracking-wider">{d?.recentOps ?? 'Recent operations'}</p>
        </div>
        {visible.map((ev, i) => {
          const kind = classifyTool(ev.tool);
          const { icon: Icon, color } = INTERACTION_ICON[kind];
          const filePath = typeof ev.params.path === 'string' ? ev.params.path : null;
          const toolShort = ev.tool.replace(/^mindos_/, '');

          return (
            <div
              key={ev.id ?? i}
              className={`flex items-center gap-3 px-4 py-2 ${i > 0 ? 'border-t border-border/20' : 'border-t border-border/20'} hover:bg-muted/20 transition-colors`}
            >
              <div className="w-5 h-5 rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                <Icon size={11} className={color} />
              </div>
              <span className="text-xs font-medium text-foreground/80 font-mono shrink-0 min-w-[90px]">{toolShort}</span>
              {filePath ? (
                <Link
                  href={`/view/${encodePath(filePath)}`}
                  className="text-xs text-muted-foreground hover:text-[var(--amber)] truncate min-w-0 flex-1 font-mono transition-colors"
                  title={filePath}
                >
                  {filePath}
                </Link>
              ) : (
                <span className="flex-1" />
              )}
              {ev.result === 'ok'
                ? <CheckCircle2 size={10} className="shrink-0 text-[var(--success)]/40" />
                : <AlertCircle size={10} className="shrink-0 text-[var(--error)]/60" />
              }
              <span className="text-2xs text-muted-foreground/30 tabular-nums shrink-0 font-mono w-[28px] text-right" title={ev.ts}>
                {interactionAge(ev.ts)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Show more */}
      {hiddenCount > 0 && (
        <div className="px-4 py-2 border-t border-border/20">
          <button
            onClick={() => setShowAll(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <ChevronDown size={12} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
            <span>{showAll ? (d?.showLess ?? 'Show less') : `${hiddenCount} more`}</span>
          </button>
        </div>
      )}
    </section>
  );
}
