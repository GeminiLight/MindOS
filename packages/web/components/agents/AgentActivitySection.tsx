'use client';

/**
 * AgentActivitySection — Full audit log view for the Agents Activity tab.
 * Fetches data from /api/agent-activity and displays a filterable, expandable timeline.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/lib/stores/locale-store';
import {
  type AgentOp, type OpKind,
  opKind,
  ACTIVITY_FILTER_KINDS,
  AgentActivityEmptyState,
  AgentActivityFilterBar,
  AgentActivityOpCard,
} from './agent-activity-shared';

// ─── Main section ──────────────────────────────────────────────────────────────

export default function AgentActivitySection() {
  const { t, locale } = useLocale();
  const [ops, setOps] = useState<AgentOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OpKind | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      fetch('/api/agent-activity?limit=200')
        .then(r => r.json())
        .then(data => { if (!cancelled) setOps(data.events ?? []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    doFetch();
    const onVisible = () => { if (document.visibilityState === 'visible') doFetch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const filtered = useMemo(() =>
    filter === 'all' ? ops : ops.filter(op => opKind(op.tool) === filter),
    [ops, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: ops.length };
    for (const op of ops) {
      const k = opKind(op.tool);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [ops]);

  const copy = t.agentsContent?.activity;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground/50">
        <div className="animate-pulse text-sm">{copy?.loading ?? 'Loading activity...'}</div>
      </div>
    );
  }

  if (ops.length === 0) {
    return (
      <AgentActivityEmptyState
        title={copy?.empty ?? 'No agent operations logged yet.'}
        hint={copy?.emptyHint ?? 'Operations from connected agents will appear here.'}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6">
      <AgentActivityFilterBar
        kinds={ACTIVITY_FILTER_KINDS}
        counts={counts}
        active={filter}
        onChange={setFilter}
        locale={locale}
        className="mb-5"
      />

      <div className="space-y-2">
        {filtered.map((op, i) => (
          <AgentActivityOpCard
            key={op.id ?? i}
            op={op}
            locale={locale}
            agentLabel={copy?.agentLabel ?? 'Agent'}
          />
        ))}
      </div>
    </div>
  );
}
