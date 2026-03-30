'use client';

import { useState } from 'react';
import { Globe, Trash2, Wifi, WifiOff, Zap } from 'lucide-react';
import { useLocale } from '@/lib/LocaleContext';
import type { RemoteAgent } from '@/lib/a2a/types';
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
