'use client';

import { useState, useCallback } from 'react';
import { Check, ChevronDown, ChevronUp, Clock, Code2, Globe, Loader2, MessageSquare, Network, RefreshCw, RotateCcw, Save, Settings2, Trash2, Wifi, WifiOff, Wrench, Zap } from 'lucide-react';
import { useLocale } from '@/lib/stores/locale-store';
import { useAcpConfig } from '@/hooks/useAcpConfig';
import type { RemoteAgent, DelegationRecord } from '@/lib/a2a/types';
import type { AcpRegistryEntry } from '@/lib/acp/types';
import { useDelegationHistory } from '@/hooks/useDelegationHistory';
import { useAcpRegistry } from '@/hooks/useAcpRegistry';
import { useAcpDetection } from '@/hooks/useAcpDetection';
import { openAskModal } from '@/hooks/useAskModal';
import DiscoverAgentModal from './DiscoverAgentModal';

/* ────────── Props ────────── */

interface AgentsPanelA2aTabProps {
  agents: RemoteAgent[];
  discovering: boolean;
  error: string | null;
  onDiscover: (url: string) => Promise<RemoteAgent | null>;
  onRemove: (id: string) => void;
}

/* ────────── Main Component ────────── */

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
  const acp = useAcpRegistry();

  const isEmpty = agents.length === 0 && !acp.loading && acp.agents.length === 0;

  return (
    <div className="space-y-6">
      {/* Header + Discover button — [V-1] clear section title hierarchy */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]">
            <Globe size={13} />
          </div>
          {p.a2aTabTitle}
        </h2>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Globe size={12} />
          {p.a2aDiscover}
        </button>
      </div>

      {/* Unified empty state — [P-1] better first-time UX */}
      {isEmpty ? (
        <NetworkEmptyState
          onDiscover={() => setShowModal(true)}
          onBrowseRegistry={acp.retry}
        />
      ) : (
        <>
          {/* Remote A2A agent list — [A-3] semantic list */}
          {agents.length === 0 ? (
            <div className="rounded-lg border border-border/40 bg-card/30 p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-muted/40 flex items-center justify-center mx-auto mb-3">
                <Globe size={20} className="text-muted-foreground/50" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium text-muted-foreground mb-1">{p.a2aTabEmpty}</p>
              <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-xs mx-auto">
                {p.a2aTabEmptyHint}
              </p>
            </div>
          ) : (
            <ul role="list" className="space-y-2">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <RemoteAgentRow agent={agent} onRemove={onRemove} removeCopy={p.a2aRemoveAgent} skillsCopy={p.a2aSkills} />
                </li>
              ))}
            </ul>
          )}

          {/* ACP Registry section */}
          <AcpRegistrySection />

          {/* Recent Delegations */}
          <DelegationHistorySection delegations={delegations} />
        </>
      )}

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

/* ────────── Network Empty State — [P-1] enhanced first-time UX ────────── */

function NetworkEmptyState({
  onDiscover,
  onBrowseRegistry,
}: {
  onDiscover: () => void;
  onBrowseRegistry: () => void;
}) {
  const { t } = useLocale();
  const p = t.panels.agents;

  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-10 text-center">
      <div className="w-14 h-14 rounded-xl bg-muted/40 flex items-center justify-center mx-auto mb-4">
        <Network size={22} className="text-muted-foreground/50" aria-hidden="true" />
      </div>
      <p className="text-base font-semibold text-foreground mb-1">{p.networkEmptyTitle}</p>
      <p className="text-xs text-muted-foreground/60 leading-relaxed max-w-sm mx-auto mb-6">
        {p.networkEmptyDesc}
      </p>
      {/* [S-1] gap-3 (12px) instead of gap-2.5 (10px) */}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onDiscover}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Globe size={12} />
          {p.networkDiscoverBtn}
        </button>
        <button
          type="button"
          onClick={onBrowseRegistry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Network size={12} />
          {p.networkBrowseBtn}
        </button>
      </div>
    </div>
  );
}

/* ────────── Quick Actions ────────── */

import AcpRegistrySection from './AcpRegistrySection';

function DelegationHistorySection({ delegations }: { delegations: DelegationRecord[] }) {
  const { t } = useLocale();
  const p = t.panels.agents;

  return (
    <section className="space-y-2" aria-labelledby="delegation-section-title">
      <h3 id="delegation-section-title" className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--amber-subtle)] text-[var(--amber)]"><Clock size={13} /></div>
        {p.a2aDelegations}
      </h3>
      {delegations.length === 0 ? (
        <p className="text-xs text-muted-foreground/50 py-3">{p.a2aDelegationsEmpty}</p>
      ) : (
        <ul role="list" className="space-y-1.5">
          {delegations.map((d) => (
            <li key={d.id}>
              <DelegationRow record={d} />
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <div className="rounded-lg border border-border/40 bg-card/60 px-3 py-2.5 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{record.agentName}</p>
        <p className="text-2xs text-muted-foreground/50 truncate" title={record.message}>
          {record.message.length > 60 ? record.message.slice(0, 60) + '...' : record.message}
        </p>
      </div>
      <span className={`text-2xs px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_STYLES[record.status]}`}>
        {statusLabels[record.status]}
      </span>
      {duration && (
        <span className="text-2xs text-muted-foreground/40 shrink-0 flex items-center gap-0.5">
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
    <div className="group rounded-lg border border-border bg-card p-4 hover:border-[var(--amber)]/30 transition-colors duration-150">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
          <Globe size={14} className="text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          {/* [V-1] agent name stronger */}
          <p className="text-base font-semibold text-foreground truncate leading-tight">{agent.card.name}</p>
          <p className="text-2xs text-muted-foreground/50 truncate mt-0.5">{agent.card.description}</p>
        </div>
        <StatusIcon size={13} className={statusColor} aria-hidden="true" />
        {/* [P-4] Delete button — visible on hover, accessible via keyboard */}
        <button
          type="button"
          onClick={() => onRemove(agent.id)}
          className="p-1.5 rounded-md text-muted-foreground/50 hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition-colors duration-150 opacity-0 group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100"
          aria-label={removeCopy}
          title={removeCopy}
        >
          <Trash2 size={12} />
        </button>
      </div>
      {agent.card.skills.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-border/30 flex items-center gap-1.5">
          <Zap size={11} className="text-muted-foreground/40 shrink-0" aria-hidden="true" />
          <span className="text-2xs text-muted-foreground/60">{skillsCopy}: {agent.card.skills.length}</span>
          <div className="flex flex-wrap gap-1 ml-1">
            {agent.card.skills.slice(0, 3).map((s) => (
              <span
                key={s.id}
                className="text-2xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/30"
                title={s.description}
              >
                {s.name}
              </span>
            ))}
            {agent.card.skills.length > 3 && (
              <span className="text-2xs text-muted-foreground/40">+{agent.card.skills.length - 3}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
