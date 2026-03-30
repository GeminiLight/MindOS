'use client';

import { useState } from 'react';
import { Clock, Globe, Trash2, Wifi, WifiOff, Zap } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { RemoteAgent, DelegationRecord } from '@/lib/a2a/types';
import { useDelegationHistory } from '@/hooks/useDelegationHistory';
import DiscoverAgentModal from './DiscoverAgentModal';

interface AgentsPanelA2aTabProps {
  agents: RemoteAgent[];
  discovering: boolean;
  error: string | null;
  onDiscover: (url: string) => Promise<RemoteAgent | null>;
  onRemove: (id: string) => void;
}

export default function AgentsPanelA2aTab({
  agents,
  discovering,
  error,
  onDiscover,
  onRemove,
}: AgentsPanelA2aTabProps) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const [showModal, setShowModal] = useState(false);
  const { delegations } = useDelegationHistory(true);

  return (
    <div className="space-y-5">
      {/* Header + Discover button */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">{p.a2aTabTitle}</h2>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Globe size={12} />
          {p.a2aDiscover}
        </button>
      </div>

      {/* Agent list or empty state */}
      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-gradient-to-b from-card/80 to-card/40 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto mb-4">
            <Globe size={22} className="text-muted-foreground/50" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">{p.a2aTabEmpty}</p>
          <p className="text-xs text-muted-foreground/70 leading-relaxed max-w-xs mx-auto">
            {p.a2aTabEmptyHint}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <RemoteAgentRow key={agent.id} agent={agent} onRemove={onRemove} removeCopy={p.a2aRemoveAgent} skillsCopy={p.a2aSkills} />
          ))}
        </div>
      )}

      {/* Recent Delegations */}
      <DelegationHistorySection delegations={delegations} />

      <DiscoverAgentModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onDiscover={onDiscover}
        discovering={discovering}
        error={error}
      />
    </div>
  );
}

/* ────────── Delegation History Section ────────── */

function DelegationHistorySection({ delegations }: { delegations: DelegationRecord[] }) {
  const { t } = useLocale();
  const p = t.panels.agents;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {p.a2aDelegations}
      </h3>
      {delegations.length === 0 ? (
        <p className="text-xs text-muted-foreground/70 py-3">{p.a2aDelegationsEmpty}</p>
      ) : (
        <div className="space-y-1.5">
          {delegations.map((d) => (
            <DelegationRow key={d.id} record={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────── Delegation Row ────────── */

const STATUS_STYLES: Record<DelegationRecord['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  completed: 'bg-[var(--success)]/15 text-[var(--success)]',
  failed: 'bg-[var(--error)]/15 text-[var(--error)]',
};

function DelegationRow({ record }: { record: DelegationRecord }) {
  const { t } = useLocale();
  const p = t.panels.agents;
  const statusLabels: Record<DelegationRecord['status'], string> = {
    pending: p.a2aDelegationPending,
    completed: p.a2aDelegationCompleted,
    failed: p.a2aDelegationFailed,
  };

  const duration = record.completedAt
    ? formatDuration(new Date(record.startedAt), new Date(record.completedAt))
    : null;

  return (
    <div className="rounded-lg border border-border/60 bg-card/80 px-3 py-2.5 flex items-center gap-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{record.agentName}</p>
        <p className="text-2xs text-muted-foreground truncate" title={record.message}>
          {record.message.length > 60 ? record.message.slice(0, 60) + '...' : record.message}
        </p>
      </div>
      <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_STYLES[record.status]}`}>
        {statusLabels[record.status]}
      </span>
      {duration && (
        <span className="text-2xs text-muted-foreground/60 shrink-0 flex items-center gap-0.5">
          <Clock size={10} aria-hidden="true" />
          {duration}
        </span>
      )}
    </div>
  );
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

/* ────────── Remote Agent Row ────────── */

function RemoteAgentRow({
  agent,
  onRemove,
  removeCopy,
  skillsCopy,
}: {
  agent: RemoteAgent;
  onRemove: (id: string) => void;
  removeCopy: string;
  skillsCopy: string;
}) {
  const StatusIcon = agent.reachable ? Wifi : WifiOff;
  const statusColor = agent.reachable
    ? 'text-[var(--success)]'
    : 'text-muted-foreground/50';

  return (
    <div className="group rounded-xl border border-border bg-card p-3.5 hover:border-[var(--amber)]/30 transition-all duration-150">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
          <Globe size={14} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{agent.card.name}</p>
          <p className="text-2xs text-muted-foreground truncate">{agent.card.description}</p>
        </div>
        <StatusIcon size={13} className={statusColor} aria-hidden="true" />
        <button
          type="button"
          onClick={() => onRemove(agent.id)}
          className="p-1.5 rounded-md text-muted-foreground/50 hover:text-error hover:bg-error/10 transition-colors opacity-0 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
          aria-label={removeCopy}
          title={removeCopy}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {agent.card.skills.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center gap-1.5">
          <Zap size={11} className="text-muted-foreground/60 shrink-0" aria-hidden="true" />
          <span className="text-2xs text-muted-foreground">{skillsCopy}: {agent.card.skills.length}</span>
          <div className="flex flex-wrap gap-1 ml-1">
            {agent.card.skills.slice(0, 3).map((s) => (
              <span
                key={s.id}
                className="text-2xs px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground border border-border/50"
                title={s.description}
              >
                {s.name}
              </span>
            ))}
            {agent.card.skills.length > 3 && (
              <span className="text-2xs text-muted-foreground/60">+{agent.card.skills.length - 3}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
