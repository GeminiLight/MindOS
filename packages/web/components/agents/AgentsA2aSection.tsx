'use client';

import { useState } from 'react';
import { Globe, Loader2, Network, Trash2, Wifi, WifiOff, Zap } from 'lucide-react';
import type { RemoteAgent } from '@/lib/a2a/types';
import { useLocale } from '@/lib/stores/locale-store';
import { AgentSectionHeading } from './AgentsPrimitives';
import DiscoverAgentModal from './DiscoverAgentModal';

interface AgentsA2aSectionProps {
  agents: RemoteAgent[];
  discovering: boolean;
  error: string | null;
  onDiscover: (url: string) => Promise<RemoteAgent | null>;
  onRemove: (id: string) => void;
}

export default function AgentsA2aSection({
  agents,
  discovering,
  error,
  onDiscover,
  onRemove,
}: AgentsA2aSectionProps) {
  const { t } = useLocale();
  const copy = t.agentsContent.a2aAgents;
  const panelCopy = t.panels.agents;
  const [showModal, setShowModal] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <AgentSectionHeading
          icon={<Globe size={14} aria-hidden="true" />}
          title={copy.title}
          descriptionTooltip={copy.description}
        />
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={discovering}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {discovering ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Globe size={13} aria-hidden="true" />}
          {panelCopy.a2aDiscover}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/35">
        {error ? (
          <div className="border-b border-border/50 bg-[var(--error)]/5 px-4 py-2 text-xs text-[var(--error)]">
            {error}
          </div>
        ) : null}
        {agents.length === 0 ? (
          <div className="p-3">
            <div className="flex min-h-[88px] items-center justify-center gap-4 rounded-lg border border-border/45 bg-background/45 px-4 py-5 text-center">
              <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground sm:flex">
                <Network size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{panelCopy.a2aTabEmpty}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {panelCopy.a2aTabEmptyHint}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 p-3 md:grid-cols-2">
            {agents.map((agent) => (
              <RemoteA2aCard
                key={agent.id}
                agent={agent}
                onRemove={onRemove}
                removeLabel={panelCopy.a2aRemoveAgent}
                skillsLabel={panelCopy.a2aSkills}
              />
            ))}
          </div>
        )}
      </div>

      <DiscoverAgentModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onDiscover={onDiscover}
        discovering={discovering}
        error={error}
      />
    </section>
  );
}

function RemoteA2aCard({
  agent,
  onRemove,
  removeLabel,
  skillsLabel,
}: {
  agent: RemoteAgent;
  onRemove: (id: string) => void;
  removeLabel: string;
  skillsLabel: string;
}) {
  const StatusIcon = agent.reachable ? Wifi : WifiOff;
  const statusClassName = agent.reachable ? 'text-[var(--success)]' : 'text-muted-foreground/55';

  return (
    <article className="group flex min-h-[116px] flex-col rounded-lg border border-border/55 bg-background/55 p-3 transition-colors hover:border-border hover:bg-background">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--amber)]/10 text-[var(--amber)]">
          <Globe size={14} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{agent.card.name}</span>
            <span className="inline-flex items-center gap-1 rounded border border-border/45 bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
              <StatusIcon size={10} className={statusClassName} aria-hidden="true" />
              A2A
            </span>
            {agent.card.skills.length > 0 ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                {skillsLabel}: {agent.card.skills.length}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-2xs text-muted-foreground">{agent.endpoint}</span>
        </span>
        <button
          type="button"
          onClick={() => onRemove(agent.id)}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-[var(--error)]/10 hover:text-[var(--error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          aria-label={removeLabel}
          title={removeLabel}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>

      {agent.card.skills.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
          {agent.card.skills.slice(0, 3).map((skill) => (
            <span
              key={skill.id}
              className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/35 px-1.5 py-0.5 text-2xs text-muted-foreground"
              title={skill.description}
            >
              <Zap size={9} aria-hidden="true" />
              {skill.name}
            </span>
          ))}
          {agent.card.skills.length > 3 ? (
            <span className="text-2xs text-muted-foreground/60">+{agent.card.skills.length - 3}</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
