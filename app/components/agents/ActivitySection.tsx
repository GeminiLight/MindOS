'use client';

import { Activity } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import type { AgentInfo } from '../settings/types';
import { StatCard, formatRelativeTime } from './agent-detail-primitives';

export default function ActivitySection({ agent }: { agent: AgentInfo }) {
  const { t } = useLocale();
  const d = t.agentsContent.detail;

  const hasActivity = !!agent.runtimeLastActivityAt;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-xs font-semibold text-foreground flex items-center gap-2 shrink-0">
        <div className="w-6 h-6 rounded-md bg-[var(--amber-subtle)] flex items-center justify-center"><Activity size={13} className="text-[var(--amber)]" /></div>
        {d.activityTitle}
      </h2>

      {hasActivity ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label={d.activityLastInvocation} value={formatRelativeTime(agent.runtimeLastActivityAt)} />
          <StatCard label={d.activityTotal} value={agent.runtimeConversationSignal ? 'Active' : '—'} />
          <StatCard label={d.activityLast7d} value={agent.runtimeUsageSignal ? 'Active' : '—'} />
        </div>
      ) : (
        <div className="rounded-lg border border-border/40 bg-card/30 px-4 py-6 text-center">
          <Activity size={20} className="text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-2xs text-muted-foreground/50">{d.activityNoData}</p>
        </div>
      )}
    </section>
  );
}
