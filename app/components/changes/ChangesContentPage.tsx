'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, History, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { collapseDiffContext, buildLineDiff } from './line-diff';

interface ChangeEvent {
  id: string;
  ts: string;
  op: string;
  path: string;
  source: 'user' | 'agent' | 'system';
  summary: string;
  before?: string;
  after?: string;
  beforePath?: string;
  afterPath?: string;
}

interface SummaryPayload {
  unreadCount: number;
  totalCount: number;
}

interface ListPayload {
  events: ChangeEvent[];
}

function relativeTime(ts: string): string {
  const delta = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ChangesContentPage({ initialPath = '' }: { initialPath?: string }) {
  const [pathFilter, setPathFilter] = useState(initialPath);
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [summary, setSummary] = useState<SummaryPayload>({ unreadCount: 0, totalCount: 0 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listUrl = pathFilter
        ? `/api/changes?op=list&limit=80&path=${encodeURIComponent(pathFilter)}`
        : '/api/changes?op=list&limit=80';
      const [list, summaryData] = await Promise.all([
        apiFetch<ListPayload>(listUrl),
        apiFetch<SummaryPayload>('/api/changes?op=summary'),
      ]);
      setEvents(list.events);
      setSummary(summaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load changes');
    } finally {
      setLoading(false);
    }
  }, [pathFilter]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const markSeen = useCallback(async () => {
    await apiFetch('/api/changes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'mark_seen' }),
    });
    await fetchData();
  }, [fetchData]);

  const eventCountLabel = useMemo(() => `${events.length} event${events.length === 1 ? '' : 's'}`, [events.length]);

  return (
    <div className="min-h-screen">
      <div className="sticky top-[52px] md:top-0 z-20 border-b border-border px-4 md:px-6 py-2.5 bg-background">
        <div className="content-width xl:mr-[220px] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground font-display">
              <History size={15} />
              Content changes
            </div>
            <div className="text-xs text-muted-foreground mt-1">{eventCountLabel} · {summary.unreadCount} unread</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchData()}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="inline-flex items-center gap-1"><RefreshCw size={12} /> Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => void markSeen()}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--amber)] text-[var(--amber-foreground)] focus-visible:ring-2 focus-visible:ring-ring"
            >
              Mark seen
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-6 md:py-8">
        <div className="content-width xl:mr-[220px] space-y-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <label className="text-xs text-muted-foreground">Filter by file path</label>
            <input
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder="e.g. Projects/plan.md"
              className="mt-1 w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading changes...</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          {!loading && !error && events.length === 0 && (
            <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              No content changes yet.
            </div>
          )}

          {!loading && !error && events.map((event) => {
            const open = !!expanded[event.id];
            const rows = collapseDiffContext(buildLineDiff(event.before ?? '', event.after ?? ''));
            return (
              <div key={event.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [event.id]: !prev[event.id] }))}
                  className="w-full px-3 py-2.5 text-left hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start gap-2">
                    <span className="pt-0.5 text-muted-foreground">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground font-display">{event.summary}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {event.path} · {event.op} · {event.source} · {relativeTime(event.ts)}
                      </div>
                    </div>
                    <Link
                      href={`/view/${event.path.split('/').map(encodeURIComponent).join('/')}`}
                      className="text-xs text-[var(--amber)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open
                    </Link>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border bg-background">
                    {rows.map((row, idx) => {
                      if (row.type === 'gap') {
                        return <div key={`${event.id}-gap-${idx}`} className="px-3 py-1 text-2xs text-muted-foreground">... {row.count} unchanged lines ...</div>;
                      }
                      const prefix = row.type === 'insert' ? '+' : row.type === 'delete' ? '-' : ' ';
                      const color = row.type === 'insert'
                        ? 'var(--success)'
                        : row.type === 'delete'
                          ? 'var(--error)'
                          : 'var(--muted-foreground)';
                      return (
                        <div key={`${event.id}-${idx}`} className="px-3 py-0.5 text-xs font-mono flex items-start gap-2">
                          <span style={{ color }} className="select-none w-3">{prefix}</span>
                          <span style={{ color }} className="whitespace-pre-wrap break-all flex-1">{row.text || ' '}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
