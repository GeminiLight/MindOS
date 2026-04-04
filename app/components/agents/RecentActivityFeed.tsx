'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { encodePath } from '@/lib/utils';
import { useLocale } from '@/lib/LocaleContext';
import {
  type AgentOp,
  opKind, KIND_COLOR, OpIcon, relativeTs, getFilePath,
} from './agent-activity-shared';

const VISIBLE_OPS = 5;

export default function RecentActivityFeed() {
  const { t } = useLocale();
  const [ops, setOps] = useState<AgentOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agent-activity?limit=20')
      .then(r => r.json())
      .then(data => { if (!cancelled) setOps(data.events ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Filter out read-only noise, show writes/creates/deletes first
  const meaningful = useMemo(() => {
    const writes = ops.filter(op => {
      const k = opKind(op.tool);
      return k === 'write' || k === 'create' || k === 'delete';
    });
    return writes.length >= 3 ? writes : ops;
  }, [ops]);

  const visible = showAll ? meaningful : meaningful.slice(0, VISIBLE_OPS);
  const hiddenCount = meaningful.length - VISIBLE_OPS;

  if (loading || ops.length === 0) return null;

  const copy = t.agentsContent?.overview;

  return (
    <section aria-label="Recent Activity">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-foreground">
          {copy?.recentActivity ?? 'Recent Activity'}
        </h2>
        <Link
          href="/agents?tab=activity"
          className="text-2xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity font-display"
        >
          {copy?.viewAll ?? 'View all'} →
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {visible.map((op, i) => {
          const kind = opKind(op.tool);
          const filePath = getFilePath(op.params);
          const toolShort = op.tool.replace(/^mindos_/, '');

          return (
            <div
              key={op.id ?? i}
              className={`flex items-center gap-3 px-3.5 py-2.5 ${
                i > 0 ? 'border-t border-border/30' : ''
              } hover:bg-muted/30 transition-colors`}
            >
              <OpIcon kind={kind} size={12} />

              <span className="text-xs font-medium text-foreground font-display shrink-0">
                {toolShort}
              </span>

              {filePath ? (
                <Link
                  href={`/view/${encodePath(filePath)}`}
                  className="text-xs text-[var(--amber)]/80 hover:text-[var(--amber)] truncate min-w-0 flex-1 font-display transition-colors"
                  title={filePath}
                >
                  {filePath}
                </Link>
              ) : (
                <span className="flex-1" />
              )}

              {/* agent name badge */}
              {op.agentName && (
                <span className="text-[0.6rem] font-medium text-muted-foreground/70 bg-muted/60 px-1.5 py-0.5 rounded-full shrink-0 font-display" title={op.agentName}>
                  {op.agentName.length > 20 ? op.agentName.slice(0, 20) + '...' : op.agentName}
                </span>
              )}

              {op.result === 'ok'
                ? <CheckCircle2 size={11} className="shrink-0 text-[var(--success)]/60" />
                : <AlertCircle size={11} className="shrink-0 text-[var(--error)]/60" />
              }

              <span className="text-2xs text-muted-foreground/40 tabular-nums shrink-0 font-display" title={op.ts}>
                {relativeTs(op.ts)}
              </span>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[var(--amber)] hover:opacity-80 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          <ChevronDown size={12} className={`transition-transform duration-200 ${showAll ? 'rotate-180' : ''}`} />
          <span>{showAll ? (copy?.showLess ?? 'Show less') : `${hiddenCount} more`}</span>
        </button>
      )}
    </section>
  );
}
